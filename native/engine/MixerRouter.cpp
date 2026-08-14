#include "MixerRouter.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace playback::engine {

std::string_view busName(BusId id) noexcept {
    constexpr std::array names { "Click", "Cue", "IEM", "Acoustic", "Electric", "Bass", "Keys", "Strings", "Drums", "Vocals", "Other", "Pad" };
    const auto index = static_cast<std::size_t>(id);
    return index < names.size() ? names[index] : "Invalid";
}

MixerRouterGraph::MixerRouterGraph(std::vector<SourceMixDefinition> sources,
                                   std::vector<BusDefinition> buses,
                                   std::uint32_t outputChannels,
                                   std::uint32_t maximumBlockFrames,
                                   std::uint32_t workingChannels)
    : sources_(std::move(sources)), outputChannels_(outputChannels), workingChannels_(workingChannels) {
    if (sources_.size() > sourcePeaks_.size() || outputChannels == 0 || outputChannels > 32 || maximumBlockFrames == 0 || workingChannels == 0 || workingChannels > 2)
        throw std::invalid_argument("Mixer/router dimensions are invalid");
    busIndices_.fill(-1);
    sourceScratch_.reserve(sources_.size());
    for (const auto& source : sources_) {
        if (!source.source || source.sends.empty() || !std::isfinite(source.gain) || source.gain < 0.0) throw std::invalid_argument("Mixer source definition is invalid");
        for (const auto& send : source.sends)
            if (static_cast<std::size_t>(send.bus) >= busCount || !std::isfinite(send.gain) || send.gain < 0.0 || !std::isfinite(send.pan) || send.pan < -1.0 || send.pan > 1.0)
                throw std::invalid_argument("Mixer source send is invalid");
        sourceScratch_.emplace_back(workingChannels, maximumBlockFrames);
        latencyFrames_ = std::max(latencyFrames_, source.source->latencyFrames());
        anySourceSolo_ = anySourceSolo_ || source.solo;
    }
    buses_.reserve(buses.size());
    for (auto& bus : buses) {
        const auto id = static_cast<std::size_t>(bus.id);
        if (id >= busCount || busIndices_[id] >= 0 || !std::isfinite(bus.gain) || bus.gain < 0.0) throw std::invalid_argument("Mixer bus definition is invalid");
        for (const auto& route : bus.routes)
            if ((route.channelCount != 1 && route.channelCount != 2) || route.firstOutputChannel + route.channelCount > outputChannels)
                throw std::invalid_argument("Hardware route is outside the output span");
        busIndices_[id] = static_cast<int>(buses_.size());
        anyBusSolo_ = anyBusSolo_ || bus.solo;
        buses_.emplace_back(std::move(bus), workingChannels, maximumBlockFrames);
    }
    for (const auto& source : sources_)
        for (const auto& send : source.sends)
            if (busIndices_[static_cast<std::size_t>(send.bus)] < 0) throw std::invalid_argument("Mixer source targets an undefined bus");
}

double MixerRouterGraph::peak(const AudioBlock64& block, std::uint32_t frames) noexcept {
    double result = 0.0;
    for (std::uint32_t channel = 0; channel < block.channelCount(); ++channel)
        for (std::uint32_t frame = 0; frame < frames; ++frame) result = std::max(result, std::abs(block.channel(channel)[frame]));
    return result;
}

void MixerRouterGraph::addSend(const AudioBlock64& source, AudioBlock64& bus, const BusSend& send, double sourceGain, std::uint32_t frames) noexcept {
    const auto gain = sourceGain * send.gain;
    const auto leftGain = gain * (send.pan > 0.0 ? 1.0 - send.pan : 1.0);
    const auto rightGain = gain * (send.pan < 0.0 ? 1.0 + send.pan : 1.0);
    for (std::uint32_t frame = 0; frame < frames; ++frame) {
        bus.channel(0)[frame] += source.channel(0)[frame] * leftGain;
        if (workingChannels_ > 1) bus.channel(1)[frame] += source.channel(1)[frame] * rightGain;
    }
}

void MixerRouterGraph::routeBus(const BusRuntime& bus, AudioBlock64& output, std::uint32_t frames) noexcept {
    if (bus.definition.muted || (anyBusSolo_ && !bus.definition.solo)) return;
    for (const auto& route : bus.definition.routes) {
        if (route.channelCount == 1) {
            for (std::uint32_t frame = 0; frame < frames; ++frame) {
                const auto sample = workingChannels_ == 1 ? bus.scratch.channel(0)[frame] : (bus.scratch.channel(0)[frame] + bus.scratch.channel(1)[frame]) * 0.5;
                output.channel(route.firstOutputChannel)[frame] += sample * bus.definition.gain;
            }
        } else {
            for (std::uint32_t frame = 0; frame < frames; ++frame) {
                output.channel(route.firstOutputChannel)[frame] += bus.scratch.channel(0)[frame] * bus.definition.gain;
                output.channel(route.firstOutputChannel + 1)[frame] += bus.scratch.channel(workingChannels_ == 1 ? 0 : 1)[frame] * bus.definition.gain;
            }
        }
    }
}

RenderResult MixerRouterGraph::render(const RenderContext& context, AudioBlock64& output) noexcept {
    output.clear(context.frameCount);
    for (auto& bus : buses_) bus.scratch.clear(context.frameCount);
    bool underrun = false;
    for (std::size_t index = 0; index < sources_.size(); ++index) {
        const auto& definition = sources_[index];
        auto& scratch = sourceScratch_[index];
        scratch.clear(context.frameCount);
        const auto audible = !definition.muted && (!anySourceSolo_ || definition.solo);
        if (audible) {
            underrun = definition.source->render(context, scratch).underrun || underrun;
            for (const auto& send : definition.sends) addSend(scratch, buses_[static_cast<std::size_t>(busIndices_[static_cast<std::size_t>(send.bus)])].scratch, send, definition.gain, context.frameCount);
        }
        sourcePeaks_[index].store(audible ? peak(scratch, context.frameCount) * definition.gain : 0.0, std::memory_order_relaxed);
    }
    for (auto& bus : buses_) {
        busPeaks_[static_cast<std::size_t>(bus.definition.id)].store(peak(bus.scratch, context.frameCount) * bus.definition.gain, std::memory_order_relaxed);
        routeBus(bus, output, context.frameCount);
    }
    masterPeak_.store(peak(output, context.frameCount), std::memory_order_release);
    return { underrun };
}

MixerMeterSnapshot MixerRouterGraph::meters() const {
    MixerMeterSnapshot result;
    result.sourcePeaks.reserve(sources_.size());
    for (std::size_t index = 0; index < sources_.size(); ++index) result.sourcePeaks.push_back(sourcePeaks_[index].load(std::memory_order_relaxed));
    for (std::size_t index = 0; index < busCount; ++index) result.busPeaks[index] = busPeaks_[index].load(std::memory_order_relaxed);
    result.masterPeak = masterPeak_.load(std::memory_order_acquire);
    return result;
}

} // namespace playback::engine

#include "EngineCore.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace playback::engine {

AudioBlock64::AudioBlock64(std::uint32_t channels, std::uint32_t capacityFrames)
    : channels_(channels), capacityFrames_(capacityFrames), samples_(static_cast<std::size_t>(channels) * capacityFrames) {
    if (channels == 0 || capacityFrames == 0) throw std::invalid_argument("AudioBlock64 dimensions must be positive");
}

double* AudioBlock64::channel(std::uint32_t index) noexcept {
    assert(index < channels_);
    return samples_.data() + static_cast<std::size_t>(index) * capacityFrames_;
}

const double* AudioBlock64::channel(std::uint32_t index) const noexcept {
    assert(index < channels_);
    return samples_.data() + static_cast<std::size_t>(index) * capacityFrames_;
}

void AudioBlock64::clear(std::uint32_t frameCount) noexcept {
    assert(frameCount <= capacityFrames_);
    for (std::uint32_t channelIndex = 0; channelIndex < channels_; ++channelIndex)
        std::fill_n(channel(channelIndex), frameCount, 0.0);
}

void AudioBlock64::addFrom(const AudioBlock64& source, std::uint32_t frameCount) noexcept {
    assert(frameCount <= capacityFrames_ && frameCount <= source.capacityFrames_ && channels_ == source.channels_);
    for (std::uint32_t channelIndex = 0; channelIndex < channels_; ++channelIndex) {
        auto* destination = channel(channelIndex);
        const auto* input = source.channel(channelIndex);
        for (std::uint32_t frame = 0; frame < frameCount; ++frame) destination[frame] += input[frame];
    }
}

MasterTransport::MasterTransport(double sampleRate) noexcept : sampleRate_(sampleRate) {
    assert(std::isfinite(sampleRate) && sampleRate > 0.0);
}

void MasterTransport::play() noexcept { state_ = TransportState::playing; }
void MasterTransport::pause() noexcept { if (state_ == TransportState::playing) state_ = TransportState::paused; }
void MasterTransport::stop() noexcept { position_ = 0; state_ = TransportState::stopped; ++generation_; }
void MasterTransport::seek(SampleFrame targetFrame) noexcept { position_ = std::max<SampleFrame>(0, targetFrame); ++generation_; }
void MasterTransport::advance(std::uint32_t frames) noexcept { if (state_ == TransportState::playing) position_ += frames; }
RenderContext MasterTransport::context(std::uint32_t frames) const noexcept { return { position_, frames, sampleRate_, generation_ }; }

EngineGraph::EngineGraph(std::vector<std::shared_ptr<IAudioSource>> sources,
                         std::vector<std::shared_ptr<IAudioProcessor>> processors,
                         std::uint32_t channels,
                         std::uint32_t maximumBlockFrames)
    : sources_(std::move(sources)), processors_(std::move(processors)) {
    sourceScratch_.reserve(sources_.size());
    for (const auto& source : sources_) {
        if (!source) throw std::invalid_argument("EngineGraph source cannot be null");
        sourceScratch_.emplace_back(channels, maximumBlockFrames);
        latencyFrames_ = std::max(latencyFrames_, source->latencyFrames());
    }
    for (const auto& processor : processors_) {
        if (!processor) throw std::invalid_argument("EngineGraph processor cannot be null");
        latencyFrames_ += processor->latencyFrames();
    }
}

RenderResult EngineGraph::render(const RenderContext& context, AudioBlock64& output) noexcept {
    output.clear(context.frameCount);
    bool underrun = false;
    for (std::size_t index = 0; index < sources_.size(); ++index) {
        auto& scratch = sourceScratch_[index];
        scratch.clear(context.frameCount);
        underrun = sources_[index]->render(context, scratch).underrun || underrun;
        output.addFrom(scratch, context.frameCount);
    }
    for (const auto& processor : processors_) processor->process(context, output);
    return { underrun };
}

void EngineTelemetry::publish(const TelemetrySnapshot& value) noexcept {
    revision_.fetch_add(1, std::memory_order_acq_rel);
    state_.store(value.state, std::memory_order_relaxed);
    masterFrame_.store(value.masterFrame, std::memory_order_relaxed);
    generation_.store(value.discontinuityGeneration, std::memory_order_relaxed);
    renderedBlocks_.store(value.renderedBlocks, std::memory_order_relaxed);
    underruns_.store(value.underruns, std::memory_order_relaxed);
    revision_.fetch_add(1, std::memory_order_release);
}

TelemetrySnapshot EngineTelemetry::snapshot() const noexcept {
    for (;;) {
        const auto before = revision_.load(std::memory_order_acquire);
        if ((before & 1u) != 0) continue;
        const TelemetrySnapshot value { state_.load(std::memory_order_relaxed), masterFrame_.load(std::memory_order_relaxed),
                                        generation_.load(std::memory_order_relaxed), renderedBlocks_.load(std::memory_order_relaxed),
                                        underruns_.load(std::memory_order_relaxed) };
        if (revision_.load(std::memory_order_acquire) == before) return value;
    }
}

EngineCore::EngineCore(double sampleRate, std::uint32_t channels, std::uint32_t maximumBlockFrames)
    : transport_(sampleRate), channels_(channels), maximumBlockFrames_(maximumBlockFrames) {
    if (channels == 0 || maximumBlockFrames == 0) throw std::invalid_argument("EngineCore dimensions must be positive");
}

void EngineCore::applyCommands() noexcept {
    EngineCommand command;
    while (commands_.pop(command)) {
        switch (command.type) {
            case CommandType::play: transport_.play(); break;
            case CommandType::pause: transport_.pause(); break;
            case CommandType::stop: transport_.stop(); break;
            case CommandType::seek: transport_.seek(command.targetFrame); break;
        }
    }
}

void EngineCore::process(AudioBlock64& output, std::uint32_t frameCount) noexcept {
    assert(output.channelCount() == channels_ && frameCount <= maximumBlockFrames_ && frameCount <= output.capacityFrames());
    applyCommands();
    const auto context = transport_.context(frameCount);
    bool underrun = false;
    if (transport_.state() == TransportState::playing) {
        if (auto* graph = graphs_.active()) underrun = graph->render(context, output).underrun;
        else { output.clear(frameCount); underrun = true; }
        transport_.advance(frameCount);
        ++renderedBlocks_;
        if (underrun) ++underruns_;
    } else output.clear(frameCount);
    telemetry_.publish({ transport_.state(), transport_.position(), transport_.generation(), renderedBlocks_, underruns_ });
}

bool LegacyTransportAdapter::seekSeconds(double seconds) noexcept {
    if (!std::isfinite(seconds) || seconds < 0.0 || seconds > static_cast<double>(std::numeric_limits<SampleFrame>::max()) / sampleRate_) return false;
    return queue_.push({ CommandType::seek, static_cast<SampleFrame>(std::llround(seconds * sampleRate_)) });
}

std::vector<double> OfflineRenderer::render(EngineCore& engine, std::uint32_t channels,
                                            SampleFrame totalFrames,
                                            std::span<const std::uint32_t> blockPattern,
                                            std::uint32_t maximumBlockFrames) {
    if (totalFrames < 0 || blockPattern.empty()) throw std::invalid_argument("Offline render request is invalid");
    AudioBlock64 block(channels, maximumBlockFrames);
    std::vector<double> result(static_cast<std::size_t>(totalFrames) * channels);
    SampleFrame rendered = 0;
    std::size_t patternIndex = 0;
    while (rendered < totalFrames) {
        const auto requested = blockPattern[patternIndex++ % blockPattern.size()];
        if (requested == 0 || requested > maximumBlockFrames) throw std::invalid_argument("Offline block size is invalid");
        const auto count = static_cast<std::uint32_t>(std::min<SampleFrame>(requested, totalFrames - rendered));
        engine.process(block, count);
        for (std::uint32_t channelIndex = 0; channelIndex < channels; ++channelIndex)
            std::copy_n(block.channel(channelIndex), count, result.data() + static_cast<std::size_t>(channelIndex) * totalFrames + rendered);
        rendered += count;
    }
    return result;
}

} // namespace playback::engine

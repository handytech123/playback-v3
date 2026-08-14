#pragma once

#include "EngineCore.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <string_view>
#include <vector>

namespace playback::engine {

enum class BusId : std::uint8_t {
    click, cue, iem, acoustic, electric, bass, keys, strings, drums, vocals, other, pad, count
};

constexpr std::size_t busCount = static_cast<std::size_t>(BusId::count);
std::string_view busName(BusId) noexcept;

struct BusSend {
    BusId bus {};
    double gain { 1.0 };
    double pan {};
};

struct SourceMixDefinition {
    std::shared_ptr<IAudioSource> source;
    std::vector<BusSend> sends;
    double gain { 1.0 };
    bool muted {};
    bool solo {};
};

struct HardwareRoute {
    std::uint32_t firstOutputChannel {};
    std::uint32_t channelCount { 1 };
};

struct BusDefinition {
    BusId id {};
    std::vector<HardwareRoute> routes;
    double gain { 1.0 };
    bool muted {};
    bool solo {};
};

struct MixerMeterSnapshot {
    std::vector<double> sourcePeaks;
    std::array<double, busCount> busPeaks {};
    double masterPeak {};
};

class MixerRouterGraph final : public IRenderGraph {
public:
    MixerRouterGraph(std::vector<SourceMixDefinition> sources,
                     std::vector<BusDefinition> buses,
                     std::uint32_t outputChannels,
                     std::uint32_t maximumBlockFrames,
                     std::uint32_t workingChannels = 2);

    RenderResult render(const RenderContext&, AudioBlock64&) noexcept override;
    std::uint32_t latencyFrames() const noexcept override { return latencyFrames_; }
    std::size_t sourceCount() const noexcept override { return sources_.size(); }
    std::uint32_t outputChannels() const noexcept { return outputChannels_; }
    MixerMeterSnapshot meters() const;

private:
    struct BusRuntime {
        BusRuntime(BusDefinition value, std::uint32_t channels, std::uint32_t frames)
            : definition(std::move(value)), scratch(channels, frames) {}
        BusDefinition definition;
        AudioBlock64 scratch;
    };

    static double peak(const AudioBlock64&, std::uint32_t frames) noexcept;
    void addSend(const AudioBlock64&, AudioBlock64&, const BusSend&, double sourceGain, std::uint32_t frames) noexcept;
    void routeBus(const BusRuntime&, AudioBlock64&, std::uint32_t frames) noexcept;

    std::vector<SourceMixDefinition> sources_;
    std::vector<AudioBlock64> sourceScratch_;
    std::vector<BusRuntime> buses_;
    std::array<int, busCount> busIndices_ {};
    std::array<std::atomic<double>, 64> sourcePeaks_ {};
    std::array<std::atomic<double>, busCount> busPeaks_ {};
    std::atomic<double> masterPeak_ {};
    std::uint32_t outputChannels_ {};
    std::uint32_t workingChannels_ {};
    std::uint32_t latencyFrames_ {};
    bool anySourceSolo_ {};
    bool anyBusSolo_ {};
};

} // namespace playback::engine

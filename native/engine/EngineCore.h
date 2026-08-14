#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <vector>

namespace playback::engine {

using SampleFrame = std::int64_t;

enum class TransportState : std::uint8_t { stopped, paused, playing };
enum class CommandType : std::uint8_t { play, pause, stop, seek };

struct RenderContext {
    SampleFrame masterStartFrame {};
    std::uint32_t frameCount {};
    double engineSampleRate {};
    std::uint64_t discontinuityGeneration {};
};

struct RenderResult {
    bool underrun {};
};

struct EngineCommand {
    CommandType type {};
    SampleFrame targetFrame {};
};

class AudioBlock64 {
public:
    AudioBlock64(std::uint32_t channels, std::uint32_t capacityFrames);
    std::uint32_t channelCount() const noexcept { return channels_; }
    std::uint32_t capacityFrames() const noexcept { return capacityFrames_; }
    double* channel(std::uint32_t index) noexcept;
    const double* channel(std::uint32_t index) const noexcept;
    void clear(std::uint32_t frameCount) noexcept;
    void addFrom(const AudioBlock64& source, std::uint32_t frameCount) noexcept;

private:
    std::uint32_t channels_ {};
    std::uint32_t capacityFrames_ {};
    std::vector<double> samples_;
};

class IAudioSource {
public:
    virtual ~IAudioSource() = default;
    virtual std::uint32_t latencyFrames() const noexcept = 0;
    virtual RenderResult render(const RenderContext&, AudioBlock64&) noexcept = 0;
};

class IAudioProcessor {
public:
    virtual ~IAudioProcessor() = default;
    virtual std::uint32_t latencyFrames() const noexcept = 0;
    virtual void process(const RenderContext&, AudioBlock64&) noexcept = 0;
};

class IRenderGraph {
public:
    virtual ~IRenderGraph() = default;
    virtual RenderResult render(const RenderContext&, AudioBlock64&) noexcept = 0;
    virtual std::uint32_t latencyFrames() const noexcept = 0;
    virtual std::size_t sourceCount() const noexcept = 0;
};

class MasterTransport {
public:
    explicit MasterTransport(double sampleRate) noexcept;
    void play() noexcept;
    void pause() noexcept;
    void stop() noexcept;
    void seek(SampleFrame targetFrame) noexcept;
    void advance(std::uint32_t frames) noexcept;
    RenderContext context(std::uint32_t frames) const noexcept;
    TransportState state() const noexcept { return state_; }
    SampleFrame position() const noexcept { return position_; }
    double sampleRate() const noexcept { return sampleRate_; }
    std::uint64_t generation() const noexcept { return generation_; }

private:
    double sampleRate_ {};
    SampleFrame position_ {};
    std::uint64_t generation_ {};
    TransportState state_ { TransportState::stopped };
};

class EngineGraph final : public IRenderGraph {
public:
    EngineGraph(std::vector<std::shared_ptr<IAudioSource>> sources,
                std::vector<std::shared_ptr<IAudioProcessor>> processors,
                std::uint32_t channels,
                std::uint32_t maximumBlockFrames);
    RenderResult render(const RenderContext&, AudioBlock64&) noexcept override;
    std::uint32_t latencyFrames() const noexcept override { return latencyFrames_; }
    std::size_t sourceCount() const noexcept override { return sources_.size(); }

private:
    std::vector<std::shared_ptr<IAudioSource>> sources_;
    std::vector<std::shared_ptr<IAudioProcessor>> processors_;
    std::vector<AudioBlock64> sourceScratch_;
    std::uint32_t latencyFrames_ {};
};

// Published graphs must outlive every callback that can observe them. Graph
// reclamation belongs to the non-realtime owner after the device is stopped or
// after a later epoch-based retirement mechanism declares it safe.
class GraphPublisher {
public:
    void publish(IRenderGraph* graph) noexcept { active_.store(graph, std::memory_order_release); }
    IRenderGraph* active() const noexcept { return active_.load(std::memory_order_acquire); }

private:
    std::atomic<IRenderGraph*> active_ { nullptr };
};

template <std::size_t Capacity>
class RealtimeCommandQueue {
    static_assert(Capacity >= 2);
public:
    bool push(const EngineCommand& command) noexcept {
        const auto write = write_.load(std::memory_order_relaxed);
        const auto next = increment(write);
        if (next == read_.load(std::memory_order_acquire)) return false;
        commands_[write] = command;
        write_.store(next, std::memory_order_release);
        return true;
    }
    bool pop(EngineCommand& command) noexcept {
        const auto read = read_.load(std::memory_order_relaxed);
        if (read == write_.load(std::memory_order_acquire)) return false;
        command = commands_[read];
        read_.store(increment(read), std::memory_order_release);
        return true;
    }

private:
    static constexpr std::size_t increment(std::size_t value) noexcept { return (value + 1) % Capacity; }
    std::array<EngineCommand, Capacity> commands_ {};
    alignas(64) std::atomic<std::size_t> write_ {};
    alignas(64) std::atomic<std::size_t> read_ {};
};

struct TelemetrySnapshot {
    TransportState state {};
    SampleFrame masterFrame {};
    std::uint64_t discontinuityGeneration {};
    std::uint64_t renderedBlocks {};
    std::uint64_t underruns {};
};

class EngineTelemetry {
public:
    void publish(const TelemetrySnapshot&) noexcept;
    TelemetrySnapshot snapshot() const noexcept;

private:
    std::atomic<std::uint64_t> revision_ {};
    std::atomic<TransportState> state_ { TransportState::stopped };
    std::atomic<SampleFrame> masterFrame_ {};
    std::atomic<std::uint64_t> generation_ {};
    std::atomic<std::uint64_t> renderedBlocks_ {};
    std::atomic<std::uint64_t> underruns_ {};
};

class EngineCore {
public:
    EngineCore(double sampleRate, std::uint32_t channels, std::uint32_t maximumBlockFrames);
    GraphPublisher& graphs() noexcept { return graphs_; }
    RealtimeCommandQueue<256>& commands() noexcept { return commands_; }
    const EngineTelemetry& telemetry() const noexcept { return telemetry_; }
    const MasterTransport& transport() const noexcept { return transport_; }
    void process(AudioBlock64& output, std::uint32_t frameCount) noexcept;

private:
    void applyCommands() noexcept;
    MasterTransport transport_;
    GraphPublisher graphs_;
    RealtimeCommandQueue<256> commands_;
    EngineTelemetry telemetry_;
    std::uint32_t channels_ {};
    std::uint32_t maximumBlockFrames_ {};
    std::uint64_t renderedBlocks_ {};
    std::uint64_t underruns_ {};
};

class LegacyTransportAdapter {
public:
    explicit LegacyTransportAdapter(RealtimeCommandQueue<256>& queue, double sampleRate) noexcept
        : queue_(queue), sampleRate_(sampleRate) {}
    bool play() noexcept { return queue_.push({ CommandType::play, 0 }); }
    bool pause() noexcept { return queue_.push({ CommandType::pause, 0 }); }
    bool stop() noexcept { return queue_.push({ CommandType::stop, 0 }); }
    bool seekSeconds(double seconds) noexcept;

private:
    RealtimeCommandQueue<256>& queue_;
    double sampleRate_ {};
};

class OfflineRenderer {
public:
    static std::vector<double> render(EngineCore&, std::uint32_t channels,
                                      SampleFrame totalFrames,
                                      std::span<const std::uint32_t> blockPattern,
                                      std::uint32_t maximumBlockFrames);
};

} // namespace playback::engine

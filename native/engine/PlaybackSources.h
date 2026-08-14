#pragma once

#include "EngineCore.h"

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <thread>
#include <vector>

namespace playback::engine {

class AudioClip {
public:
    AudioClip(std::uint32_t channels, std::uint32_t frames) : audio(channels, frames), frames(frames) {}
    AudioBlock64 audio;
    std::uint32_t frames {};
};

struct ScheduledAudioEvent {
    SampleFrame startFrame {};
    std::shared_ptr<const AudioClip> clip;
    std::uint32_t maximumFrames {};
    std::uint32_t fadeFrames {};
};

class ScheduledClipSource final : public IAudioSource {
public:
    explicit ScheduledClipSource(std::vector<ScheduledAudioEvent> events);
    std::uint32_t latencyFrames() const noexcept override { return 0; }
    RenderResult render(const RenderContext&, AudioBlock64&) noexcept override;
    std::size_t eventCount() const noexcept { return events_.size(); }
private:
    std::vector<ScheduledAudioEvent> events_;
};

class PadLoopSource final : public IAudioSource {
public:
    explicit PadLoopSource(std::shared_ptr<const AudioClip> clip) : clip_(std::move(clip)) {}
    std::uint32_t latencyFrames() const noexcept override { return 0; }
    RenderResult render(const RenderContext&, AudioBlock64&) noexcept override;
    void setEnabled(bool enabled, SampleFrame activationFrame) noexcept;
    void setGain(double gain) noexcept { gain_.store(gain, std::memory_order_release); }
private:
    std::shared_ptr<const AudioClip> clip_;
    std::atomic<bool> enabled_ {};
    std::atomic<SampleFrame> activationFrame_ {};
    std::atomic<double> gain_ { 1.0 };
};

struct MidiEvent {
    SampleFrame frame {};
    std::uint8_t status {}, data1 {}, data2 {};
};

template <std::size_t Capacity>
class MidiDispatchQueue {
public:
    bool push(const MidiEvent& event) noexcept {
        const auto write = write_.load(std::memory_order_relaxed), next = increment(write);
        if (next == read_.load(std::memory_order_acquire)) return false;
        events_[write] = event; write_.store(next, std::memory_order_release); return true;
    }
    bool pop(MidiEvent& event) noexcept {
        const auto read = read_.load(std::memory_order_relaxed);
        if (read == write_.load(std::memory_order_acquire)) return false;
        event = events_[read]; read_.store(increment(read), std::memory_order_release); return true;
    }
private:
    static constexpr std::size_t increment(std::size_t value) noexcept { return (value + 1) % Capacity; }
    std::array<MidiEvent, Capacity> events_ {};
    alignas(64) std::atomic<std::size_t> write_ {};
    alignas(64) std::atomic<std::size_t> read_ {};
};

class ScheduledMidiSource final : public IAudioSource {
public:
    ScheduledMidiSource(std::vector<MidiEvent> events, MidiDispatchQueue<2048>& queue);
    std::uint32_t latencyFrames() const noexcept override { return 0; }
    RenderResult render(const RenderContext&, AudioBlock64&) noexcept override;
    std::uint64_t droppedEvents() const noexcept { return dropped_.load(std::memory_order_relaxed); }
private:
    std::vector<MidiEvent> events_;
    MidiDispatchQueue<2048>& queue_;
    std::atomic<std::uint64_t> dropped_ {};
};

class IMidiSink {
public:
    virtual ~IMidiSink() = default;
    virtual void send(const MidiEvent&) = 0;
};

class MidiDispatcher {
public:
    MidiDispatcher(MidiDispatchQueue<2048>& queue, IMidiSink& sink);
    ~MidiDispatcher();
    void start();
    void stop() noexcept;
    std::uint64_t dispatchedEvents() const noexcept { return dispatched_.load(std::memory_order_relaxed); }
private:
    void loop();
    MidiDispatchQueue<2048>& queue_;
    IMidiSink& sink_;
    std::thread worker_;
    std::atomic<bool> stop_ { true };
    std::atomic<std::uint64_t> dispatched_ {};
};

} // namespace playback::engine

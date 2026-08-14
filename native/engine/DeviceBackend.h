#pragma once

#include "EngineCore.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>

namespace playback::engine {

enum class DeviceBackendKind : std::uint8_t { asio, wasapi, waveOut, simulated };
enum class DeviceLifecycle : std::uint8_t { closed, opening, ready, running, faulted, recovering };

struct DeviceConfig {
    DeviceBackendKind backend { DeviceBackendKind::simulated };
    double sampleRate { 48000.0 };
    std::uint32_t blockFrames { 256 };
    std::uint32_t outputChannels { 2 };
    bool silentOutput { true };
    bool fullDuplexInputs { false };
};

struct DeviceStatus {
    DeviceLifecycle lifecycle { DeviceLifecycle::closed };
    double sampleRate {};
    std::uint32_t blockFrames {};
    std::uint32_t outputChannels {};
    std::uint64_t callbacks {};
    std::uint64_t xruns {};
    std::uint64_t restartCount {};
    std::uint64_t maximumCallbackNanoseconds {};
};

class IDeviceRenderClient {
public:
    virtual ~IDeviceRenderClient() = default;
    virtual void render(AudioBlock64&, std::uint32_t frameCount) noexcept = 0;
};

class EngineRenderClient final : public IDeviceRenderClient {
public:
    explicit EngineRenderClient(EngineCore& engine) noexcept : engine_(engine) {}
    void render(AudioBlock64& output, std::uint32_t frames) noexcept override { engine_.process(output, frames); }
private:
    EngineCore& engine_;
};

class IAudioDeviceBackend {
public:
    virtual ~IAudioDeviceBackend() = default;
    virtual bool open(const DeviceConfig&, IDeviceRenderClient&) = 0;
    virtual bool start() = 0;
    virtual void stop() noexcept = 0;
    virtual void close() noexcept = 0;
    virtual DeviceStatus status() const noexcept = 0;
};

class SimulatedDeviceBackend final : public IAudioDeviceBackend {
public:
    explicit SimulatedDeviceBackend(bool realtime = true) noexcept : realtime_(realtime) {}
    ~SimulatedDeviceBackend() override { close(); }
    bool open(const DeviceConfig&, IDeviceRenderClient&) override;
    bool start() override;
    void stop() noexcept override;
    void close() noexcept override;
    DeviceStatus status() const noexcept override;
    void faultAfterCallbacks(std::uint64_t value) noexcept { faultAfter_.store(value, std::memory_order_release); }
    bool recover();

private:
    void loop() noexcept;
    bool realtime_ {};
    DeviceConfig config_;
    IDeviceRenderClient* client_ {};
    std::unique_ptr<AudioBlock64> block_;
    std::thread thread_;
    std::atomic<bool> stopRequested_ {};
    std::atomic<DeviceLifecycle> lifecycle_ { DeviceLifecycle::closed };
    std::atomic<std::uint64_t> callbacks_ {}, xruns_ {}, restartCount_ {}, maximumCallbackNanoseconds_ {}, faultAfter_ {};
};

} // namespace playback::engine

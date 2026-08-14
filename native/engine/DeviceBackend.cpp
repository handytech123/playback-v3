#include "DeviceBackend.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace playback::engine {

bool SimulatedDeviceBackend::open(const DeviceConfig& config, IDeviceRenderClient& client) {
    if (lifecycle_.load(std::memory_order_acquire) != DeviceLifecycle::closed || !std::isfinite(config.sampleRate) || config.sampleRate <= 0.0 || config.blockFrames == 0 || config.outputChannels == 0 || config.outputChannels > 32) return false;
    lifecycle_.store(DeviceLifecycle::opening, std::memory_order_release);
    config_ = config; client_ = &client;
    block_ = std::make_unique<AudioBlock64>(config.outputChannels, config.blockFrames);
    lifecycle_.store(DeviceLifecycle::ready, std::memory_order_release);
    return true;
}

bool SimulatedDeviceBackend::start() {
    const auto state = lifecycle_.load(std::memory_order_acquire);
    if (state != DeviceLifecycle::ready && state != DeviceLifecycle::recovering) return false;
    stopRequested_.store(false, std::memory_order_release);
    lifecycle_.store(DeviceLifecycle::running, std::memory_order_release);
    thread_ = std::thread([this] { loop(); });
    return true;
}

void SimulatedDeviceBackend::stop() noexcept {
    stopRequested_.store(true, std::memory_order_release);
    if (thread_.joinable()) thread_.join();
    if (lifecycle_.load(std::memory_order_acquire) != DeviceLifecycle::closed) lifecycle_.store(DeviceLifecycle::ready, std::memory_order_release);
}

void SimulatedDeviceBackend::close() noexcept {
    stop(); block_.reset(); client_ = nullptr; lifecycle_.store(DeviceLifecycle::closed, std::memory_order_release);
}

bool SimulatedDeviceBackend::recover() {
    if (lifecycle_.load(std::memory_order_acquire) != DeviceLifecycle::faulted) return false;
    if (thread_.joinable()) thread_.join();
    restartCount_.fetch_add(1, std::memory_order_relaxed);
    faultAfter_.store(0, std::memory_order_release);
    lifecycle_.store(DeviceLifecycle::recovering, std::memory_order_release);
    return start();
}

void SimulatedDeviceBackend::loop() noexcept {
    const auto period = std::chrono::duration<double>(config_.blockFrames / config_.sampleRate);
    auto deadline = std::chrono::steady_clock::now();
    while (!stopRequested_.load(std::memory_order_acquire)) {
        const auto faultAfter = faultAfter_.load(std::memory_order_acquire);
        if (faultAfter > 0 && callbacks_.load(std::memory_order_relaxed) >= faultAfter) { lifecycle_.store(DeviceLifecycle::faulted, std::memory_order_release); return; }
        const auto start = std::chrono::steady_clock::now();
        client_->render(*block_, config_.blockFrames);
        if (config_.silentOutput) block_->clear(config_.blockFrames);
        const auto elapsed = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count());
        auto maximum = maximumCallbackNanoseconds_.load(std::memory_order_relaxed);
        while (maximum < elapsed && !maximumCallbackNanoseconds_.compare_exchange_weak(maximum, elapsed, std::memory_order_relaxed)) {}
        callbacks_.fetch_add(1, std::memory_order_relaxed);
        if (elapsed > static_cast<std::uint64_t>(period.count() * 1.0e9)) xruns_.fetch_add(1, std::memory_order_relaxed);
        if (realtime_) { deadline += std::chrono::duration_cast<std::chrono::steady_clock::duration>(period); std::this_thread::sleep_until(deadline); }
    }
}

DeviceStatus SimulatedDeviceBackend::status() const noexcept {
    return { lifecycle_.load(std::memory_order_acquire), config_.sampleRate, config_.blockFrames, config_.outputChannels,
             callbacks_.load(std::memory_order_relaxed), xruns_.load(std::memory_order_relaxed), restartCount_.load(std::memory_order_relaxed),
             maximumCallbackNanoseconds_.load(std::memory_order_relaxed) };
}

} // namespace playback::engine

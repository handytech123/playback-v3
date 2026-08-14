#include "JuceDeviceBackend.h"

#include <algorithm>
#include <chrono>

namespace playback::device {
using namespace playback::engine;

JuceDeviceBackend::JuceDeviceBackend(juce::String type, juce::String name) : requestedType_(std::move(type)), requestedName_(std::move(name)) {}

std::vector<DeviceDescription> JuceDeviceBackend::enumerate() {
    juce::AudioDeviceManager manager; manager.initialise(0, 0, nullptr, true);
    std::vector<DeviceDescription> result;
    for (auto* type : manager.getAvailableDeviceTypes()) { type->scanForDevices(); for (const auto& name : type->getDeviceNames(false)) { std::unique_ptr<juce::AudioIODevice> device(type->createDevice(name, {})); result.push_back({ type->getTypeName(), name, device ? device->getOutputChannelNames().size() : 0 }); } }
    return result;
}

bool JuceDeviceBackend::open(const DeviceConfig& config, IDeviceRenderClient& client) {
    if (lifecycle_.load() != DeviceLifecycle::closed || config.blockFrames == 0 || config.outputChannels == 0 || config.outputChannels > 32) return false;
    lifecycle_.store(DeviceLifecycle::opening); config_ = config; client_ = &client;
    directAsio_ = requestedType_.equalsIgnoreCase("ASIO");
    if (directAsio_) {
        directType_.reset(juce::AudioIODeviceType::createAudioIODeviceType_ASIO());
        if (!directType_) { lastError_ = "ASIO backend is unavailable"; lifecycle_.store(DeviceLifecycle::faulted); return false; }
        directType_->scanForDevices();
        directDevice_.reset(directType_->createDevice(requestedName_, config.fullDuplexInputs ? requestedName_ : juce::String {}));
        if (!directDevice_) { lastError_ = "ASIO device was not found"; lifecycle_.store(DeviceLifecycle::faulted); return false; }
        juce::BigInteger inputs, outputs; outputs.setRange(0, static_cast<int>(config.outputChannels), true); if (config.fullDuplexInputs) inputs.setRange(0, static_cast<int>(config.outputChannels), true);
        const auto directError = directDevice_->open(inputs, outputs, config.sampleRate, static_cast<int>(config.blockFrames));
        if (directError.isNotEmpty()) { lastError_ = directError; directDevice_.reset(); directType_.reset(); lifecycle_.store(DeviceLifecycle::faulted); return false; }
        config_.sampleRate = directDevice_->getCurrentSampleRate(); config_.blockFrames = static_cast<std::uint32_t>(directDevice_->getCurrentBufferSizeSamples()); config_.outputChannels = static_cast<std::uint32_t>(directDevice_->getActiveOutputChannels().countNumberOfSetBits());
        block_ = std::make_unique<AudioBlock64>(config_.outputChannels, config_.blockFrames); lifecycle_.store(DeviceLifecycle::ready); return true;
    }
    auto error = manager_.initialise(0, 0, nullptr, true);
    if (error.isEmpty() && requestedType_.isNotEmpty()) manager_.setCurrentAudioDeviceType(requestedType_, true);
    juce::AudioDeviceManager::AudioDeviceSetup setup; manager_.getAudioDeviceSetup(setup);
    if (requestedName_.isNotEmpty()) setup.outputDeviceName = requestedName_;
    setup.inputDeviceName = config.fullDuplexInputs ? requestedName_ : juce::String {}; setup.useDefaultInputChannels = false; setup.useDefaultOutputChannels = false;
    setup.inputChannels.clear(); if (config.fullDuplexInputs) setup.inputChannels.setRange(0, static_cast<int>(config.outputChannels), true);
    setup.outputChannels.clear(); setup.outputChannels.setRange(0, static_cast<int>(config.outputChannels), true);
    setup.sampleRate = config.sampleRate; setup.bufferSize = static_cast<int>(config.blockFrames);
    if (error.isEmpty()) error = manager_.setAudioDeviceSetup(setup, true);
    if (error.isNotEmpty()) { lastError_ = error; lifecycle_.store(DeviceLifecycle::faulted); return false; }
    if (auto* device = manager_.getCurrentAudioDevice()) {
        config_.sampleRate = device->getCurrentSampleRate(); config_.blockFrames = static_cast<std::uint32_t>(device->getCurrentBufferSizeSamples()); config_.outputChannels = static_cast<std::uint32_t>(device->getActiveOutputChannels().countNumberOfSetBits());
    }
    block_ = std::make_unique<AudioBlock64>(config_.outputChannels, config_.blockFrames);
    lifecycle_.store(DeviceLifecycle::ready); return true;
}

bool JuceDeviceBackend::start() { if (lifecycle_.load() != DeviceLifecycle::ready) return false; if (directAsio_) directDevice_->start(this); else manager_.addAudioCallback(this); lifecycle_.store(DeviceLifecycle::running); return true; }
void JuceDeviceBackend::stop() noexcept { if (lifecycle_.load() == DeviceLifecycle::running) { if (directAsio_ && directDevice_) directDevice_->stop(); else manager_.removeAudioCallback(this); } if (lifecycle_.load() != DeviceLifecycle::closed) lifecycle_.store(DeviceLifecycle::ready); }
void JuceDeviceBackend::close() noexcept { stop(); if (directDevice_) directDevice_->close(); directDevice_.reset(); directType_.reset(); directAsio_ = false; manager_.closeAudioDevice(); block_.reset(); client_ = nullptr; lifecycle_.store(DeviceLifecycle::closed); }
void JuceDeviceBackend::audioDeviceAboutToStart(juce::AudioIODevice*) {}
void JuceDeviceBackend::audioDeviceStopped() { if (lifecycle_.load() == DeviceLifecycle::running) lifecycle_.store(DeviceLifecycle::faulted); }
void JuceDeviceBackend::audioDeviceError(const juce::String& error) { lastError_ = error; lifecycle_.store(DeviceLifecycle::faulted); }

void JuceDeviceBackend::audioDeviceIOCallbackWithContext(const float* const*, int, float* const* outputs, int outputCount, int frames, const juce::AudioIODeviceCallbackContext&) {
    const auto start = std::chrono::steady_clock::now();
    if (!block_ || static_cast<std::uint32_t>(frames) > block_->capacityFrames()) { for (int channel = 0; channel < outputCount; ++channel) if (outputs[channel]) juce::FloatVectorOperations::clear(outputs[channel], frames); xruns_.fetch_add(1); return; }
    client_->render(*block_, static_cast<std::uint32_t>(frames));
    for (int channel = 0; channel < outputCount; ++channel) if (outputs[channel]) { if (config_.silentOutput || channel >= static_cast<int>(block_->channelCount())) juce::FloatVectorOperations::clear(outputs[channel], frames); else for (int frame = 0; frame < frames; ++frame) outputs[channel][frame] = static_cast<float>(block_->channel(channel)[frame]); }
    const auto elapsed = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count());
    auto maximum = maximumCallbackNanoseconds_.load(); while (maximum < elapsed && !maximumCallbackNanoseconds_.compare_exchange_weak(maximum, elapsed)) {}
    callbacks_.fetch_add(1); const auto deadline = static_cast<std::uint64_t>(frames / config_.sampleRate * 1.0e9); if (elapsed > deadline) xruns_.fetch_add(1);
}

DeviceStatus JuceDeviceBackend::status() const noexcept { return { lifecycle_.load(), config_.sampleRate, config_.blockFrames, config_.outputChannels, callbacks_.load(), xruns_.load(), restartCount_.load(), maximumCallbackNanoseconds_.load() }; }

} // namespace playback::device

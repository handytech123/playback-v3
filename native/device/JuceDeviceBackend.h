#pragma once

#include "DeviceBackend.h"
#include <juce_audio_utils/juce_audio_utils.h>

namespace playback::device {

struct DeviceDescription { juce::String type; juce::String name; int outputChannels {}; };

class JuceDeviceBackend final : public playback::engine::IAudioDeviceBackend,
                                private juce::AudioIODeviceCallback {
public:
    explicit JuceDeviceBackend(juce::String deviceType = {}, juce::String deviceName = {});
    ~JuceDeviceBackend() override { close(); }
    static std::vector<DeviceDescription> enumerate();
    bool open(const playback::engine::DeviceConfig&, playback::engine::IDeviceRenderClient&) override;
    bool start() override;
    void stop() noexcept override;
    void close() noexcept override;
    playback::engine::DeviceStatus status() const noexcept override;
    juce::String lastError() const { return lastError_; }

private:
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const*, int, int,
                                          const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice*) override;
    void audioDeviceStopped() override;
    void audioDeviceError(const juce::String&) override;

    juce::String requestedType_, requestedName_, lastError_;
    juce::AudioDeviceManager manager_;
    std::unique_ptr<juce::AudioIODeviceType> directType_;
    std::unique_ptr<juce::AudioIODevice> directDevice_;
    bool directAsio_ {};
    playback::engine::DeviceConfig config_;
    playback::engine::IDeviceRenderClient* client_ {};
    std::unique_ptr<playback::engine::AudioBlock64> block_;
    std::atomic<playback::engine::DeviceLifecycle> lifecycle_ { playback::engine::DeviceLifecycle::closed };
    std::atomic<std::uint64_t> callbacks_ {}, xruns_ {}, restartCount_ {}, maximumCallbackNanoseconds_ {};
};

} // namespace playback::device

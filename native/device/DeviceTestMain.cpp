#include "JuceDeviceBackend.h"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

namespace {
using namespace playback::engine;

class SilenceSource final : public IAudioSource {
public:
    std::uint32_t latencyFrames() const noexcept override { return 0; }
    RenderResult render(const RenderContext& context, AudioBlock64& output) noexcept override { output.clear(context.frameCount); return {}; }
};

std::string argument(int argc, char** argv, const std::string& name, std::string fallback = {}) {
    for (int index = 1; index + 1 < argc; ++index) if (argv[index] == name) return argv[index + 1];
    return fallback;
}
}

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI init;
    if (argc >= 2 && std::string(argv[1]) == "--list") {
        for (const auto& device : playback::device::JuceDeviceBackend::enumerate())
            std::cout << device.type << '\t' << device.name << '\t' << device.outputChannels << '\n';
        return 0;
    }
    if (argc < 2 || std::string(argv[1]) != "--silent-test") {
        std::cerr << "Usage: PlaybackEngineDeviceTest --list | --silent-test --type TYPE --name NAME [--channels 32 --sample-rate 48000 --block 256 --seconds 10]\n";
        return 2;
    }
    const auto type = argument(argc, argv, "--type"), name = argument(argc, argv, "--name");
    const auto channels = static_cast<std::uint32_t>(std::stoul(argument(argc, argv, "--channels", "2")));
    const auto rate = std::stod(argument(argc, argv, "--sample-rate", "48000"));
    const auto block = static_cast<std::uint32_t>(std::stoul(argument(argc, argv, "--block", "256")));
    const auto seconds = std::stod(argument(argc, argv, "--seconds", "10"));
    if (type.empty() || name.empty() || seconds <= 0.0) { std::cerr << "Silent test requires device type, name, and positive duration\n"; return 2; }

    auto silence = std::make_shared<SilenceSource>();
    EngineGraph graph({ silence }, {}, channels, block);
    EngineCore engine(rate, channels, block); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    EngineRenderClient client(engine);
    playback::device::JuceDeviceBackend device(type, name);
    if (!device.open({ DeviceBackendKind::asio, rate, block, channels, true }, client)) { std::cerr << "DEVICE_OPEN_FAILED error=\"" << device.lastError() << "\"\n"; return 3; }
    if (!device.start()) { std::cerr << "DEVICE_START_FAILED\n"; return 4; }
    std::this_thread::sleep_for(std::chrono::duration<double>(seconds));
    device.stop(); const auto status = device.status(); device.close();
    std::cout << "SILENT_DEVICE_TEST callbacks=" << status.callbacks << " xruns=" << status.xruns
              << " sample_rate=" << status.sampleRate << " block_frames=" << status.blockFrames
              << " output_channels=" << status.outputChannels << " max_callback_ns=" << status.maximumCallbackNanoseconds
              << " master_frames=" << engine.transport().position() << '\n';
    return status.callbacks > 0 && status.xruns == 0 ? 0 : 5;
}

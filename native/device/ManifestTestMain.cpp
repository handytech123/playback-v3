#include "JuceDeviceBackend.h"
#include "MixerRouter.h"
#include "PlaybackSources.h"
#include "SampleRateConverter.h"
#include "StreamingSource.h"

#include <juce_core/juce_core.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <memory>
#include <string>
#include <thread>

namespace {
using namespace playback::engine;

std::string argument(int argc, char** argv, const std::string& name, std::string fallback = {}) {
    for (int index = 1; index + 1 < argc; ++index) if (std::string(argv[index]) == name) return argv[index + 1];
    return fallback;
}
bool flag(int argc, char** argv, const std::string& name) { for (int index = 1; index < argc; ++index) if (std::string(argv[index]) == name) return true; return false; }

BusId classify(const juce::String& value) {
    const auto role = value.toLowerCase();
    if (role.contains("drum") || role.contains("loop") || role.contains("perc")) return BusId::drums;
    if (role.contains("bass")) return BusId::bass;
    if (role.contains("acoustic")) return BusId::acoustic;
    if (role.contains("electric") || role.contains("eg ") || role.startsWith("eg")) return BusId::electric;
    if (role.contains("key") || role.contains("piano") || role.contains("organ")) return BusId::keys;
    if (role.contains("string") || role.contains("orch")) return BusId::strings;
    if (role.contains("vocal") || role.contains("choir") || role.contains("alto") || role.contains("tenor") || role.contains("soprano")) return BusId::vocals;
    return BusId::other;
}

std::shared_ptr<AudioClip> loadClip(const juce::String& path, double rate) {
    auto decoder = matchSampleRate(std::make_unique<WavPcmDecoder>(path.toStdString()), rate, 4096, 64);
    const auto format = decoder->format();
    if (format.lengthFrames <= 0 || format.lengthFrames > 48'000 * 60 * 10) throw std::runtime_error("Live asset duration is invalid: " + path.toStdString());
    auto clip = std::make_shared<AudioClip>(std::max<std::uint32_t>(1, format.channels), static_cast<std::uint32_t>(format.lengthFrames));
    AudioBlock64 scratch(clip->audio.channelCount(), 4096);
    SampleFrame position = 0;
    while (position < format.lengthFrames) {
        const auto count = static_cast<std::uint32_t>(std::min<SampleFrame>(4096, format.lengthFrames - position));
        const auto decoded = decoder->decode(position, count, scratch); if (decoded == 0) break;
        for (std::uint32_t channel = 0; channel < clip->audio.channelCount(); ++channel) std::copy_n(scratch.channel(channel), decoded, clip->audio.channel(channel) + position);
        position += decoded;
    }
    clip->frames = static_cast<std::uint32_t>(position); return clip;
}

std::vector<BusDefinition> productionBuses() {
    return {
        { BusId::click, {{0,1}} }, { BusId::cue, {{1,1}} }, { BusId::iem, {{2,1}} }, { BusId::pad, {{3,1}} },
        { BusId::drums, {{4,1}} }, { BusId::bass, {{5,1}} }, { BusId::acoustic, {{6,1}} }, { BusId::electric, {{7,1}} },
        { BusId::keys, {{8,1}} }, { BusId::strings, {{9,1}} }, { BusId::vocals, {{10,1}} }, { BusId::other, {{11,1}} },
    };
}
}

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI init;
    const auto manifestPath = argument(argc, argv, "--manifest"), type = argument(argc, argv, "--type", "ASIO"), name = argument(argc, argv, "--name", "Dante Virtual Soundcard (x64)");
    const auto songIndex = std::stoi(argument(argc, argv, "--song-index", "0"));
    const auto rate = std::stod(argument(argc, argv, "--sample-rate", "48000"));
    const auto block = static_cast<std::uint32_t>(std::stoul(argument(argc, argv, "--block", "256")));
    const auto seconds = std::stod(argument(argc, argv, "--seconds", "30"));
    const auto audible = flag(argc, argv, "--audible");
    const auto fullDuplex = flag(argc, argv, "--full-duplex");
    if (manifestPath.empty()) { std::cerr << "--manifest is required\n"; return 2; }
    try {
        const auto parsed = juce::JSON::parse(juce::File(manifestPath));
        if (!parsed.isObject()) throw std::runtime_error("Manifest JSON is invalid");
        const auto songs = parsed.getDynamicObject()->getProperty("songs");
        if (!songs.isArray() || songIndex < 0 || songIndex >= songs.getArray()->size()) throw std::runtime_error("Song index is outside the manifest");
        const auto song = (*songs.getArray())[songIndex]; const auto stems = song.getDynamicObject()->getProperty("stems");
        if (!stems.isArray() || stems.getArray()->isEmpty()) throw std::runtime_error("Song has no stems");

        std::vector<SourceMixDefinition> sources;
        std::vector<std::shared_ptr<FileStemSource>> streaming;
        std::cout << "ENGINE_V3_LOADING stems=" << stems.getArray()->size() << "\n" << std::flush;
        for (const auto& stem : *stems.getArray()) {
            const auto path = stem.getDynamicObject()->getProperty("sourcePath").toString();
            auto decoder = matchSampleRate(std::make_unique<WavPcmDecoder>(path.toStdString()), rate, 1024, 64);
            auto source = std::make_shared<FileStemSource>(std::move(decoder), FileStemSource::Config { 2, 1024, 32, rate });
            source->prime(0, 0); streaming.push_back(source);
            const auto role = stem.getDynamicObject()->getProperty("role").toString();
            sources.push_back({ source, { { classify(role) } } });
        }

        const auto assets = song.getDynamicObject()->getProperty("liveAssets");
        std::shared_ptr<PadLoopSource> pad;
        if (assets.isObject()) {
            std::cout << "ENGINE_V3_LOADING live_assets=1\n" << std::flush;
            const auto click = assets.getDynamicObject()->getProperty("click");
            if (click.isObject()) {
                const auto regular = loadClip(click.getDynamicObject()->getProperty("regularPath").toString(), rate), accent = loadClip(click.getDynamicObject()->getProperty("accentPath").toString(), rate);
                std::vector<ScheduledAudioEvent> events; const auto values = click.getDynamicObject()->getProperty("events");
                if (values.isArray()) for (const auto& value : *values.getArray()) { const auto* object = value.getDynamicObject(); events.push_back({ static_cast<SampleFrame>(std::llround(static_cast<double>(object->getProperty("atSeconds")) * rate)), static_cast<bool>(object->getProperty("accent")) ? accent : regular }); }
                sources.push_back({ std::make_shared<ScheduledClipSource>(std::move(events)), { { BusId::click }, { BusId::iem } } });
            }
            const auto cueValues = assets.getDynamicObject()->getProperty("cues");
            if (cueValues.isArray()) { std::vector<ScheduledAudioEvent> events; for (const auto& value : *cueValues.getArray()) { const auto* object = value.getDynamicObject(); events.push_back({ static_cast<SampleFrame>(std::llround(static_cast<double>(object->getProperty("atSeconds")) * rate)), loadClip(object->getProperty("audioPath").toString(), rate) }); } sources.push_back({ std::make_shared<ScheduledClipSource>(std::move(events)), { { BusId::cue }, { BusId::iem } } }); }
            const auto padValue = assets.getDynamicObject()->getProperty("pad");
            if (padValue.isObject()) { pad = std::make_shared<PadLoopSource>(loadClip(padValue.getDynamicObject()->getProperty("audioPath").toString(), rate)); sources.push_back({ pad, { { BusId::pad } } }); }
        }
        const auto readinessDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
        for (;;) {
            const auto ready = std::count_if(streaming.begin(), streaming.end(), [](const auto& source) { return source->isReady(); });
            if (ready == streaming.size()) break;
            if (std::chrono::steady_clock::now() >= readinessDeadline) throw std::runtime_error("Only " + std::to_string(ready) + " of " + std::to_string(streaming.size()) + " stems prebuffered");
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        std::cout << "ENGINE_V3_LOADING prebuffered=" << streaming.size() << "\n" << std::flush;

        MixerRouterGraph graph(std::move(sources), productionBuses(), 32, block);
        EngineCore engine(rate, 32, block); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
        EngineRenderClient client(engine); playback::device::JuceDeviceBackend device(type, name);
        if (!device.open({ DeviceBackendKind::asio, rate, block, 32, !audible, fullDuplex }, client)) throw std::runtime_error("Device open failed: " + device.lastError().toStdString());
        if (!device.start()) throw std::runtime_error("Device start failed");
        const auto callbackDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
        while (device.status().callbacks == 0 && std::chrono::steady_clock::now() < callbackDeadline) std::this_thread::sleep_for(std::chrono::milliseconds(2));
        if (device.status().callbacks == 0) throw std::runtime_error("Dante device produced no callback within 30 seconds");
        const auto baselineStatus = device.status(); const auto baselineFrames = engine.transport().position();
        std::cout << "ENGINE_V3_TEST_READY mode=" << (audible ? "audible" : "silent") << " io=" << (fullDuplex ? "32x32" : "0x32") << " stems=" << streaming.size() << "\n" << std::flush;
        std::uint64_t minimumCallbacksPerSecond = std::numeric_limits<std::uint64_t>::max(), maximumCallbacksPerSecond = 0, stalledSeconds = 0, previousCallbacks = baselineStatus.callbacks;
        const auto wholeSeconds = static_cast<int>(std::floor(seconds));
        for (int second = 0; second < wholeSeconds; ++second) { std::this_thread::sleep_for(std::chrono::seconds(1)); const auto current = device.status().callbacks; const auto delta = current - previousCallbacks; previousCallbacks = current; minimumCallbacksPerSecond = std::min(minimumCallbacksPerSecond, delta); maximumCallbacksPerSecond = std::max(maximumCallbacksPerSecond, delta); if (delta == 0) ++stalledSeconds; }
        if (seconds > wholeSeconds) std::this_thread::sleep_for(std::chrono::duration<double>(seconds - wholeSeconds));
        device.stop(); const auto status = device.status(); device.close();
        std::uint64_t sourceUnderruns = 0; for (const auto& source : streaming) sourceUnderruns += source->telemetry().underruns;
        std::cout << "ENGINE_V3_TEST_COMPLETE callbacks=" << (status.callbacks - baselineStatus.callbacks) << " device_xruns=" << (status.xruns - baselineStatus.xruns) << " source_underruns=" << sourceUnderruns << " master_frames=" << (engine.transport().position() - baselineFrames) << " sample_rate=" << status.sampleRate << " block_frames=" << status.blockFrames << " output_channels=" << status.outputChannels << " callbacks_per_second_min=" << (wholeSeconds ? minimumCallbacksPerSecond : 0) << " callbacks_per_second_max=" << maximumCallbacksPerSecond << " stalled_seconds=" << stalledSeconds << " max_callback_ns=" << status.maximumCallbackNanoseconds << '\n';
        return status.xruns == baselineStatus.xruns && sourceUnderruns == 0 ? 0 : 5;
    } catch (const std::exception& error) { std::cerr << "ENGINE_V3_TEST_FAILED error=\"" << error.what() << "\"\n"; return 3; }
}

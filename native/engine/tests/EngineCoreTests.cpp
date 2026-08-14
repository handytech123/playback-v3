#include "EngineCore.h"
#include "DeviceBackend.h"
#include "MixerRouter.h"
#include "PlaybackSources.h"
#include "SampleRateConverter.h"
#include "StreamingSource.h"
#include "../../src/IemMixPolicy.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <new>
#include <numbers>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {
std::atomic<bool> countAllocations { false };
std::atomic<std::uint64_t> allocationCount { 0 };
}

void* operator new(std::size_t size) {
    if (countAllocations.load(std::memory_order_relaxed)) allocationCount.fetch_add(1, std::memory_order_relaxed);
    if (auto* pointer = std::malloc(size)) return pointer;
    throw std::bad_alloc();
}
void operator delete(void* pointer) noexcept { std::free(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { std::free(pointer); }

namespace {
using namespace playback::engine;

void require(bool condition, std::string_view message) {
    if (!condition) throw std::runtime_error(std::string(message));
}

class FrameSource final : public IAudioSource {
public:
    explicit FrameSource(double offset) : offset_(offset) {}
    std::uint32_t latencyFrames() const noexcept override { return 0; }
    RenderResult render(const RenderContext& context, AudioBlock64& output) noexcept override {
        if (calls_ < contexts_.size()) contexts_[calls_] = context;
        ++calls_;
        for (std::uint32_t channel = 0; channel < output.channelCount(); ++channel)
            for (std::uint32_t frame = 0; frame < context.frameCount; ++frame)
                output.channel(channel)[frame] = static_cast<double>(context.masterStartFrame + frame) + offset_ + channel * 0.25;
        return {};
    }
    const RenderContext& context(std::size_t index) const { return contexts_.at(index); }
    std::size_t calls() const noexcept { return calls_; }

private:
    double offset_ {};
    std::array<RenderContext, 64> contexts_ {};
    std::size_t calls_ {};
};

class GainProcessor final : public IAudioProcessor {
public:
    explicit GainProcessor(double gain, std::uint32_t latency = 0) : gain_(gain), latency_(latency) {}
    std::uint32_t latencyFrames() const noexcept override { return latency_; }
    void process(const RenderContext& context, AudioBlock64& block) noexcept override {
        for (std::uint32_t channel = 0; channel < block.channelCount(); ++channel)
            for (std::uint32_t frame = 0; frame < context.frameCount; ++frame) block.channel(channel)[frame] *= gain_;
    }
private:
    double gain_ {};
    std::uint32_t latency_ {};
};

class ConstantSource final : public IAudioSource {
public:
    ConstantSource(double left, double right, std::uint32_t latency = 0) : left_(left), right_(right), latency_(latency) {}
    std::uint32_t latencyFrames() const noexcept override { return latency_; }
    RenderResult render(const RenderContext& context, AudioBlock64& output) noexcept override {
        std::fill_n(output.channel(0), context.frameCount, left_);
        if (output.channelCount() > 1) std::fill_n(output.channel(1), context.frameCount, right_);
        return {};
    }
private:
    double left_ {}, right_ {};
    std::uint32_t latency_ {};
};

class SyntheticDecoder final : public IDecodeSource {
public:
    explicit SyntheticDecoder(SampleFrame length, std::atomic<bool>* stalled = nullptr, double rate = 48000.0) : length_(length), stalled_(stalled), rate_(rate) {}
    DecodeFormat format() const noexcept override { return { 2, rate_, length_ }; }
    std::uint32_t decode(SampleFrame start, std::uint32_t requested, AudioBlock64& output) override {
        if (stalled_ && stalled_->load(std::memory_order_acquire)) return 0;
        if (start < 0 || start >= length_) return 0;
        const auto count = static_cast<std::uint32_t>(std::min<SampleFrame>(requested, length_ - start));
        output.clear(requested);
        for (std::uint32_t channel = 0; channel < output.channelCount(); ++channel)
            for (std::uint32_t frame = 0; frame < count; ++frame) output.channel(channel)[frame] = (start + frame) / 32768.0 + channel;
        return count;
    }
private:
    SampleFrame length_ {};
    std::atomic<bool>* stalled_ {};
    double rate_ {};
};

class SineDecoder final : public IDecodeSource {
public:
    SineDecoder(double rate, double frequency, SampleFrame length = 200'000) : rate_(rate), frequency_(frequency), length_(length) {}
    DecodeFormat format() const noexcept override { return { 1, rate_, length_ }; }
    std::uint32_t decode(SampleFrame start, std::uint32_t requested, AudioBlock64& output) override {
        if (start < 0 || start >= length_) return 0;
        const auto count = static_cast<std::uint32_t>(std::min<SampleFrame>(requested, length_ - start));
        output.clear(requested);
        for (std::uint32_t frame = 0; frame < count; ++frame)
            output.channel(0)[frame] = std::sin(2.0 * std::numbers::pi * frequency_ * (start + frame) / rate_);
        return count;
    }
private:
    double rate_ {}, frequency_ {};
    SampleFrame length_ {};
};

void write16(std::ostream& stream, std::uint16_t value) { const char bytes[] = { static_cast<char>(value), static_cast<char>(value >> 8) }; stream.write(bytes, 2); }
void write32(std::ostream& stream, std::uint32_t value) { const char bytes[] = { static_cast<char>(value), static_cast<char>(value >> 8), static_cast<char>(value >> 16), static_cast<char>(value >> 24) }; stream.write(bytes, 4); }

std::filesystem::path writeTestWav() {
    const auto path = std::filesystem::temp_directory_path() / "playback-engine-v3-stream-test.wav";
    constexpr std::uint32_t frames = 1024, dataBytes = frames * 2;
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    stream.write("RIFF", 4); write32(stream, 36 + dataBytes); stream.write("WAVE", 4);
    stream.write("fmt ", 4); write32(stream, 16); write16(stream, 1); write16(stream, 1); write32(stream, 48000); write32(stream, 96000); write16(stream, 2); write16(stream, 16);
    stream.write("data", 4); write32(stream, dataBytes);
    for (std::uint32_t frame = 0; frame < frames; ++frame) write16(stream, static_cast<std::uint16_t>(static_cast<std::int16_t>(frame - 512)));
    return path;
}

struct Fixture {
    std::shared_ptr<FrameSource> left = std::make_shared<FrameSource>(0.125);
    std::shared_ptr<FrameSource> right = std::make_shared<FrameSource>(0.375);
    std::shared_ptr<GainProcessor> gain = std::make_shared<GainProcessor>(0.5, 32);
    EngineGraph graph { { left, right }, { gain }, 2, 512 };
    EngineCore engine { 48000.0, 2, 512 };
    LegacyTransportAdapter controls { engine.commands(), 48000.0 };
    Fixture() { engine.graphs().publish(&graph); }
};

void testOneClockAndFloat64Sum() {
    Fixture fixture;
    AudioBlock64 output(2, 512);
    require(fixture.controls.play(), "play command was not queued");
    fixture.engine.process(output, 128);
    require(fixture.left->calls() == 1 && fixture.right->calls() == 1, "both sources must render once");
    const auto a = fixture.left->context(0), b = fixture.right->context(0);
    require(a.masterStartFrame == 0 && b.masterStartFrame == 0 && a.frameCount == b.frameCount, "sources received different master ranges");
    require(output.channel(0)[127] == ((127.0 + 0.125) + (127.0 + 0.375)) * 0.5, "float64 source sum is wrong");
    require(fixture.engine.transport().position() == 128, "master clock did not advance once");
    require(fixture.graph.latencyFrames() == 32, "graph latency was not reported");
}

void testTransportAndDiscontinuities() {
    Fixture fixture;
    AudioBlock64 output(2, 512);
    fixture.controls.play(); fixture.engine.process(output, 100);
    fixture.controls.pause(); fixture.engine.process(output, 64);
    require(fixture.engine.transport().position() == 100, "pause advanced the clock");
    require(output.channel(0)[0] == 0.0, "pause did not render silence");
    const auto generation = fixture.engine.transport().generation();
    require(fixture.controls.seekSeconds(10.0), "seek command was not queued");
    fixture.engine.process(output, 1);
    require(fixture.engine.transport().position() == 480000, "paused seek was not sample exact");
    require(fixture.engine.transport().generation() == generation + 1, "seek did not invalidate buffered generations");
    fixture.controls.play(); fixture.engine.process(output, 1);
    require(fixture.engine.transport().position() == 480001, "resume did not continue from seek frame");
    fixture.controls.stop(); fixture.engine.process(output, 1);
    require(fixture.engine.transport().position() == 0 && fixture.engine.transport().state() == TransportState::stopped, "stop did not reset transport");
    require(fixture.engine.transport().generation() == generation + 2, "stop did not invalidate buffered generations");
}

std::vector<double> renderWithPattern(std::span<const std::uint32_t> pattern) {
    Fixture fixture;
    fixture.controls.play();
    return OfflineRenderer::render(fixture.engine, 2, 4097, pattern, 512);
}

void testOfflinePartitionIndependence() {
    constexpr std::array<std::uint32_t, 1> fixed { 256 };
    constexpr std::array<std::uint32_t, 5> varied { 17, 511, 64, 3, 128 };
    const auto a = renderWithPattern(fixed), b = renderWithPattern(varied);
    require(a == b, "offline output changed with block partitioning");
}

void testLongDurationPrecision() {
    Fixture fixture;
    AudioBlock64 output(2, 512);
    constexpr SampleFrame target = static_cast<SampleFrame>(48'000) * 60 * 60 * 30 + 17;
    require(fixture.engine.commands().push({ CommandType::seek, target }), "long seek was not queued");
    fixture.controls.play(); fixture.engine.process(output, 511);
    require(fixture.left->context(0).masterStartFrame == target, "source lost precision after 30 hours");
    require(fixture.engine.transport().position() == target + 511, "master clock lost precision after 30 hours");
}

void testCallbackPathDoesNotAllocate() {
    Fixture fixture;
    AudioBlock64 output(2, 512);
    fixture.controls.play();
    fixture.engine.process(output, 128); // warm-up and consume play
    allocationCount.store(0, std::memory_order_relaxed);
    countAllocations.store(true, std::memory_order_release);
    fixture.engine.process(output, 512);
    countAllocations.store(false, std::memory_order_release);
    require(allocationCount.load(std::memory_order_relaxed) == 0, "engine callback path allocated memory");
}

void testTelemetryAndUnderrun() {
    EngineCore engine(48000.0, 1, 64);
    AudioBlock64 output(1, 64);
    engine.commands().push({ CommandType::play, 0 });
    engine.process(output, 64);
    const auto telemetry = engine.telemetry().snapshot();
    require(telemetry.masterFrame == 64 && telemetry.renderedBlocks == 1 && telemetry.underruns == 1, "telemetry did not expose missing-graph underrun");
}

void testRenderingDoesNotDependOnControlProgress() {
    Fixture fixture;
    AudioBlock64 output(2, 512);
    fixture.controls.play();
    for (int block = 0; block < 10'000; ++block) fixture.engine.process(output, 64);
    require(fixture.engine.transport().position() == 640'000, "rendering stopped without control-thread activity");
    require(fixture.engine.telemetry().snapshot().renderedBlocks == 10'000, "callback telemetry lost blocks");
}

void testCommandQueueIsBoundedAndOrdered() {
    RealtimeCommandQueue<4> queue;
    require(queue.push({ CommandType::play, 1 }), "first command failed");
    require(queue.push({ CommandType::pause, 2 }), "second command failed");
    require(queue.push({ CommandType::seek, 3 }), "third command failed");
    require(!queue.push({ CommandType::stop, 4 }), "bounded queue accepted an overflowing command");
    EngineCommand command;
    require(queue.pop(command) && command.type == CommandType::play, "queue order changed");
    require(queue.pop(command) && command.type == CommandType::pause, "queue order changed");
    require(queue.pop(command) && command.type == CommandType::seek && command.targetFrame == 3, "queue payload changed");
    require(!queue.pop(command), "empty queue returned a command");
}

void testRealWavDecoder() {
    const auto path = writeTestWav();
    {
        WavPcmDecoder decoder(path.string());
        require(decoder.format().channels == 1 && decoder.format().sampleRate == 48000.0 && decoder.format().lengthFrames == 1024, "WAV metadata was decoded incorrectly");
        AudioBlock64 output(2, 64);
        require(decoder.decode(500, 64, output) == 64, "WAV frame range was not decoded");
        require(output.channel(0)[0] == -12.0 / 32768.0 && output.channel(1)[0] == output.channel(0)[0], "mono WAV did not decode and duplicate exactly");
    }
    std::filesystem::remove(path);
}

void testStreamingAndWorkerStallRecovery() {
    std::atomic<bool> stalled { true };
    auto source = std::make_shared<FileStemSource>(std::make_unique<SyntheticDecoder>(4096, &stalled), FileStemSource::Config { 2, 128, 8 });
    EngineGraph graph({ source }, {}, 2, 128);
    EngineCore engine(48000.0, 2, 128); engine.graphs().publish(&graph);
    AudioBlock64 output(2, 128);
    source->prime(0, 0); engine.commands().push({ CommandType::play, 0 }); engine.process(output, 64);
    require(output.channel(0)[0] == 0.0 && source->telemetry().underruns == 1, "worker stall did not produce deterministic silence");
    stalled.store(false, std::memory_order_release);
    require(source->waitUntilReady(std::chrono::milliseconds(500)), "stream did not recover after worker stall");
    engine.process(output, 64);
    require(output.channel(0)[0] == 64.0 / 32768.0, "recovered stream did not resume at the master frame");
}

void testSeekDropsStaleBufferedAudio() {
    auto source = std::make_shared<FileStemSource>(std::make_unique<SyntheticDecoder>(8192), FileStemSource::Config { 2, 128, 8 });
    EngineGraph graph({ source }, {}, 2, 128);
    EngineCore engine(48000.0, 2, 128); engine.graphs().publish(&graph);
    AudioBlock64 output(2, 128);
    source->prime(0, 0); require(source->waitUntilReady(std::chrono::milliseconds(500)), "initial stream did not prime");
    engine.commands().push({ CommandType::play, 0 }); engine.process(output, 64);
    engine.commands().push({ CommandType::seek, 512 }); engine.process(output, 64);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
    while (source->telemetry().generation != 1 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    require(source->waitUntilReady(std::chrono::milliseconds(500)), "seek generation did not refill");
    engine.process(output, 64);
    require(output.channel(0)[0] == 576.0 / 32768.0, "stale pre-seek audio reached the new timeline");
    require(source->telemetry().staleBlocksDropped > 0, "seek did not report stale buffer disposal");
}

void testStreamingRejectsUnconvertedSampleRates() {
    bool rejected = false;
    try { FileStemSource source(std::make_unique<SyntheticDecoder>(1024, nullptr, 44100.0), {}); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "streaming silently accepted a source that requires SRC");
}

void testThirtyStemStreamingStress() {
    std::vector<std::shared_ptr<IAudioSource>> sources;
    std::vector<std::shared_ptr<FileStemSource>> stems;
    for (int index = 0; index < 30; ++index) {
        auto stem = std::make_shared<FileStemSource>(std::make_unique<SyntheticDecoder>(100'000), FileStemSource::Config { 2, 256, 32 });
        stem->prime(0, 0); sources.push_back(stem); stems.push_back(std::move(stem));
    }
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    for (;;) {
        const bool full = std::all_of(stems.begin(), stems.end(), [](const auto& stem) { return stem->telemetry().bufferedBlocks >= 16; });
        if (full || std::chrono::steady_clock::now() >= deadline) { require(full, "30-stem graph did not prebuffer"); break; }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    EngineGraph graph(std::move(sources), {}, 2, 256);
    EngineCore engine(48000.0, 2, 256); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(2, 256);
    for (int block = 0; block < 200; ++block) { engine.process(output, 64); std::this_thread::sleep_for(std::chrono::milliseconds(1)); }
    require(engine.telemetry().snapshot().underruns == 0, "30-stem streaming graph underrun during stress test");
    require(output.channel(0)[63] == 30.0 * 12799.0 / 32768.0, "30-stem streaming sum lost synchronization");
}

void testStreamingCallbackDoesNotAllocate() {
    auto source = std::make_shared<FileStemSource>(std::make_unique<SyntheticDecoder>(4096), FileStemSource::Config { 2, 128, 8 });
    source->prime(0, 0); require(source->waitUntilReady(std::chrono::milliseconds(500)), "stream did not prime for allocation test");
    EngineGraph graph({ source }, {}, 2, 128);
    EngineCore engine(48000.0, 2, 128); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(2, 128); engine.process(output, 64);
    allocationCount.store(0, std::memory_order_relaxed); countAllocations.store(true, std::memory_order_release);
    engine.process(output, 64);
    countAllocations.store(false, std::memory_order_release);
    require(allocationCount.load(std::memory_order_relaxed) == 0, "streaming callback path allocated memory");
}

void testNamedBusAndMultichannelRouting() {
    auto music = std::make_shared<ConstantSource>(1.0, 2.0, 16);
    auto click = std::make_shared<ConstantSource>(0.5, 0.5);
    MixerRouterGraph graph(
        { { music, { { BusId::acoustic, 1.0, 0.0 }, { BusId::iem, 0.25, 0.0 } } }, { click, { { BusId::click, 1.0, 0.0 }, { BusId::iem, 1.0, 0.0 } } } },
        { { BusId::click, { { 0, 1 } } }, { BusId::iem, { { 1, 1 } } }, { BusId::acoustic, { { 10, 2 } } } },
        32, 64);
    EngineCore engine(48000.0, 32, 64); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(32, 64); engine.process(output, 64);
    require(output.channel(0)[0] == 0.5, "click bus did not reach output 1");
    require(output.channel(1)[0] == 0.875, "IEM sends were not summed to output 2");
    require(output.channel(10)[0] == 1.0 && output.channel(11)[0] == 2.0, "stereo acoustic bus did not reach outputs 11-12");
    require(output.channel(31)[0] == 0.0 && graph.outputChannels() == 32, "32-channel output block was not preserved");
    require(graph.latencyFrames() == 16, "mixer graph did not report source latency");
}

void testMixerSoloMutePanAndMeters() {
    auto left = std::make_shared<ConstantSource>(1.0, 1.0);
    auto right = std::make_shared<ConstantSource>(4.0, 4.0);
    MixerRouterGraph graph(
        { { left, { { BusId::keys, 1.0, -1.0 } }, 0.5, false, true }, { right, { { BusId::keys, 1.0, 0.0 } }, 1.0, false, false } },
        { { BusId::keys, { { 4, 2 } }, 0.5 } }, 8, 32);
    EngineCore engine(48000.0, 8, 32); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(8, 32); engine.process(output, 32);
    require(output.channel(4)[0] == 0.25 && output.channel(5)[0] == 0.0, "solo, pan, source gain, or bus gain was applied incorrectly");
    const auto meters = graph.meters();
    require(meters.sourcePeaks.size() == 2 && meters.sourcePeaks[0] == 0.5 && meters.sourcePeaks[1] == 0.0, "source meters ignored solo state");
    require(meters.masterPeak == 0.25, "master meter does not match routed output");
}

void testAutomaticIemPolicyAndIsolation() {
    require(playback::iem::stemSendEnabled(false), "unmuted stem did not enable its IEM send");
    require(!playback::iem::stemSendEnabled(true), "muted stem leaked into its IEM send");
    require(playback::iem::routeGain(2, 1, playback::iem::stemHeadroomGain) == 0.0625f, "stereo-to-mono IEM headroom is wrong");
    auto liveStem = std::make_shared<ConstantSource>(1.0, 1.0);
    auto mutedStem = std::make_shared<ConstantSource>(8.0, 8.0);
    auto click = std::make_shared<ConstantSource>(0.5, 0.5);
    MixerRouterGraph graph(
        { { liveStem, { { BusId::acoustic }, { BusId::iem, playback::iem::stemHeadroomGain } } },
          { mutedStem, { { BusId::electric }, { BusId::iem, playback::iem::stemHeadroomGain } }, 1.0, true, false },
          { click, { { BusId::click } } } },
        { { BusId::click, { { 0, 1 } } }, { BusId::iem, { { 2, 1 } } }, { BusId::acoustic, { { 5, 1 } } }, { BusId::electric, { { 6, 1 } } } },
        8, 32);
    EngineCore engine(48000.0, 8, 32); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(8, 32); engine.process(output, 32);
    require(output.channel(0)[0] == 0.5, "independent click output was changed by IEM policy");
    require(output.channel(2)[0] == playback::iem::stemHeadroomGain, "IEM did not contain exactly the unmuted stem");
    require(output.channel(5)[0] == 1.0, "normal stem output was attenuated by IEM headroom");
    require(output.channel(6)[0] == 0.0, "muted stem leaked to its normal output");
    for (const auto channel : { 1u, 3u, 4u, 7u }) require(output.channel(channel)[0] == 0.0, "signal leaked into an unassigned output");
}

void testAtomicRoutingGraphSwap() {
    auto tone = std::make_shared<ConstantSource>(1.0, 1.0);
    MixerRouterGraph first({ { tone, { { BusId::other } } } }, { { BusId::other, { { 0, 1 } } } }, 4, 16);
    MixerRouterGraph second({ { tone, { { BusId::other } } } }, { { BusId::other, { { 3, 1 } } } }, 4, 16);
    EngineCore engine(48000.0, 4, 16); engine.graphs().publish(&first); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(4, 16); engine.process(output, 16);
    require(output.channel(0)[0] == 1.0 && output.channel(3)[0] == 0.0, "first immutable route was not active");
    engine.graphs().publish(&second); engine.process(output, 16);
    require(output.channel(0)[0] == 0.0 && output.channel(3)[0] == 1.0, "routing graph did not swap at a block boundary");
}

void testMixerRoutingValidationAndNoAllocation() {
    auto tone = std::make_shared<ConstantSource>(1.0, 1.0);
    bool rejected = false;
    try { MixerRouterGraph invalid({ { tone, { { BusId::other } } } }, { { BusId::other, { { 31, 2 } } } }, 32, 64); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "router accepted an output span beyond channel 32");
    MixerRouterGraph graph({ { tone, { { BusId::other } } } }, { { BusId::other, { { 0, 2 } } } }, 2, 64);
    EngineCore engine(48000.0, 2, 64); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(2, 64); engine.process(output, 64);
    allocationCount.store(0, std::memory_order_relaxed); countAllocations.store(true, std::memory_order_release);
    engine.process(output, 64);
    countAllocations.store(false, std::memory_order_release);
    require(allocationCount.load(std::memory_order_relaxed) == 0, "mixer/router callback allocated memory");
}

void testSampleRateExactBypass() {
    auto original = std::make_unique<SyntheticDecoder>(2048);
    const auto* identity = original.get();
    auto matched = matchSampleRate(std::move(original), 48000.0, 256);
    require(matched.get() == identity && matched->latencyFrames() == 0, "matching sample rate did not take the exact bypass path");
}

void testWindowedSincRateConversionAndPartitioning() {
    auto converter = matchSampleRate(std::make_unique<SineDecoder>(44100.0, 1000.0), 48000.0, 512);
    require(converter->format().sampleRate == 48000.0 && converter->latencyFrames() > 0, "SRC format or latency was not declared");
    AudioBlock64 whole(1, 512), first(1, 256), second(1, 256);
    require(converter->decode(1000, 512, whole) == 512, "SRC did not produce the requested frames");
    converter->decode(1000, 256, first); converter->decode(1256, 256, second);
    for (std::uint32_t frame = 0; frame < 256; ++frame) {
        require(std::abs(whole.channel(0)[frame] - first.channel(0)[frame]) < 1.0e-12, "SRC changed across first partition");
        require(std::abs(whole.channel(0)[frame + 256] - second.channel(0)[frame]) < 1.0e-12, "SRC changed across second partition");
    }
}

void testDownsamplingRejectsOutOfBandAlias() {
    auto converter = matchSampleRate(std::make_unique<SineDecoder>(96000.0, 30000.0), 48000.0, 1024, 96);
    AudioBlock64 output(1, 1024); converter->decode(4096, 1024, output);
    double energy = 0.0;
    for (std::uint32_t frame = 64; frame < 960; ++frame) energy += output.channel(0)[frame] * output.channel(0)[frame];
    const auto rms = std::sqrt(energy / 896.0);
    require(rms < 0.02, "high-quality downsampling allowed an audible out-of-band alias");
}

void testSimulatedDeviceClockAndRecovery() {
    auto tone = std::make_shared<ConstantSource>(0.25, 0.25);
    EngineGraph graph({ tone }, {}, 2, 128);
    EngineCore engine(48000.0, 2, 128); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    EngineRenderClient client(engine);
    SimulatedDeviceBackend device(false);
    require(device.open({ DeviceBackendKind::simulated, 48000.0, 128, 2, true }, client), "simulated device did not open");
    device.faultAfterCallbacks(100); require(device.start(), "simulated device did not start");
    const auto faultDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(1);
    while (device.status().lifecycle != DeviceLifecycle::faulted && std::chrono::steady_clock::now() < faultDeadline) std::this_thread::yield();
    const auto faulted = device.status();
    require(faulted.lifecycle == DeviceLifecycle::faulted && faulted.callbacks >= 100, "device fault was not surfaced");
    require(device.recover(), "device did not enter recovery");
    const auto recoveryDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(1);
    while (device.status().callbacks < faulted.callbacks + 100 && std::chrono::steady_clock::now() < recoveryDeadline) std::this_thread::yield();
    device.stop();
    const auto recovered = device.status();
    require(recovered.restartCount == 1 && recovered.callbacks >= faulted.callbacks + 100, "recovered device did not resume its callback clock");
    require(engine.transport().position() == static_cast<SampleFrame>(recovered.callbacks) * 128, "master clock diverged from device callbacks");
}

std::shared_ptr<AudioClip> testClip(std::initializer_list<double> samples) {
    auto clip = std::make_shared<AudioClip>(1, static_cast<std::uint32_t>(samples.size()));
    std::copy(samples.begin(), samples.end(), clip->audio.channel(0));
    return clip;
}

void testClockOwnedClickCueAndPadSources() {
    auto click = testClip({ 1.0, 0.5, 0.25, 0.0 });
    ScheduledClipSource scheduled({ { 2, click }, { 8, click, 2, 2 } });
    AudioBlock64 output(2, 16);
    scheduled.render({ 0, 12, 48000.0, 0 }, output);
    require(output.channel(0)[2] == 1.0 && output.channel(0)[3] == 0.5 && output.channel(0)[8] == 1.0 && output.channel(0)[9] == 0.25, "scheduled click/cue clips did not follow master frames or fade limits");
    output.clear(16); scheduled.render({ 3, 5, 48000.0, 0 }, output);
    require(output.channel(0)[0] == 0.5 && output.channel(0)[1] == 0.25, "scheduled clip did not seek into the correct clip offset");

    auto padClip = testClip({ 0.1, 0.2, 0.3 });
    PadLoopSource pad(padClip); pad.setGain(2.0); pad.setEnabled(true, 10);
    pad.render({ 8, 8, 48000.0, 0 }, output);
    require(output.channel(0)[0] == 0.0 && output.channel(0)[2] == 0.2 && output.channel(0)[5] == 0.2, "pad did not activate and loop from the master frame");
}

class RecordingMidiSink final : public IMidiSink {
public:
    void send(const MidiEvent& event) override { std::scoped_lock lock(mutex); events.push_back(event); thread = std::this_thread::get_id(); }
    std::mutex mutex;
    std::vector<MidiEvent> events;
    std::thread::id thread;
};

void testMidiLeavesTheAudioThread() {
    MidiDispatchQueue<2048> queue;
    ScheduledMidiSource midi({ { 4, 0x90, 17, 1 }, { 9, 0x90, 19, 3 } }, queue);
    RecordingMidiSink sink; MidiDispatcher dispatcher(queue, sink); dispatcher.start();
    AudioBlock64 output(1, 16); const auto audioThread = std::this_thread::get_id();
    midi.render({ 0, 8, 48000.0, 0 }, output); midi.render({ 8, 8, 48000.0, 0 }, output);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(500);
    while (dispatcher.dispatchedEvents() < 2 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    dispatcher.stop(); std::scoped_lock lock(sink.mutex);
    require(sink.events.size() == 2 && sink.events[0].frame == 4 && sink.events[1].frame == 9, "MIDI scheduler lost its master-frame events");
    require(sink.thread != audioThread, "MIDI sink was called from the audio render thread");
}

void testPlaybackSourcesDoNotAllocateInRender() {
    auto clip = testClip({ 1.0, 0.5, 0.25, 0.0 }); ScheduledClipSource scheduled({ { 0, clip }, { 32, clip } });
    PadLoopSource pad(clip); pad.setEnabled(true, 0);
    AudioBlock64 output(2, 64); scheduled.render({ 0, 64, 48000.0, 0 }, output); pad.render({ 0, 64, 48000.0, 0 }, output);
    allocationCount.store(0); countAllocations.store(true);
    scheduled.render({ 64, 64, 48000.0, 0 }, output); pad.render({ 64, 64, 48000.0, 0 }, output);
    countAllocations.store(false);
    require(allocationCount.load() == 0, "scheduled playback source allocated in render");
}

void testRealtimeSimulatedDeviceTracksWallClock() {
    constexpr double rate = 48000.0; constexpr std::uint32_t blockFrames = 256;
    auto source = std::make_shared<ConstantSource>(0.0, 0.0);
    EngineGraph graph({ source }, {}, 2, blockFrames);
    EngineCore engine(rate, 2, blockFrames); engine.graphs().publish(&graph); engine.commands().push({ CommandType::play, 0 });
    EngineRenderClient client(engine); SimulatedDeviceBackend device(true);
    require(device.open({ DeviceBackendKind::simulated, rate, blockFrames, 2, true }, client), "realtime simulated device did not open");
    const auto start = std::chrono::steady_clock::now(); require(device.start(), "realtime simulated device did not start");
    std::this_thread::sleep_for(std::chrono::seconds(2)); device.stop();
    const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count(); const auto status = device.status(); device.close();
    const auto renderedSeconds = static_cast<double>(engine.transport().position()) / rate;
    require(status.xruns == 0 && status.callbacks > 300, "realtime simulated device missed callback deadlines");
    require(std::abs(renderedSeconds - elapsed) < 0.075, "engine callback clock did not track wall clock");
    require(engine.transport().position() == static_cast<SampleFrame>(status.callbacks) * blockFrames, "realtime device frames diverged from callback count");
}

void testHundredThousandRandomizedCallbacksAndGraphSwaps() {
    constexpr std::uint32_t maximumBlock = 256; constexpr std::uint64_t callbackCount = 100'000;
    auto firstSource = std::make_shared<ConstantSource>(0.25, -0.25), secondSource = std::make_shared<ConstantSource>(-0.5, 0.5);
    EngineGraph first({ firstSource }, {}, 2, maximumBlock), second({ secondSource }, {}, 2, maximumBlock);
    EngineCore engine(48000.0, 2, maximumBlock); engine.graphs().publish(&first); engine.commands().push({ CommandType::play, 0 });
    AudioBlock64 output(2, maximumBlock); std::uint32_t random = 0x5a17c9e3u; SampleFrame expected = 0; bool playing = true; std::uint64_t expectedRenderedBlocks = 1;
    engine.process(output, 1); expected = 1;
    allocationCount.store(0); countAllocations.store(true);
    for (std::uint64_t index = 0; index < callbackCount; ++index) {
        random ^= random << 13; random ^= random >> 17; random ^= random << 5; const auto frames = 1u + random % maximumBlock;
        if (index > 0 && index % 4096 == 0) { expected = static_cast<SampleFrame>(random % 5'000'000u); engine.commands().push({ CommandType::seek, expected }); }
        if (index % 997 == 0) { playing = false; engine.commands().push({ CommandType::pause, 0 }); }
        else if (index % 997 == 1) { playing = true; engine.commands().push({ CommandType::play, 0 }); }
        if (index % 3333 == 0) engine.graphs().publish((index / 3333) % 2 == 0 ? &second : &first);
        engine.process(output, frames); if (playing) { expected += frames; ++expectedRenderedBlocks; }
        if (engine.transport().position() != expected) { countAllocations.store(false); throw std::runtime_error("randomized transport diverged from expected master frame"); }
    }
    countAllocations.store(false);
    require(allocationCount.load() == 0, "randomized callback/graph-swap stress allocated in render");
    require(engine.telemetry().snapshot().renderedBlocks == expectedRenderedBlocks, "randomized callback stress lost telemetry updates");
}

} // namespace

int main() {
    const std::array tests {
        &testOneClockAndFloat64Sum,
        &testTransportAndDiscontinuities,
        &testOfflinePartitionIndependence,
        &testLongDurationPrecision,
        &testCallbackPathDoesNotAllocate,
        &testTelemetryAndUnderrun,
        &testRenderingDoesNotDependOnControlProgress,
        &testCommandQueueIsBoundedAndOrdered,
        &testRealWavDecoder,
        &testStreamingAndWorkerStallRecovery,
        &testSeekDropsStaleBufferedAudio,
        &testStreamingRejectsUnconvertedSampleRates,
        &testThirtyStemStreamingStress,
        &testStreamingCallbackDoesNotAllocate,
        &testNamedBusAndMultichannelRouting,
        &testMixerSoloMutePanAndMeters,
        &testAutomaticIemPolicyAndIsolation,
        &testAtomicRoutingGraphSwap,
        &testMixerRoutingValidationAndNoAllocation,
        &testSampleRateExactBypass,
        &testWindowedSincRateConversionAndPartitioning,
        &testDownsamplingRejectsOutOfBandAlias,
        &testSimulatedDeviceClockAndRecovery,
        &testClockOwnedClickCueAndPadSources,
        &testMidiLeavesTheAudioThread,
        &testPlaybackSourcesDoNotAllocateInRender,
        &testRealtimeSimulatedDeviceTracksWallClock,
        &testHundredThousandRandomizedCallbacksAndGraphSwaps,
    };
    try {
        for (const auto test : tests) test();
        std::cout << "PlaybackEngineCoreTests passed " << tests.size() << " tests\n";
        return 0;
    } catch (const std::exception& error) {
        countAllocations.store(false, std::memory_order_release);
        std::cerr << "PlaybackEngineCoreTests failed: " << error.what() << '\n';
        return 1;
    }
}

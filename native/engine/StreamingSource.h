#pragma once

#include "EngineCore.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <fstream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace playback::engine {

struct DecodeFormat {
    std::uint32_t channels {};
    double sampleRate {};
    SampleFrame lengthFrames {};
};

class IDecodeSource {
public:
    virtual ~IDecodeSource() = default;
    virtual DecodeFormat format() const noexcept = 0;
    virtual std::uint32_t latencyFrames() const noexcept { return 0; }
    // Called only by the source's decode worker.
    virtual std::uint32_t decode(SampleFrame startFrame, std::uint32_t requestedFrames, AudioBlock64& destination) = 0;
};

class WavPcmDecoder final : public IDecodeSource {
public:
    explicit WavPcmDecoder(const std::string& path);
    DecodeFormat format() const noexcept override { return format_; }
    std::uint32_t decode(SampleFrame startFrame, std::uint32_t requestedFrames, AudioBlock64& destination) override;

private:
    std::ifstream stream_;
    DecodeFormat format_;
    std::uint64_t dataOffset_ {};
    std::uint64_t dataBytes_ {};
    std::uint16_t encoding_ {};
    std::uint16_t bitsPerSample_ {};
    std::uint16_t blockAlign_ {};
    std::vector<std::uint8_t> encodedScratch_;
};

struct StreamTelemetrySnapshot {
    std::uint32_t bufferedBlocks {};
    std::uint64_t producedBlocks {};
    std::uint64_t consumedBlocks {};
    std::uint64_t underruns {};
    std::uint64_t staleBlocksDropped {};
    std::uint64_t generation {};
};

class FileStemSource final : public IAudioSource {
public:
    struct Config {
        std::uint32_t engineChannels { 2 };
        std::uint32_t blockFrames { 512 };
        std::uint32_t ringBlocks { 16 };
        double engineSampleRate { 48000.0 };
    };

    FileStemSource(std::unique_ptr<IDecodeSource> decoder, Config config);
    ~FileStemSource() override;
    FileStemSource(const FileStemSource&) = delete;
    FileStemSource& operator=(const FileStemSource&) = delete;

    std::uint32_t latencyFrames() const noexcept override { return decoder_->latencyFrames(); }
    RenderResult render(const RenderContext&, AudioBlock64&) noexcept override;

    void prime(SampleFrame startFrame, std::uint64_t generation) noexcept;
    bool waitUntilReady(std::chrono::milliseconds timeout) const noexcept;
    bool isReady() const noexcept;
    StreamTelemetrySnapshot telemetry() const noexcept;
    DecodeFormat sourceFormat() const noexcept { return decoder_->format(); }

private:
    struct Slot {
        Slot(std::uint32_t channels, std::uint32_t frames) : audio(channels, frames) {}
        AudioBlock64 audio;
        SampleFrame startFrame {};
        std::uint32_t frameCount {};
        std::uint32_t consumedFrames {};
        std::uint64_t generation {};
    };

    class Ring {
    public:
        Ring(std::uint32_t blocks, std::uint32_t channels, std::uint32_t frames);
        Slot* beginWrite() noexcept;
        void commitWrite() noexcept;
        Slot* beginRead() noexcept;
        void commitRead() noexcept;
        std::uint32_t size() const noexcept;

    private:
        std::uint32_t increment(std::uint32_t value) const noexcept { return (value + 1) % capacity_; }
        std::uint32_t capacity_ {};
        std::unique_ptr<Slot*[]> slots_;
        std::vector<std::unique_ptr<Slot>> ownedSlots_;
        alignas(64) std::atomic<std::uint32_t> write_ {};
        alignas(64) std::atomic<std::uint32_t> read_ {};
    };

    void request(SampleFrame frame, std::uint64_t generation) noexcept;
    void workerLoop();
    void copy(const Slot&, std::uint32_t sourceOffset, AudioBlock64&, std::uint32_t destinationOffset, std::uint32_t count) noexcept;

    std::unique_ptr<IDecodeSource> decoder_;
    Config config_;
    Ring ring_;
    std::thread worker_;
    std::atomic<bool> stop_ {};
    std::atomic<SampleFrame> requestedFrame_ { -1 };
    std::atomic<std::uint64_t> requestedGeneration_ { UINT64_MAX };
    std::atomic<std::uint64_t> observedGeneration_ { UINT64_MAX };
    std::atomic<std::uint64_t> publishedGeneration_ { UINT64_MAX };
    std::atomic<std::uint64_t> producedBlocks_ {}, consumedBlocks_ {}, underruns_ {}, staleBlocksDropped_ {};
};

} // namespace playback::engine

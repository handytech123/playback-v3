#include "StreamingSource.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>

namespace playback::engine {
namespace {

std::uint16_t read16(std::istream& stream) {
    std::uint8_t bytes[2] {};
    stream.read(reinterpret_cast<char*>(bytes), 2);
    return static_cast<std::uint16_t>(bytes[0] | (bytes[1] << 8));
}

std::uint32_t read32(std::istream& stream) {
    std::uint8_t bytes[4] {};
    stream.read(reinterpret_cast<char*>(bytes), 4);
    return static_cast<std::uint32_t>(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24));
}

double decodeInteger(const std::uint8_t* bytes, std::uint16_t bits) noexcept {
    if (bits == 16) {
        const auto value = static_cast<std::int16_t>(bytes[0] | (bytes[1] << 8));
        return static_cast<double>(value) / 32768.0;
    }
    if (bits == 24) {
        std::int32_t value = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
        if ((value & 0x800000) != 0) value |= ~0xffffff;
        return static_cast<double>(value) / 8388608.0;
    }
    const auto value = static_cast<std::int32_t>(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24));
    return static_cast<double>(value) / 2147483648.0;
}

} // namespace

WavPcmDecoder::WavPcmDecoder(const std::string& path) : stream_(path, std::ios::binary) {
    if (!stream_) throw std::runtime_error("Cannot open WAV source: " + path);
    char id[4] {};
    stream_.read(id, 4); (void) read32(stream_); char wave[4] {}; stream_.read(wave, 4);
    if (std::memcmp(id, "RIFF", 4) != 0 || std::memcmp(wave, "WAVE", 4) != 0) throw std::runtime_error("Source is not a RIFF WAV file");
    bool foundFormat = false, foundData = false;
    while (stream_ && (!foundFormat || !foundData)) {
        stream_.read(id, 4);
        if (!stream_) break;
        const auto size = read32(stream_);
        const auto chunkStart = static_cast<std::uint64_t>(stream_.tellg());
        if (std::memcmp(id, "fmt ", 4) == 0) {
            encoding_ = read16(stream_);
            format_.channels = read16(stream_);
            format_.sampleRate = read32(stream_);
            (void) read32(stream_);
            blockAlign_ = read16(stream_);
            bitsPerSample_ = read16(stream_);
            if (encoding_ == 0xfffe && size >= 40) {
                (void) read16(stream_); // extension byte count
                (void) read16(stream_); // valid bits per sample
                (void) read32(stream_); // channel mask
                encoding_ = read16(stream_); // first field of the PCM/float subtype GUID
            }
            foundFormat = true;
        } else if (std::memcmp(id, "data", 4) == 0) {
            dataOffset_ = chunkStart;
            dataBytes_ = size;
            foundData = true;
        }
        stream_.seekg(static_cast<std::streamoff>(chunkStart + size + (size & 1u)), std::ios::beg);
    }
    const bool pcm = encoding_ == 1 && (bitsPerSample_ == 16 || bitsPerSample_ == 24 || bitsPerSample_ == 32);
    const bool float32 = encoding_ == 3 && bitsPerSample_ == 32;
    if (!foundFormat || !foundData || format_.channels == 0 || format_.sampleRate <= 0 || blockAlign_ == 0 || (!pcm && !float32))
        throw std::runtime_error("WAV format is unsupported; expected PCM16/24/32 or float32");
    format_.lengthFrames = static_cast<SampleFrame>(dataBytes_ / blockAlign_);
}

std::uint32_t WavPcmDecoder::decode(SampleFrame startFrame, std::uint32_t requestedFrames, AudioBlock64& destination) {
    if (startFrame < 0 || startFrame >= format_.lengthFrames) return 0;
    const auto count = static_cast<std::uint32_t>(std::min<SampleFrame>(requestedFrames, format_.lengthFrames - startFrame));
    const auto bytes = static_cast<std::size_t>(count) * blockAlign_;
    if (encodedScratch_.size() < bytes) encodedScratch_.resize(bytes);
    stream_.clear();
    stream_.seekg(static_cast<std::streamoff>(dataOffset_ + static_cast<std::uint64_t>(startFrame) * blockAlign_), std::ios::beg);
    stream_.read(reinterpret_cast<char*>(encodedScratch_.data()), static_cast<std::streamsize>(bytes));
    const auto readFrames = static_cast<std::uint32_t>(stream_.gcount() / blockAlign_);
    destination.clear(requestedFrames);
    const auto bytesPerSample = bitsPerSample_ / 8;
    for (std::uint32_t frame = 0; frame < readFrames; ++frame) {
        for (std::uint32_t outputChannel = 0; outputChannel < destination.channelCount(); ++outputChannel) {
            const auto sourceChannel = std::min(outputChannel, format_.channels - 1);
            const auto* sample = encodedScratch_.data() + static_cast<std::size_t>(frame) * blockAlign_ + sourceChannel * bytesPerSample;
            double value {};
            if (encoding_ == 3) {
                float decoded {};
                std::memcpy(&decoded, sample, sizeof(decoded));
                value = decoded;
            } else value = decodeInteger(sample, bitsPerSample_);
            destination.channel(outputChannel)[frame] = value;
        }
    }
    return readFrames;
}

FileStemSource::Ring::Ring(std::uint32_t blocks, std::uint32_t channels, std::uint32_t frames)
    : capacity_(blocks + 1), slots_(std::make_unique<Slot*[]>(blocks + 1)) {
    if (blocks < 2) throw std::invalid_argument("Streaming ring requires at least two usable blocks");
    ownedSlots_.reserve(capacity_);
    for (std::uint32_t index = 0; index < capacity_; ++index) {
        ownedSlots_.push_back(std::make_unique<Slot>(channels, frames));
        slots_[index] = ownedSlots_.back().get();
    }
}

FileStemSource::Slot* FileStemSource::Ring::beginWrite() noexcept {
    const auto write = write_.load(std::memory_order_relaxed);
    if (increment(write) == read_.load(std::memory_order_acquire)) return nullptr;
    return slots_[write];
}
void FileStemSource::Ring::commitWrite() noexcept { write_.store(increment(write_.load(std::memory_order_relaxed)), std::memory_order_release); }
FileStemSource::Slot* FileStemSource::Ring::beginRead() noexcept {
    const auto read = read_.load(std::memory_order_relaxed);
    if (read == write_.load(std::memory_order_acquire)) return nullptr;
    return slots_[read];
}
void FileStemSource::Ring::commitRead() noexcept { read_.store(increment(read_.load(std::memory_order_relaxed)), std::memory_order_release); }
std::uint32_t FileStemSource::Ring::size() const noexcept {
    const auto write = write_.load(std::memory_order_acquire), read = read_.load(std::memory_order_acquire);
    return write >= read ? write - read : capacity_ - read + write;
}

FileStemSource::FileStemSource(std::unique_ptr<IDecodeSource> decoder, Config config)
    : decoder_(std::move(decoder)), config_(config), ring_(config.ringBlocks, config.engineChannels, config.blockFrames) {
    if (!decoder_ || config.engineChannels == 0 || config.blockFrames == 0) throw std::invalid_argument("FileStemSource configuration is invalid");
    if (std::abs(decoder_->format().sampleRate - config.engineSampleRate) > 0.001)
        throw std::invalid_argument("FileStemSource sample rate differs from the engine; SRC is not available until Phase 4");
    worker_ = std::thread([this] { workerLoop(); });
}

FileStemSource::~FileStemSource() {
    stop_.store(true, std::memory_order_release);
    if (worker_.joinable()) worker_.join();
}

void FileStemSource::request(SampleFrame frame, std::uint64_t generation) noexcept {
    requestedFrame_.store(std::max<SampleFrame>(0, frame), std::memory_order_relaxed);
    requestedGeneration_.store(generation, std::memory_order_release);
}

void FileStemSource::prime(SampleFrame startFrame, std::uint64_t generation) noexcept { request(startFrame, generation); }

bool FileStemSource::isReady() const noexcept {
    return ring_.size() > 0 && publishedGeneration_.load(std::memory_order_acquire) == requestedGeneration_.load(std::memory_order_acquire);
}

bool FileStemSource::waitUntilReady(std::chrono::milliseconds timeout) const noexcept {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (!isReady() && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return isReady();
}

void FileStemSource::copy(const Slot& slot, std::uint32_t sourceOffset, AudioBlock64& output, std::uint32_t destinationOffset, std::uint32_t count) noexcept {
    for (std::uint32_t channel = 0; channel < output.channelCount(); ++channel)
        std::copy_n(slot.audio.channel(channel) + sourceOffset, count, output.channel(channel) + destinationOffset);
}

RenderResult FileStemSource::render(const RenderContext& context, AudioBlock64& output) noexcept {
    output.clear(context.frameCount);
    if (requestedGeneration_.load(std::memory_order_acquire) != context.discontinuityGeneration) request(context.masterStartFrame, context.discontinuityGeneration);
    std::uint32_t written = 0;
    while (written < context.frameCount) {
        auto* slot = ring_.beginRead();
        if (!slot) break;
        if (slot->generation != context.discontinuityGeneration) {
            ring_.commitRead(); staleBlocksDropped_.fetch_add(1, std::memory_order_relaxed); continue;
        }
        const auto expected = context.masterStartFrame + written;
        const auto availableStart = slot->startFrame + slot->consumedFrames;
        const auto availableEnd = slot->startFrame + slot->frameCount;
        if (availableEnd <= expected) {
            ring_.commitRead(); staleBlocksDropped_.fetch_add(1, std::memory_order_relaxed); continue;
        }
        if (availableStart > expected) break;
        const auto sourceOffset = static_cast<std::uint32_t>(expected - slot->startFrame);
        const auto count = std::min(context.frameCount - written, slot->frameCount - sourceOffset);
        copy(*slot, sourceOffset, output, written, count);
        written += count;
        slot->consumedFrames = sourceOffset + count;
        if (slot->consumedFrames == slot->frameCount) { ring_.commitRead(); consumedBlocks_.fetch_add(1, std::memory_order_relaxed); }
    }
    const bool underrun = written != context.frameCount;
    if (underrun) underruns_.fetch_add(1, std::memory_order_relaxed);
    return { underrun };
}

StreamTelemetrySnapshot FileStemSource::telemetry() const noexcept {
    return { ring_.size(), producedBlocks_.load(std::memory_order_relaxed), consumedBlocks_.load(std::memory_order_relaxed),
             underruns_.load(std::memory_order_relaxed), staleBlocksDropped_.load(std::memory_order_relaxed),
             observedGeneration_.load(std::memory_order_acquire) };
}

void FileStemSource::workerLoop() {
    std::uint64_t generation = UINT64_MAX;
    SampleFrame nextFrame = 0;
    while (!stop_.load(std::memory_order_acquire)) {
        const auto requestedGeneration = requestedGeneration_.load(std::memory_order_acquire);
        if (requestedGeneration == UINT64_MAX) { std::this_thread::sleep_for(std::chrono::milliseconds(1)); continue; }
        if (requestedGeneration != generation) {
            generation = requestedGeneration;
            nextFrame = requestedFrame_.load(std::memory_order_relaxed);
            observedGeneration_.store(generation, std::memory_order_release);
        }
        auto* slot = ring_.beginWrite();
        if (!slot) { std::this_thread::sleep_for(std::chrono::milliseconds(1)); continue; }
        const auto decoded = decoder_->decode(nextFrame, config_.blockFrames, slot->audio);
        if (decoded == 0) { std::this_thread::sleep_for(std::chrono::milliseconds(1)); continue; }
        // Discard work completed after a seek instead of publishing stale audio.
        if (requestedGeneration_.load(std::memory_order_acquire) != generation) continue;
        slot->startFrame = nextFrame;
        slot->frameCount = decoded;
        slot->consumedFrames = 0;
        slot->generation = generation;
        ring_.commitWrite();
        publishedGeneration_.store(generation, std::memory_order_release);
        producedBlocks_.fetch_add(1, std::memory_order_relaxed);
        nextFrame += decoded;
    }
}

} // namespace playback::engine

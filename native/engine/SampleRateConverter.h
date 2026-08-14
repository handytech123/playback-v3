#pragma once

#include "StreamingSource.h"

#include <cstdint>
#include <memory>

namespace playback::engine {

class ISampleRateConverter : public IDecodeSource {
public:
    virtual bool bypassed() const noexcept = 0;
};

class WindowedSincRateConverter final : public ISampleRateConverter {
public:
    WindowedSincRateConverter(std::unique_ptr<IDecodeSource> source,
                              double targetSampleRate,
                              std::uint32_t maximumOutputFrames,
                              std::uint32_t taps = 64);
    DecodeFormat format() const noexcept override { return targetFormat_; }
    std::uint32_t latencyFrames() const noexcept override { return latencyFrames_; }
    std::uint32_t decode(SampleFrame startFrame, std::uint32_t requestedFrames, AudioBlock64& destination) override;
    bool bypassed() const noexcept override { return false; }

private:
    std::unique_ptr<IDecodeSource> source_;
    DecodeFormat sourceFormat_;
    DecodeFormat targetFormat_;
    std::uint32_t taps_ {};
    std::uint32_t latencyFrames_ {};
    std::uint32_t maximumOutputFrames_ {};
    AudioBlock64 sourceScratch_;
};

// Returns the original decoder unchanged for a matching rate. This is the
// exact bypass path: no filter, sample copy, or latency is introduced.
std::unique_ptr<IDecodeSource> matchSampleRate(std::unique_ptr<IDecodeSource> source,
                                              double targetSampleRate,
                                              std::uint32_t maximumOutputFrames,
                                              std::uint32_t taps = 64);

} // namespace playback::engine

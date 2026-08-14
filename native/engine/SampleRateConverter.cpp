#include "SampleRateConverter.h"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace playback::engine {
namespace {
double sinc(double value) noexcept { return std::abs(value) < 1.0e-12 ? 1.0 : std::sin(std::numbers::pi * value) / (std::numbers::pi * value); }
}

WindowedSincRateConverter::WindowedSincRateConverter(std::unique_ptr<IDecodeSource> source,
                                                     double targetSampleRate,
                                                     std::uint32_t maximumOutputFrames,
                                                     std::uint32_t taps)
    : source_(std::move(source)), sourceFormat_(source_ ? source_->format() : DecodeFormat {}),
      taps_(taps), maximumOutputFrames_(maximumOutputFrames),
      sourceScratch_(sourceFormat_.channels,
          static_cast<std::uint32_t>(std::ceil(maximumOutputFrames * sourceFormat_.sampleRate / targetSampleRate)) + taps + 4) {
    if (!source_ || !std::isfinite(targetSampleRate) || targetSampleRate <= 0.0 || maximumOutputFrames == 0 || taps < 16 || (taps & 1u) != 0 || taps > 256)
        throw std::invalid_argument("Sample-rate converter configuration is invalid");
    targetFormat_ = { sourceFormat_.channels, targetSampleRate,
        static_cast<SampleFrame>(std::llround(sourceFormat_.lengthFrames * targetSampleRate / sourceFormat_.sampleRate)) };
    latencyFrames_ = static_cast<std::uint32_t>(std::ceil((taps / 2.0) * targetSampleRate / sourceFormat_.sampleRate));
}

std::uint32_t WindowedSincRateConverter::decode(SampleFrame startFrame, std::uint32_t requestedFrames, AudioBlock64& destination) {
    if (requestedFrames > maximumOutputFrames_) throw std::invalid_argument("SRC request exceeds its prepared block size");
    if (startFrame < 0 || startFrame >= targetFormat_.lengthFrames) return 0;
    const auto outputFrames = static_cast<std::uint32_t>(std::min<SampleFrame>(requestedFrames, targetFormat_.lengthFrames - startFrame));
    destination.clear(requestedFrames);
    const auto ratio = sourceFormat_.sampleRate / targetFormat_.sampleRate;
    const auto half = static_cast<std::int64_t>(taps_ / 2);
    const auto firstPosition = startFrame * ratio;
    const auto lastPosition = (startFrame + outputFrames - 1) * ratio;
    const auto sourceStart = static_cast<SampleFrame>(std::floor(firstPosition)) - half + 1;
    const auto sourceEnd = static_cast<SampleFrame>(std::floor(lastPosition)) + half + 1;
    const auto clampedStart = std::max<SampleFrame>(0, sourceStart);
    const auto clampedEnd = std::min(sourceFormat_.lengthFrames, sourceEnd);
    const auto sourceFrames = static_cast<std::uint32_t>(std::max<SampleFrame>(0, clampedEnd - clampedStart));
    sourceScratch_.clear(sourceScratch_.capacityFrames());
    const auto decoded = source_->decode(clampedStart, sourceFrames, sourceScratch_);
    const auto cutoff = std::min(1.0, targetFormat_.sampleRate / sourceFormat_.sampleRate) * 0.94;
    for (std::uint32_t outputFrame = 0; outputFrame < outputFrames; ++outputFrame) {
        const auto position = (startFrame + outputFrame) * ratio;
        const auto center = static_cast<SampleFrame>(std::floor(position));
        for (std::uint32_t channel = 0; channel < destination.channelCount(); ++channel) {
            const auto sourceChannel = std::min(channel, sourceScratch_.channelCount() - 1);
            double value = 0.0, weightSum = 0.0;
            for (std::int64_t tap = -half + 1; tap <= half; ++tap) {
                const auto absoluteFrame = center + tap;
                if (absoluteFrame < clampedStart || absoluteFrame >= clampedStart + decoded) continue;
                const auto distance = position - absoluteFrame;
                const auto windowPosition = distance / half;
                if (std::abs(windowPosition) > 1.0) continue;
                const auto window = 0.5 * (1.0 + std::cos(std::numbers::pi * windowPosition));
                const auto weight = cutoff * sinc(cutoff * distance) * window;
                value += sourceScratch_.channel(sourceChannel)[absoluteFrame - clampedStart] * weight;
                weightSum += weight;
            }
            destination.channel(channel)[outputFrame] = std::abs(weightSum) > 1.0e-12 ? value / weightSum : 0.0;
        }
    }
    return outputFrames;
}

std::unique_ptr<IDecodeSource> matchSampleRate(std::unique_ptr<IDecodeSource> source,
                                              double targetSampleRate,
                                              std::uint32_t maximumOutputFrames,
                                              std::uint32_t taps) {
    if (!source) throw std::invalid_argument("SRC source is required");
    if (std::abs(source->format().sampleRate - targetSampleRate) < 0.001) return source;
    return std::make_unique<WindowedSincRateConverter>(std::move(source), targetSampleRate, maximumOutputFrames, taps);
}

} // namespace playback::engine

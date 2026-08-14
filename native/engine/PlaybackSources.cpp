#include "PlaybackSources.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <stdexcept>

namespace playback::engine {

ScheduledClipSource::ScheduledClipSource(std::vector<ScheduledAudioEvent> events) : events_(std::move(events)) {
    for (const auto& event : events_) if (!event.clip) throw std::invalid_argument("Scheduled clip event is missing audio");
    std::sort(events_.begin(), events_.end(), [](const auto& left, const auto& right) { return left.startFrame < right.startFrame; });
}

RenderResult ScheduledClipSource::render(const RenderContext& context, AudioBlock64& output) noexcept {
    output.clear(context.frameCount);
    const auto blockEnd = context.masterStartFrame + context.frameCount;
    for (auto event = events_.begin(); event != events_.end() && event->startFrame < blockEnd; ++event) {
        const auto length = event->maximumFrames > 0 ? std::min(event->maximumFrames, event->clip->frames) : event->clip->frames;
        const auto eventEnd = event->startFrame + length;
        if (eventEnd <= context.masterStartFrame) continue;
        const auto sourceOffset = static_cast<std::uint32_t>(std::max<SampleFrame>(0, context.masterStartFrame - event->startFrame));
        const auto destinationOffset = static_cast<std::uint32_t>(std::max<SampleFrame>(0, event->startFrame - context.masterStartFrame));
        const auto count = std::min(length - sourceOffset, context.frameCount - destinationOffset);
        for (std::uint32_t channel = 0; channel < output.channelCount(); ++channel) {
            const auto sourceChannel = std::min(channel, event->clip->audio.channelCount() - 1);
            for (std::uint32_t frame = 0; frame < count; ++frame) {
                const auto clipFrame = sourceOffset + frame;
                const auto fade = event->fadeFrames > 0 && clipFrame >= length - std::min(event->fadeFrames, length)
                    ? static_cast<double>(length - clipFrame) / std::min(event->fadeFrames, length) : 1.0;
                output.channel(channel)[destinationOffset + frame] += event->clip->audio.channel(sourceChannel)[clipFrame] * fade;
            }
        }
    }
    return {};
}

void PadLoopSource::setEnabled(bool enabled, SampleFrame activationFrame) noexcept {
    activationFrame_.store(std::max<SampleFrame>(0, activationFrame), std::memory_order_relaxed);
    enabled_.store(enabled, std::memory_order_release);
}

RenderResult PadLoopSource::render(const RenderContext& context, AudioBlock64& output) noexcept {
    output.clear(context.frameCount);
    if (!clip_ || clip_->frames == 0 || !enabled_.load(std::memory_order_acquire)) return {};
    const auto activation = activationFrame_.load(std::memory_order_relaxed);
    const auto gain = gain_.load(std::memory_order_acquire);
    for (std::uint32_t frame = 0; frame < context.frameCount; ++frame) {
        const auto absolute = context.masterStartFrame + frame;
        if (absolute < activation) continue;
        const auto clipFrame = static_cast<std::uint32_t>((absolute - activation) % clip_->frames);
        for (std::uint32_t channel = 0; channel < output.channelCount(); ++channel)
            output.channel(channel)[frame] = clip_->audio.channel(std::min(channel, clip_->audio.channelCount() - 1))[clipFrame] * gain;
    }
    return {};
}

ScheduledMidiSource::ScheduledMidiSource(std::vector<MidiEvent> events, MidiDispatchQueue<2048>& queue) : events_(std::move(events)), queue_(queue) {
    std::sort(events_.begin(), events_.end(), [](const auto& left, const auto& right) { return left.frame < right.frame; });
}

RenderResult ScheduledMidiSource::render(const RenderContext& context, AudioBlock64& output) noexcept {
    output.clear(context.frameCount);
    const auto end = context.masterStartFrame + context.frameCount;
    auto event = std::lower_bound(events_.begin(), events_.end(), context.masterStartFrame, [](const MidiEvent& candidate, SampleFrame frame) { return candidate.frame < frame; });
    while (event != events_.end() && event->frame < end) { if (!queue_.push(*event)) dropped_.fetch_add(1, std::memory_order_relaxed); ++event; }
    return {};
}

MidiDispatcher::MidiDispatcher(MidiDispatchQueue<2048>& queue, IMidiSink& sink) : queue_(queue), sink_(sink) {}
MidiDispatcher::~MidiDispatcher() { stop(); }
void MidiDispatcher::start() { if (!stop_.exchange(false)) return; worker_ = std::thread([this] { loop(); }); }
void MidiDispatcher::stop() noexcept { stop_.store(true, std::memory_order_release); if (worker_.joinable()) worker_.join(); }
void MidiDispatcher::loop() { while (!stop_.load(std::memory_order_acquire)) { MidiEvent event; if (queue_.pop(event)) { sink_.send(event); dispatched_.fetch_add(1, std::memory_order_relaxed); } else std::this_thread::sleep_for(std::chrono::milliseconds(1)); } }

} // namespace playback::engine

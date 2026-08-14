#pragma once

namespace playback::iem {

constexpr float stemHeadroomGain = 0.125f;
constexpr bool stemSendEnabled(bool muted) noexcept { return !muted; }
constexpr float routeGain(int sourceChannels, int destinationChannels, float sendGain = 1.0f) noexcept {
    return sendGain * (destinationChannels == 1 && sourceChannels > 1 ? 0.5f : 1.0f);
}

} // namespace playback::iem

# GLD two-way MIDI control

Playback uses the M-Audio MIDISPORT Uno in both directions for the Allen & Heath
GLD-112. App mix changes and song recalls continue through the Uno MIDI output.
The matching Uno MIDI input is reserved by the native engine so physical console
fader and mute changes can update the Performance mixer.

## Scope

- MIDI channel 2 by default, following the saved GLD connection.
- Only explicitly mapped Playback returns are accepted: drums 10, bass 12,
  acoustic 14, electric 16, keys 36, orchestra 37, vocals 39, other 41, and
  Dynamic Pad 33.
- GLD faders use the console's 7-bit NRPN sequence and full -infinity to +10 dB
  scale. Mutes use the GLD note messages already used for outgoing control.
- Main LR, DCA, Click, Cue, IEM, scenes, colors, other MIDI channels, unmapped
  inputs, incomplete NRPN sequences, and stale sequences are ignored.
- Console changes update every app channel belonging to that Playback bus. The
  native mixer receives the new value while IEM selection remains unchanged.
- A feedback-originated change is not echoed back to the console. App-originated
  changes and saved-song recalls still transmit normally.
- Feedback is active only while Surface Mixer is ON and armed. Surface Mixer OFF
  continues to mean no console/app mix control. Playback transport is never
  stopped because a feedback message is missing or invalid.

The GLD input is selected before the native engine's initial song arm and is
saved in `device-settings.json`. When GLD-only levels are enabled, the generic
foot-controller setting cannot take the Uno input away. Enabling Surface Mixer
fails safely if the matching input is unavailable.

## Verification

Automated coverage checks the exact GLD fader and mute messages, channel and
mapping filters, stale/incomplete sequences, full-scale conversion, startup
ordering, echo suppression, and visible two-way status. The full JavaScript
suite passes 255 tests. An independently packaged application passes the full
release integrity audit (74 programming files, 19 preserved release files, 38
production packages), and the packaged decoder runs successfully under Electron
43.2.0.

Physical acceptance requires Playback to be closed, the candidate installed,
then one mapped GLD return moved while Surface Mixer is ON. Confirm that the
matching app fader follows, a different GLD input does not move the app, and an
app fader still moves the physical return.

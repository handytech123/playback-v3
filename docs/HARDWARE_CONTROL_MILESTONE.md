# MIDI Input And GLD-112 Hardware Control Milestone

Status: **AWAITING PHYSICAL ACCEPTANCE**

## Completed In Code

- Native JUCE MIDI-input discovery and capture.
- Persistent, independently selectable MIDI input device.
- MIDI events leave the native process as bounded control events; they never enter or block the audio callback.
- Disabled-by-default foot-controller profile with note-off rejection and 120 ms duplicate/debounce protection.
- The Basic Notes profile maps MIDI channel 1 notes 20-26 to Play/Pause, Stop, Panic, Previous, Next, Loop Current, and Cue Next.
- Foot-controller actions enter the same serialized command bus as UI, Remote, and OSC.
- GLD-112 mixer intents are isolated from the core playback engine.
- Official GLD V1.4 encoders cover Input/Mix/DCA/FX strip addressing, Mute, Fader, and Scene messages.
- Fader dB conversion follows the official -inf through +10 dB value table rather than a guessed linear percentage.
- The Stage Control panel provides MIDI input/profile selection and GLD host/channel, exact-message preview, and connection-only testing.
- GLD connection testing opens TCP port 51325 and closes it without sending a payload.
- The GLD write method is hard-locked in code.

## Verified Locally

- Native discovery found Focusrite USB MIDI, loopMIDI Port, and Playback V3 to ProPresenter.
- The native engine armed with loopMIDI Port as an input while the real Cornerstone package was loaded.
- 72 unit/integration tests pass.
- Official examples pass byte-exact tests, including Input 1 Mute On (`90 20 7F 90 20 00`) and Input 1 at 0 dB (`B0 63 20 B0 62 17 B0 06 6B`) on MIDI channel 1.
- A local TCP fixture proved connection testing transmits zero bytes.
- Electron acceptance verified all three MIDI inputs, disabled-by-default profile, GLD preview, and the locked-write state.

## Physical Acceptance Required From Luis

The remaining gate cannot be truthfully completed without the GLD-112 and intended foot controller:

1. Connect the Playback computer and GLD to the same production control network.
2. Confirm the GLD IP address.
3. Confirm the GLD Setup / Control / MIDI channel and enter the same channel in Playback.
4. Use `REMOTE` -> `TEST CONNECTION`; this sends no MIDI payload.
5. Choose one non-critical test strip and confirm its GLD strip type/number.
6. After explicit approval, unlock one learned Mute test, verify on/off, then one Fader test.
7. Connect the intended foot controller, select its MIDI input, arm the Basic Notes profile, and verify each physical switch while stopped before live use.

Until those checks pass, no GLD command can be transmitted. Audio and ProPresenter operation remain independent of this gate.

## Protocol Authority

Message construction follows Allen & Heath's `GLD MIDI and TCP/IP Protocol V1.4`, firmware V1.4 and later. The official document specifies MIDI-format control over TCP port 51325, requires matching the GLD MIDI channel, and defines the strip/message tables used here.

# Playback V3 0.1.56 — August 26, 2026

Complete Windows x64 installer; an existing Playback installation is not needed.

## Included programming

- Safari iOS 9.3.5 remote compatibility, with newer tablet support retained.
  The operator confirmed the old iPad works.
- GLD bus mix save/recall, all mapped bus controls, console dB scales and colors.
- Surface Mixer ON controls arming; OFF gates console commands. Unsaved songs
  hold levels without requiring another arm action. Surface failures do not
  stop playback.
- Independent pre-fader IEM sends, including functioning per-channel switches.
- Performance/editor mixer sizing, expanded waveform colors/backgrounds,
  stationary mute/solo controls, visible integration switches, Export WAV in Settings.
- Stem-only readiness blocking, with missing annotations/optional assets reported
  without blocking Performance/Confirm Set.
- Audio-device output count/matrix refresh and successful device fault recovery.
- ProPresenter connection/upload fixes and native MIDI/SysEx handling.

## Bundled runtime

Electron and its libraries, native PlaybackEngineProbe, FFmpeg with the Rubber
Band filter, Rubber Band executable, sndfile.dll, and the three required MSVC
runtime DLLs are included. No Node, Python, FFmpeg, CMake, or Visual Studio
installation is required on the destination PC.

Audio interface/Dante/MIDI drivers and their licenses remain external. Select the
destination machine's hardware and configure its library folders and network
connections in Settings. Songs, user tokens, saved mixes, and the church PC's
device settings are not embedded in a general installer. Existing user settings
are not deliberately reset by this release.

## Validation

- 216 JavaScript tests pass against the exact release runtime.
- Both native CTest targets pass after a fresh x64 rebuild.
- Bundled engine and audio tools pass smoke checks with development PATH removed;
  checks do not open an audio device or send MIDI.
- Package hook verifies preserved programming, production modules, runtime hashes,
  x64 binaries, licenses, and absence of private user data/development tests.
- The setup executable must also be extracted and checked before distribution.

These checks do not replace testing the destination PC's specific drivers and
hardware. The installer is not code-signed, so Windows may show a publisher warning.

See RELEASE_RUNTIME.md for the guarded bridge preserving fixes originally made
to the installed application. Future builds fail if source changes without
reconciling that bridge.

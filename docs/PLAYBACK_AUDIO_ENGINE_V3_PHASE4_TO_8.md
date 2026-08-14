# Playback Audio Engine V3 — Phases 4–8

## Production audio policy

Playback V3 uses a hybrid policy:

- Library and edit workflows may accept WAV or M4A at differing sample rates.
- Confirm Set converts every performance stem, click, cue, and pad to PCM24 WAV at 48 kHz.
- The live engine opens only the confirmed local package. It does not decode compressed audio, run FFmpeg, run Rubber Band, or change sample rate while playing.
- Key and tempo changes are rendered once in Prep with Rubber Band, after the arrangement is assembled. Confirm Set then canonicalizes the result.
- The native sample-rate converter remains available for offline preparation, diagnostics, and controlled compatibility work. Matching sample rates take an exact bypass.

This gives operators flexible imports while keeping the performance path small and deterministic.

## Phases 4–7

`SampleRateConverter` provides a windowed-sinc converter, latency reporting, partition-independent streaming, and exact bypass. The JUCE backend supports ASIO and Windows audio devices, float64 boundary conversion, hard-silent testing, and callback/xrun telemetry. Click, cues, pad loops, stems, and scheduled MIDI share the master sample-frame clock; MIDI dispatch occurs on its own worker. Tests cover clocks, partitions, seeks, graph swaps, routing, underruns, SRC, source timing, MIDI dispatch, and callback allocations.

Home Dante validation passed on Dante Virtual Soundcard (x64), 48 kHz, 256 frames, 32 outputs for 10 seconds: 1,875 callbacks, zero device xruns. The full application suite has 150 passing tests and the native suite has 25.

## Phase 8 — migration and acceptance

`PlaybackEngineV3Test` loads a real confirmed-set manifest and routes the 12 production buses into a 32-output graph. It is silent unless `--audible` is explicitly supplied. The installed engine remains the production default until the audible church acceptance test passes.

### Church checklist

1. Confirm DVS is at 48 kHz and the expected 32-channel Dante subscription is present.
2. Close Playback V3 so it releases the ASIO driver.
3. Run the test script silently; require zero device xruns and source underruns.
4. Lower console gains, notify everyone, then run the explicitly confirmed audible test.
5. Listen to outputs 1–12: click, cue, IEM, pad, drums, bass, acoustic, electric, keys, strings, vocals, other.
6. Check Start, Stop, Seek, song end, pad loop, click/cue timing, and a key-changed song.
7. Reopen Playback V3. Do not switch the default engine if routing, timing, recovery, or audio quality is wrong.

Use `tools/run-engine-v3-church-test.ps1`. Audible mode requires both `-Audible` and `-ConfirmAudible`.

# Playback Audio Engine V3 — Phase 2 Streaming

Status: **Streaming prototype implemented; isolated from production playback**
Started: 2026-08-14

## What now exists

Phase 2 adds a worker-backed `FileStemSource` to the isolated engine core.

Each stem currently owns:

- A decoder that is used only by its worker thread.
- A fixed number of preallocated audio blocks.
- A lock-free single-producer/single-consumer ring.
- Absolute source-frame metadata on every block.
- A transport discontinuity generation on every block.
- Atomic fill, production, consumption, stale-drop, and underrun telemetry.

The callback only examines published block metadata, copies available samples, drops stale blocks, returns silence for missing frames, and updates atomic counters. It never performs file I/O, waits for the worker, locks a mutex, resizes a buffer, or asks the decoder to catch up.

## WAV support

`WavPcmDecoder` reads RIFF WAV sources on the decode worker and currently supports:

- PCM16
- PCM24
- PCM32 integer
- IEEE float32
- Mono and multichannel sources

Mono input is duplicated when the engine requests more output channels. Source and engine sample rates must currently match. A mismatched source is rejected explicitly because high-quality SRC belongs to Phase 4; the engine never plays a mismatched source at the wrong speed.

## Seek and jump safety

Every seek, stop, or future jump changes the master transport's discontinuity generation. `FileStemSource` requests the new absolute frame and generation from its worker. The worker does not publish decoded work if the generation changed while decoding.

The callback discards any queued block whose generation does not match the current `RenderContext`. Until correct-generation data arrives, the source returns silence and records an underrun. Old audio can therefore never leak across a seek boundary.

## Proven behavior

Native tests now prove:

1. Real PCM16 WAV metadata and samples decode correctly.
2. A deliberately stalled worker never blocks the engine.
3. A stalled stream returns deterministic silence and increments underrun telemetry.
4. Playback recovers at the current master frame after the worker resumes.
5. Pre-seek buffered blocks are discarded after a generation change.
6. A recovered seek uses the new absolute timeline rather than continuing stale audio.
7. Mismatched sample rates are rejected until SRC exists.
8. Thirty independently streamed stems remain synchronized without underruns in the native stress test.
9. The streaming callback path performs zero heap allocations after preparation.
10. The Phase 1 clock, transport, float64, offline, and command tests continue to pass.

## Current limitations

- The streaming source is not connected to `PlaybackEngineProbe` or Electron.
- The prototype uses one worker thread per stem. A bounded worker pool may be preferable after profiling real church storage and 30-stem workloads.
- There is no high-quality SRC yet.
- There is no read coalescing or OS-specific asynchronous file API.
- EOF and permanent decode faults need richer state than repeated silence/underrun reporting.
- A production readiness gate must require enough current-generation frames before Play.
- Ring-buffer sizes and low-water thresholds are not yet configurable from production settings.

## Next engineering slice

Phase 3 should construct the named mixer/router on top of the same float64 graph:

```text
FileStemSource / Click / Cue / Pad
  -> stem channel
  -> named Playback bus
  -> immutable hardware-output route
  -> float64 output block
```

Routing changes must be built off-thread and atomically activated at a block boundary. The callback must not mutate route containers or acquire the JUCE mixer locks used by the existing engine.

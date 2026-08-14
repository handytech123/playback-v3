# Playback Audio Engine V3 — Phase 3 Mixer and Router

Status: **Mixer/router implemented; isolated from production playback**
Started: 2026-08-14

## What now exists

Phase 3 adds an immutable float64 mixer and multichannel router to the isolated engine core.

The processing path is now:

```text
IAudioSource
  -> source gain / mute / solo
  -> one or more named bus sends
  -> send gain / stereo pan
  -> named float64 bus sum
  -> bus gain / mute / solo
  -> one or more mono/stereo hardware spans
  -> 1–32 channel float64 output block
```

## Named Playback buses

The native engine defines the same stable vocabulary used by the application:

- Click
- Cue
- IEM
- Acoustic
- Electric
- Bass
- Keys
- Strings
- Drums
- Vocals
- Other
- Pad

A source may send to more than one bus. For example, click can feed both the Click hardware output and the IEM bus without duplicating or independently clocking the source.

## Immutable routing

`MixerRouterGraph` validates and prepares all source sends, buses, scratch buffers, gains, pans, and hardware spans before publication. The callback never adds a mixer input, resizes a route container, or changes destination fields in place.

A complete graph is published through `GraphPublisher` with an atomic pointer exchange. The callback observes either the complete old graph or the complete new graph at the beginning of an audio block. Published graphs remain alive until the device is stopped or a later graph-retirement epoch declares them safe.

## Mixing behavior

- Internal source, bus, and hardware-output buffers use float64.
- Mono routes downmix a stereo bus with equal 0.5 contributions.
- Stereo routes preserve left and right channels.
- Pan uses a balance law: center preserves both channels, full left suppresses right, and full right suppresses left.
- Multiple sources and buses may sum into the same destination through normal float64 addition.
- Source and bus solo states are compiled into the immutable graph.
- Source, bus, and master peaks are published atomically for non-realtime readers.
- The graph reports the largest source latency. Delay compensation remains a later processing task.

## Proven behavior

Native tests now prove:

1. Click, IEM, and stereo music buses reach their configured hardware channels.
2. A single source can feed its main bus and IEM simultaneously.
3. Source gain, bus gain, pan, mute/solo selection, and metering produce the expected values.
4. A complete route changes atomically at an audio block boundary.
5. A 32-channel output block is preserved and addressable.
6. Invalid mono/stereo spans beyond output 32 are rejected before publication.
7. Source latency is surfaced by the mixer graph.
8. The mixer/router callback path performs zero heap allocations after construction.
9. All Phase 1 clock tests and Phase 2 streaming tests continue to pass.

## Current limitations

- Production `GlobalBusRouting` has not yet been adapted into `MixerRouterGraph` definitions.
- The new graph is not connected to an ASIO or WASAPI callback.
- Gains, mute, solo, pan, and routes are immutable for the life of a graph. Live changes currently require constructing and publishing a replacement graph.
- Smooth parameter ramps and click-free graph transitions need a realtime-safe parameter/snapshot design before production migration.
- Per-path latency compensation is not implemented.
- Device sample format conversion remains outside the core.

## Next engineering slice

Phase 4 should introduce `ISampleRateConverter` behind the streaming decoder boundary:

- Exact bypass when source and engine rates match.
- High-quality 44.1, 48, and 96 kHz conversion.
- Declared converter latency.
- Generation-safe seek/reset behavior.
- Offline numerical and spectral reference tests.
- Quality and CPU comparison before selecting a permanent implementation.

Pitch shifting and time warping remain out of scope. Phase 4 is sample-rate conversion only.

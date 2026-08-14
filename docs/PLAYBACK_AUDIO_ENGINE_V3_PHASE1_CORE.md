# Playback Audio Engine V3 — Phase 1 Core

Status: **Foundation implemented; isolated from production playback**
Started: 2026-08-14

## What now exists

The new engine foundation lives in `native/engine` and builds as the independent `PlaybackEngineCore` static library. The existing `PlaybackEngineProbe` remains unchanged and remains the production fallback.

The core currently provides:

- A single `int64` master sample position.
- Play, pause, stop, and sample-exact seek behavior.
- A discontinuity generation incremented by seek and stop.
- One `RenderContext` frame range delivered to every source in a block.
- Preallocated planar float64 audio blocks.
- An allocation-free source sum and processor pass.
- Source and processor latency reporting contracts.
- Immutable graph topology with atomic pointer publication.
- A bounded single-producer/single-consumer command queue.
- Coherent lock-free telemetry snapshots.
- A compatibility adapter for the existing transport vocabulary.
- Deterministic offline rendering using the same `EngineCore::process` path intended for a future device callback.

## Proven behavior

Native tests currently prove:

1. Multiple sources receive the same master start frame and frame count.
2. Float64 source summing and processing produce the expected numerical result.
3. Pause advances no frames and outputs silence.
4. Resume continues from the exact paused or sought frame.
5. Seek and stop increment the discontinuity generation.
6. Stop resets the master position to zero.
7. Offline output is bit-identical across different block-size partitions.
8. Frame positions remain exact beyond 30 hours at 48 kHz.
9. The warmed callback-facing process path performs zero heap allocations.
10. Rendering continues for 10,000 blocks without control-thread activity.
11. The command queue is bounded and preserves FIFO order.
12. Missing-graph underruns produce silence and telemetry rather than blocking.

## Deliberate limitations

This is the Phase 1 foundation, not a replacement player yet. It does not currently:

- Read or decode WAV files.
- Own ASIO, WASAPI, or waveOut devices.
- Implement worker threads or ring buffers.
- Perform SRC.
- Implement named buses or hardware-output routing.
- Schedule click, cues, pads, or MIDI.
- Perform latency compensation between unequal paths.
- Serialize the versioned command/state protocol.
- Replace `ArmedSetEngine` in the application.

Those items belong to later phases. Keeping them out now lets the clock and real-time contracts be tested without device, disk, or JUCE graph behavior obscuring failures.

## Lifetime rule for graph publication

The callback observes an atomically published graph pointer. A published graph must remain alive until the device is stopped or a future epoch-based retirement system confirms that no callback can still reference it. Phase 1 deliberately avoids reference-count changes or destruction on the callback thread.

## Next engineering slice

Phase 2 should add one `FileStemSource` prototype backed by:

- A dedicated decode worker.
- A fixed-capacity single-producer/single-consumer ring buffer.
- Source-frame and discontinuity-generation tags.
- Explicit low-water and underrun counters.
- Deterministic silence on missing data.
- Seek flushing without stale-frame playback.

The first Phase 2 test should stream synthetic decoded blocks through the ring buffer while deliberately stalling the worker. The callback must never wait, and recovery must resume only with frames from the current discontinuity generation.

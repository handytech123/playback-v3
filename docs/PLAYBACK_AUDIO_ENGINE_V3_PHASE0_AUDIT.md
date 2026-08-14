# Playback Audio Engine V3 — Phase 0 Audit

Status: **Phase 0 complete**
Audit date: 2026-08-14
Scope: current native playback process, its Electron boundary, and the contract for the replacement engine. This phase changes documentation only; it does not change native runtime behavior.

## Executive decision

Build Playback Audio Engine V3 as a new native subsystem and migrate the application to it behind a versioned command/state boundary. Do not continue expanding `ArmedSetEngine` into the target architecture.

The current probe proved the product workflow: it keeps a device open, arms prepared stems, supports current/next song loading, schedules click/cue/MIDI, and routes multiple outputs. It is a useful behavioral reference and migration fallback. Its JUCE `AudioSource` graph, however, cannot satisfy the new real-time contract without structural replacement because clock ownership, source position, callback locking, allocation, precision, and telemetry are coupled inside one 497-line implementation.

Pitch shifting and time warping remain outside the live-engine scope. Prepared key-changed stems continue to be rendered in the prep lane.

## Current system map

```text
Electron / TypeScript
  NativeEngineClient
    stdin commands / stdout telemetry
      PlaybackEngineProbe process
        ArmedSetEngine
          JUCE AudioDeviceManager
            AudioSourcePlayer
              TransportGate
                GainRampAudioSource (master)
                  MixerAudioSource
                    AudioTransportSource per stem
                    scheduled click
                    scheduled cues and recovery cues
                    looping pad transport
                    scheduled ProPresenter MIDI
                      selected JUCE output device
```

### Process and control boundary

- Electron starts one child process with a confirmed-set path, device selection, routing, MIDI selection, and initial song index.
- Commands are whitespace-delimited lines over stdin. State, meters, MIDI input, readiness, and failures are line-oriented stdout messages.
- The child process owns audio after startup; Electron polling or rendering is not required to advance audio.
- The protocol is unversioned, has no command IDs, and acknowledges only some commands. Parsing quoted paths is command-specific.
- Status is polled rather than published as a coherent versioned snapshot.

### Device layer

- JUCE is compiled with `JUCE_ASIO=1`, and application device ranking already prefers ASIO.
- The implementation opens devices through `AudioDeviceManager`, attempts requested channel counts, and falls back through 32/16/8/6/2 outputs.
- ASIO is therefore available, but it is not yet an explicit engine backend with an ASIO-specific state machine, recovery policy, sample-rate contract, block-size contract, or underrun telemetry.
- WASAPI and waveOut are exposed indirectly through JUCE device types rather than through a declared backend policy.

### Transport and clock

- `TransportGate::renderedSamples` is the closest current equivalent to a master sample position. It advances from the device callback and is used by status reporting and duration clamping.
- Every `AudioTransportSource` still owns its own playback position. `play()`, `seek()`, and `stop()` reposition each transport individually.
- Click, cues, recovery cues, and MIDI each maintain separate atomic positions that are set from the gate during transport commands and then advance independently per callback.
- This normally starts sources together because the mixer invokes them within the same callback, but it is not the target invariant: sources do not render from an immutable `(masterStartFrame, frameCount)` request.
- There is no discontinuity generation number to prevent stale buffered data from a pre-seek timeline being consumed after a seek or jump.

### Source loading and buffering

- Stem and pad files use `AudioTransportSource` with a shared high-priority `TimeSliceThread` and a 32,768-sample read-ahead buffer.
- The next song is preloaded, but all of its stems share that same worker with the active song.
- Click and cue assets are decoded completely into memory during arm/preload.
- Scheduled-asset sample-rate conversion is an in-house linear interpolator.
- Stem rate conversion is delegated implicitly to JUCE `AudioTransportSource`; its quality, latency, and bypass behavior are not represented in an engine contract.
- There are no per-source fill-level metrics, low-water marks, starvation counters, or deterministic underrun behavior.

### Processing and mix

- The graph uses JUCE `AudioBuffer<float>` and float gains/summing: the live path is 32-bit floating point, not float64.
- Gain ramps, mute, solo, panic attenuation, master gain, peak meters, and per-source routing are implemented.
- There is no processor interface and no `latencyFrames()` contract.
- A fixed +6 dB global output trim is applied after the full mix. It must be preserved deliberately or removed deliberately during migration, never lost accidentally.

### Routing

- Routing already follows much of the desired vocabulary: stems are assigned to hardware outputs, with dedicated click, cue, pad, and IEM destinations.
- Routing writes mutable destination integers on the command thread while the callback reads them. Those fields are neither atomic nor swapped as an immutable graph, producing a C++ data race during live routing updates.
- The graph routes sources directly to hardware destinations. It does not yet represent stable stem-to-bus and bus-to-output stages as separate objects.

## Real-time safety findings

The target rule is: the device callback may only consume prepared frames, process fixed memory, sum, route, update lock-free telemetry, and write device buffers.

| Finding | Current evidence | Severity | Target remedy |
|---|---|---:|---|
| Callback takes blocking locks | JUCE `AudioSourcePlayer`, `MixerAudioSource`, and `AudioTransportSource` each use `ScopedLock` in their callback paths | Critical | Own the device callback directly; use immutable graph snapshots and lock-free command exchange |
| Callback may allocate/resize | `RoutedAudioSource::getNextAudioBlock` resizes scratch storage; JUCE mixer/player also call `AudioBuffer::setSize` in callbacks | Critical | Preallocate all scratch/output memory for the maximum negotiated block and channel count |
| MIDI I/O occurs in audio callback | `ScheduledMidiSource::getNextAudioBlock` calls `MidiOutput::sendMessageNow` | Critical | Push timestamped MIDI events to a non-audio dispatcher or device-supported scheduled output |
| Mutable routing data race | callback reads destinations while command thread writes ordinary integers | Critical | Build and atomically publish immutable routing snapshots at block boundaries |
| Multiple source clocks | every transport and scheduled source advances its own position | High | Pass the authoritative master frame range into every source render call |
| No underrun contract | read-ahead exists, but starvation is neither counted nor surfaced | High | Per-source ring-buffer counters, fill telemetry, silence policy, and fault thresholds |
| Source graph mutation | mixer inputs are added/removed around song selection using lock-based JUCE containers | High | Prepare a complete graph off-thread and atomically activate it while stopped or at a safe boundary |
| Float32 mix path | all source, scratch, gain, and sum buffers are float | Medium | Decode/convert into float64 processing buffers and convert only at the device boundary |
| Linear SRC for scheduled assets | click/cue assets use manual two-point interpolation | Medium | Shared high-quality SRC interface with explicit bypass and latency |
| Unbounded callback work | scheduled click/cue callback scans every event in the song for every block | Medium | Sorted event cursor or bounded scheduler keyed to the master frame range |
| Telemetry allocation | meter/status paths return newly allocated vectors on the command thread | Low | Fixed-size lock-free telemetry snapshot; allocation remains outside callback |

## What can be retained

- JUCE device discovery and ASIO integration, subject to a dedicated backend wrapper.
- Confirmed-set preparation and the rule that performance consumes isolated local assets.
- Existing TypeScript command semantics and higher-level `PerformanceSession` behavior as migration requirements.
- Current routing vocabulary and one-based operator-facing output numbering.
- Mixer fader curve, gain limits, click/cue/pad behavior, panic behavior, and ProPresenter semantics.
- Existing executable verification fixtures and the old engine as a temporary fallback.

## What must be replaced

- `ArmedSetEngine` as the central owner of transport, loading, mixing, routing, scheduling, and device policy.
- The nested JUCE `AudioSource`/`MixerAudioSource` callback graph.
- Independent `AudioTransportSource` timeline ownership.
- Mutable in-place routing and graph changes.
- Callback-time immediate MIDI transmission.
- Implicit SRC and unmeasured buffering.
- The unversioned line protocol as the long-term engine API.

## Target subsystem contract

### Thread ownership

| Thread/domain | Owns | Must not do |
|---|---|---|
| Device callback | master frame advancement, fixed-buffer DSP, float64 sum, routing, device conversion | locks, allocation, files, JSON, logging, device enumeration, MIDI API calls |
| Control thread | command validation, state transitions, graph publication, telemetry serialization | modify callback-owned mutable state in place |
| Decode workers | file reads, decode, source-rate conversion, ring-buffer fill | access output buffers or advance transport |
| MIDI dispatcher | timestamped ProPresenter output and device recovery | determine musical time independently |
| Loader/preparation workers | manifest parsing, source validation, current/next graph construction | publish partial graphs |

### Master transport

The only authoritative musical clock is:

```cpp
using SampleFrame = std::int64_t;

struct RenderContext {
    SampleFrame masterStartFrame;
    std::uint32_t frameCount;
    double engineSampleRate;
    std::uint64_t discontinuityGeneration;
};
```

Rules:

1. The device callback advances `masterSamplePosition` exactly once per rendered engine frame while playing.
2. Sources never advance a private musical clock; they render the frame range in `RenderContext`.
3. Seek, jump, stop, song selection, and device restart increment `discontinuityGeneration`.
4. Buffered source blocks carry their generation and source-frame range. Stale generations are discarded.
5. Click, cue, pad, MIDI scheduling, meters, and UI position derive from the same frame range.

### Source contract

```cpp
class IAudioSource {
public:
    virtual ~IAudioSource() = default;
    virtual SourceFormat format() const noexcept = 0;
    virtual std::uint32_t latencyFrames() const noexcept = 0;
    virtual RenderResult render(const RenderContext&, AudioBlock64&) noexcept = 0;
};
```

Initial implementations:

- `FileStemSource`
- `ClickSource`
- `CueSource`
- `PadSource`

`render()` is `noexcept`, bounded, allocation-free, lock-free, and filesystem-free. A missing frame range returns deterministic silence plus an underrun flag; it never blocks.

### Processing and latency

- Engine sample format: planar float64.
- Default engine rate: 48,000 Hz, negotiated explicitly with the backend.
- Every processor reports fixed or current latency in engine frames.
- The graph compiler calculates per-path compensation before publication.
- SRC is behind an interface, reports latency, and bypasses exactly when source and engine rates match.
- Live pitch/time processing is not an initial processor.

### Routing

```text
audio source -> stem channel -> named bus -> hardware output span
```

- Routing graphs are immutable after publication.
- A routing change constructs a new validated snapshot off-thread and swaps it at a block boundary.
- The initial contract supports 32 output channels and mono/stereo route spans; capacities are compile-time or startup-time bounded.

### Backend policy

1. ASIO is the production backend.
2. WASAPI is the supported fallback.
3. waveOut remains a legacy/debug fallback during migration only.
4. Backend state includes device identity, active channels, sample rate, block size, clock status, callback load, xrun count, restart count, and last fault.
5. A device failure transitions through explicit `faulted -> recovering -> ready` states; it never silently changes the engine timeline.

### Offline rendering

The graph must run without an audio device:

```text
same sources + same processing + same routing
  -> deterministic blocks
  -> WAV sink
```

The offline path is not a separate renderer. It drives the same master transport and graph using a deterministic block size. Device-format conversion is replaced by a WAV sink.

## Versioned control/state boundary

Phase 1 should introduce a typed internal protocol even if stdin/stdout remains the transport temporarily.

Required command envelope:

```json
{"protocol":1,"id":42,"type":"transport.play","payload":{}}
```

Required response envelope:

```json
{"protocol":1,"id":42,"ok":true,"stateRevision":108}
```

Required state properties include engine lifecycle, transport state, master frame, sample rate, device block size, active graph ID, song ID, discontinuity generation, source readiness, buffer fill/underruns, routing revision, callback timing, MIDI readiness, and last fault.

Migration may initially adapt these envelopes to the current `NativeEngineClient`; replacing the child-process transport is not a Phase 1 requirement.

## Phase 1 implementation slice

Phase 1 builds an isolated core library plus tests. It does not replace live church playback.

### Deliverables

1. `native/engine/` library separated from the executable entry point.
2. `MasterTransport` with explicit state machine and `int64` frame position.
3. `RenderContext`, `AudioBlock64`, `IAudioSource`, and `IAudioProcessor` contracts.
4. Immutable `EngineGraph` and atomic graph publication mechanism.
5. Synthetic test sources and an offline WAV/memory sink.
6. Fixed-capacity real-time command queue and telemetry snapshot.
7. A compatibility adapter proving that existing play/pause/stop/seek semantics map onto the new transport.
8. Architecture tests built without requiring Dante or any physical device.

### Acceptance criteria

- No callback-facing method performs allocation, locking, filesystem access, JSON parsing, logging, or OS MIDI calls.
- One 64-bit frame counter determines every source request.
- Pause advances zero frames; resume continues from the same frame.
- Stop returns to frame zero and increments the discontinuity generation.
- Seek and jump publish exact target frames and invalidate stale source data.
- Two or more synthetic sources receive identical render ranges for every block.
- Float64 summing is verified numerically.
- Offline output is deterministic across repeated runs and different block partitions.
- An intentionally stalled control thread does not interrupt offline/realtime render progression.
- Tests cover positions beyond 24 hours at 48 kHz without precision loss.
- Existing native engine remains buildable and usable as the fallback.

## Later phases and gates

### Phase 2 — Streaming

Per-source decode workers, bounded ring buffers, generation-aware seek flushing, fill telemetry, deterministic underrun handling, and 20–30 stem stress tests.

### Phase 3 — Mixer and router

Named buses, immutable route snapshots, float64 gain/pan/sum, mute/solo/IEM, meters, and 32-channel offline routing verification.

### Phase 4 — SRC

Quality evaluation and selection behind `ISampleRateConverter`; automatic exact bypass; latency and reference tests for 44.1/48/96 kHz sources.

### Phase 5 — Device backends

Direct ASIO production path, WASAPI fallback, temporary waveOut fallback, device recovery state machine, callback deadline/xrun telemetry, and Dante acceptance.

### Phase 6 — Playback features

Click, cues, pad, mixer controls, MIDI dispatch, panic, section jumps, loops, current/next graph transition, and existing UI/remote command compatibility.

### Phase 7 — Verification

Offline reference/null tests, synchronization tests, 20–30 stem load, long-duration clock tests, Electron 500 ms freeze test, device interruption, ASIO underrun test, and church hardware acceptance.

### Phase 8 — Migration

Feature flag and fallback selection, dual-engine comparison telemetry, staged production rollout, and eventual retirement of `PlaybackEngineProbe` only after the new engine passes the complete production matrix.

## Immediate next action

Start Phase 1 by extracting no current runtime behavior. Add the isolated engine-core target and prove the clock/source/offline contracts with synthetic tests first. The first implementation milestone is not “play a WAV”; it is “render multiple sources from one exact frame range with a callback-safe API and deterministic output.”

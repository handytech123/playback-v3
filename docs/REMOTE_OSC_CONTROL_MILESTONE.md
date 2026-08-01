# Remote And OSC Control Milestone

Status: **COMPLETE**

## Implemented Boundary

Playback V3 now has one serialized command bus between every operator command and the live performance session. UI, remote HTTP, and OSC commands use the same normalized command types and return the same authoritative state. None of these adapters run in the native audio callback or preparation lane.

The built-in responsive Stage Remote provides:

- Live set/song, clock, current region, readiness, Panic, and Loop state.
- Play, Pause, Stop, Previous, Next, Cue Next, Loop, Repeat Once, and Panic.
- All prepared regions with live highlighting.
- Deliberate double-tap region jump during normal playback.
- Single-tap recovery selection while Panic is active.
- Server-sent live state updates at a bounded ten updates per second.

The desktop `REMOTE` panel provides the current remote link, HTTP/OSC ports, copy-link action, LAN enable/disable, and OSC enable/disable. Settings and the private token persist outside song metadata.

## Safety

- Remote HTTP commands require a private bearer token.
- LAN binding is off by default; local testing binds only to `127.0.0.1`.
- LAN OSC packets require the private token as their first OSC argument.
- Commands are validated and serialized before reaching Performance.
- Adapter errors return a rejection without stopping or blocking audio.
- The remote can only address songs and regions inside the immutable Confirmed Set.

## OSC Contract

Supported addresses:

- `/playback/play`, `/playback/pause`, `/playback/stop`, `/playback/panic`
- `/playback/next`, `/playback/previous`, `/playback/cue-next`
- `/playback/recover <regionId>`
- `/playback/jump <regionId>`
- `/playback/loop <regionId>`
- `/playback/repeat <regionId>`
- `/playback/song <zeroBasedIndex>`
- `/playback/bus/<music|click|cue|pad> <0|1>`
- `/playback/gain/<music|click|cue|pad> <0.0..1.25>`

When LAN mode is enabled, prepend the private token to the argument list.

## Verification

- Command validation, serialization, state revision, and OSC codec tests pass.
- HTTP authorization, command acknowledgement, state reads, responsive page delivery, and LAN OSC token rejection/acceptance pass.
- Electron acceptance opens the operator Remote panel and dispatches a real authenticated Stop through the running native-backed app.
- Phone-size visual acceptance at 390 × 844 passed.
- Live browser acceptance proved clock movement, single-tap selection, double-tap jump arming, and Stop-to-zero.

## Later Board Adapter Boundary

ProPresenter output is already complete. MIDI input/footswitch profiles and the Allen & Heath GLD-112 adapter remain a later hardware-control milestone. GLD commands will be generated from mixer intents using Allen & Heath's official GLD V1.4 MIDI/TCP protocol and must pass a harmless connection/test screen against the physical console before live writes are enabled. They are intentionally not guessed or enabled by this remote milestone.

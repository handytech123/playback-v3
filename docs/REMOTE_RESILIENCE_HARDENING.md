# Remote resilience hardening — 2026-08-26

## Scope and deployment

This pass runs on `hardening/remote-resilience-20260826`, based on release commit
`7dca1b3`. It does not install or launch the candidate application, change saved
mixes or routing, send MIDI, or replace the existing Dropbox installer. Network
tests use loopback addresses and mock playback effects only. The independent
package build runs library checks using Electron's Node mode, not the desktop UI.

## Reproduced and corrected failures

- A throwing state subscriber could report a successful transport action as
  failed. A throwing result subscriber could reject the entire acknowledgment
  and hide the original playback error. Subscriber errors and rejected promises
  are now isolated, other subscribers still receive updates, and diagnostics are
  limited to once per subscriber. Command ordering and action execution remain
  unchanged.
- Remote startup failures could strand resources; shutdown could wait on a
  tablet that never finished a request. HTTP/UDP startup rolls back on failure,
  shutdown disconnects unfinished sockets, and the same server can restart.
- Slow/disconnected live-event clients could retain updates or interfere with
  command publication. A blocked client now retains only the latest pending
  snapshot and is disconnected if it does not drain. Peer failures are isolated.
- Malformed, partial, excessive, and aborted requests are contained before
  dispatch. Overload returns an explicit rejection; rejected commands are never
  retried or replayed by the server.
- Remote waveform loading now has bounded concurrency and an LRU cache. Atomic
  file replacement invalidates cached data, corrupt files affect only their
  waveform request, and an old in-flight read cannot refill a closed cache.

None of these network failure paths calls playback stop, changes readiness
rules, alters IEM behavior, or changes GLD recall. Explicit, authenticated Stop
commands retain their normal behavior.

## Default limits

| Resource | Limit / behavior |
| --- | --- |
| Command body | 64 KiB; 10-second body timeout |
| Pending remote/OSC commands | 32; excess HTTP commands return 429 |
| Live-event clients | 32; excess clients can still poll state |
| Blocked event output | One latest pending snapshot; disconnect after 10 seconds |
| Concurrent distinct waveform reads | 8; matching reads share work |
| Individual waveform | 8 MiB; validate at most 100,000 finite min/max buckets |
| Waveform cache | 16 entries / 16 MiB of source data |

The cache byte limit measures serialized source bytes, not total JavaScript heap.
Parsing and object overhead add memory; the soak checks actual heap separately.
These limits protect the remote service; they do not block song playback or set
confirmation. Authorization remains required, and pages cannot forward access
tokens through referrers or be framed by other sites.

## Build and dependency protection

The command bus was previously supplied by a compiled release override. Before
retiring it, the typed source was reconciled with that override: its mixer-channel
gain ceiling remains `3.1622776601683795` (+10 dB); the master/general bus ceiling
remains 1.25. Normalized transpiled output matched before the observer fix.
Only the two reviewed source hashes changed. The other 18 release overrides and
their integrity guards remain intact.

A deliberately isolated package made with a shared `node_modules` junction
exposed missing transitive dependencies that the old top-level check missed.
That package was rejected and was never distributed. Package verification now
walks the complete required dependency graph, handling nested/scoped packages,
cycles, and optional dependencies. A second check executes XML parsing, ZIP
roundtrip, and QR PNG generation using the packaged Electron runtime with a
restricted PATH.

The existing extracted Dropbox 0.1.56 release passes both new checks. A fresh
candidate built in an independent worktree using `npm ci` also passes: 73
programming files, 38 production packages, preserved overrides, native engine,
runtime DLLs, and bundled audio tools. This is a package check, not a claim of
hardware or clean-machine acceptance testing. No new setup executable was
distributed during this pass.

## Verification and repeatability

- Full JavaScript regression suite: 252 passed.
- Command bus, remote server, and legacy/modern tablet tests in Electron 43.2.0:
  38 passed. Legacy tests verify ES5 parsing, authenticated XHR, touch gestures,
  and invalid-token behavior; modern tests retain pointer events and reconnects.
- The same 38 Electron tests passed 25 consecutive runs (950 test executions)
  to exercise connection timing and cleanup repeatedly.
- Both existing native CTest suites passed; native code is unchanged.
- A smoke test loaded the actual ASAR's remote server, command bus, and session
  through the packaged executable. Authenticated HTTP, unauthorized rejection,
  live SSE updates, mock Play, and restart while mock playback remained active
  all passed with zero Stop calls. Packaged remote and command-bus bytes match
  the compiled modules used by the regression suite and long soak.
- Real HTTP tests cover live events after the initial response, slow TCP output,
  chunked/multibyte oversize bodies, partial request aborts, bind failures,
  restarts, queue rejection, invalid waveforms, and cache retirement.

Run the isolated soak after the normal backend build:

```powershell
node --expose-gc tools/soak-remote-resilience.mjs 900
```

It generates temporary waveforms and mock sessions, stresses reads and commands,
reconnects live events, aborts partial requests, and repeatedly restarts the
remote. It asserts bounded caches/queues, exact command counts, zero stop calls,
and less than 64 MiB heap growth after warmup. The report is written to
`artifacts/remote-soak-report.json` with hashes of the exact compiled modules
tested. No real audio device, GLD, production token, or live-app port is used.

The 900.031-second run passed with 54,686 HTTP requests, 8,965 live-event
reconnects, 89 server restarts, and 448 aborted partial requests. Exactly 8,965
mock Play and 8,965 mock Pause actions ran; zero Stop actions ran. Sampled heap
after explicit garbage collection peaked at 12 MiB. These figures describe the
isolated remote workload, not the full desktop application's memory usage.

Tested compiled SHA-256 values:

```text
remote-server.js  5fef634a9d60174212ca6b1f87df6b7176c4aac3e5075ea3585dccff0f2b33cb
command-bus.js    3d0b8e8dfaf0349797b44a82d6f77ab64552eae451e7e958de69cf5053cec57a
```

The remaining rollout check is a brief real-tablet acceptance test after this
branch is included in a future installer. Actual old-iPad Safari hardware was
not exercised during this isolated pass.

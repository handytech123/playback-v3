# Playback V3 Stabilization Directive

## Goal

Playback V3 must become boringly reliable. An operator must be able to load a set, start a song, jump and repeat sections, continue, change songs, and recover from mistakes without thinking about the audio engine.

## Change policy

- Do not add significant features unless specifically instructed.
- Preserve known-good behavior. A fix for one subsystem must not silently break another.
- Before changing working architecture, identify the working behavior, its owning subsystem, every behavior that could regress, and the exact defect being corrected.
- Make the smallest reasonable change. Do not combine unrelated refactoring with a production fix.
- Run the relevant permanent regression tests after every change.
- Version `0.1.25`, commit `3e5adba`, is the stabilization-entry rollback baseline.

## Priority order

1. Stem/click synchronization
2. Transport reliability
3. Section jump, repeat, and continue reliability
4. Cue reliability
5. Song transitions and setlist workflow
6. Fast recovery from failures
7. Performance and CPU stability
8. UI and workflow improvements

## Priority-zero invariant

Playable stems, generated click, generated cues, and the musical grid must remain synchronized. The invariant must survive initial playback, pause/resume, stop/replay, song reload, section jumps, repeat/continue, song transitions, long playback, and rapid user commands. Timing must be checked programmatically at sample/frame accuracy wherever practical.

## Permanent known-good suite

The permanent suite contains representative coverage for:

- standard count-in;
- pickup/Measure 0;
- generated click and generated cues;
- section jumps;
- repeat and continue;
- key transposition with unchanged duration and event timing;
- REAPER/RPP-derived structure;
- Ableton Live/ALS-derived structure;
- long-duration playback;
- rapid command sequences, song loading, transitions, failure recovery, and PB_IEM route isolation.

Every reasonably reproducible rehearsal or field failure must first become a failing automated regression test, then receive the smallest fix. If automation is impossible, add a repeatable hardware acceptance check. A bug is not closed until a guardrail can detect its return.

## Failure classification

- **P0 — Production blocker:** audio corruption, engine crash, click/stem desynchronization, incorrect musical position, or unrecoverable playback failure.
- **P1 — Major:** incorrect jump or cue, repeat/continue failure, song-load failure, unreliable transport, or major on-the-fly workflow failure.
- **P2 — Operational:** slow workflow, rehearsal-impacting UI problem, confusing state, or recoverable control problem.
- **P3 — Enhancement:** cosmetic changes, convenience features, and new capabilities. Deferred unless specifically authorized.

P0 and P1 take priority throughout stabilization.

## Performance evidence

Monitor CPU, memory, audio-buffer deadlines, xruns/dropouts, disk I/O where relevant, command latency, song-load latency, sample rate, clock progress, and PB_IEM overload state. Record typical and worst-case values. Do not blame CPU without measurements that correlate resource pressure with the failure. Distinguish application logic, audio architecture, computer resources, prepared content/storage, Dante/ASIO/clock configuration, and combinations of those causes.

## Rehearsal-ready gate

Before Thursday, the candidate must pass automated tests, the permanent stabilization suite, performance checks, the complete workflow simulation, and a separate simulation of the actual Sunday set. The workflow is: build/confirm setlist, load, play, jump, repeat, continue, pause/resume, stop/restart, stop, next song, transpose where applicable, then play complete songs.

Thursday rehearsal is a production-validation environment, not the primary debugging environment. A new field failure must record the build, song and musical position, preceding action, expected and actual result, audio/clock/routing symptoms, diagnostics, and recovery result. Reproduce it outside rehearsal before fixing it.

## Progress

Progress means fewer regressions and failures, reliable synchronized playback, successful regression-suite runs, successful full-set simulations, fast safe recovery, and successful rehearsals—not feature count.


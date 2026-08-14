# Stabilization Test Matrix

This matrix identifies the permanent known-good evidence run by `npm run verify:stabilization`.

| Requirement | Permanent automated evidence |
|---|---|
| Count-in | `test/count-in.test.ts`, `test/cue-schedule.test.ts` |
| Pickup / Measure 0 | `test/performance-readiness.test.ts` musical-preroll case; `test/arrangement-editor.test.ts` source lead-in case |
| Generated click | `test/grid.test.ts`, native `testClockOwnedClickCueAndPadSources` |
| Generated cues | `test/cue-schedule.test.ts`, native `testClockOwnedClickCueAndPadSources` |
| Section jumps | `test/performance-session.test.ts` jump/recovery cases |
| Repeat / continue | `test/performance-session.test.ts` loop, Repeat Once, cancellation, and recovery cases |
| Key transposition | `test/app-arrangement.test.ts` exact-duration and single Rubber Band pass cases |
| REAPER/RPP structure | `test/rpp-import.test.ts` and arrangement preparation cases |
| ALS-derived structure | Confirmed-manifest structure validation; a captured ALS fixture must be added when the first production ALS import is supplied |
| Long playback | native `testLongDurationPrecision` and `testHundredThousandRandomizedCallbacksAndGraphSwaps` |
| Rapid commands | native bounded/ordered command queue and randomized callback/graph-swap stress |
| Streaming / stale audio | native worker-stall recovery, stale-seek rejection, 30-stem stress, and callback allocation tests |
| Device recovery | native `testSimulatedDeviceClockAndRecovery`; hardware checklist for DVS/console behavior |
| PB_IEM | native `testAutomaticIemPolicyAndIsolation`, post-sum peak/clip telemetry, hardware listening checklist |
| Song transitions / setlist | `test/performance-session.test.ts`, `test/song-transition.test.ts`, `test/operator-setlist.test.ts` |

Hardware-dependent cases remain in `REHEARSAL_ACCEPTANCE_CHECKLIST.md`. A real production ALS project is the only fixture not currently present locally; it is explicitly tracked rather than represented by invented data.


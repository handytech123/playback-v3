# Production Performance Milestone

This milestone consolidates former Milestones 1, 3, and 4 into one production-readiness gate: preparation, performance safety, and Reaper/ProPresenter integration must succeed together.

Status: **COMPLETE**

## Readiness gate

- One operator-facing report covers confirmed metadata, selected song, musical structure, cached assets, native armed state, routing, Slides MIDI, and next-song preload.
- A blocking check locks Performance controls and safely stops playback. Stop remains available at all times.
- Warnings remain playable and visible. The current Focusrite Windows Exclusive device exposes two outputs, so the app explicitly reports stereo fallback.
- Native startup failures become recoverable engine faults instead of crashing Electron.
- Runtime isolation supports standard confirmed sets and arrangement packages with sibling media caches.

## Native transport and MIDI safety

- All 59 Cornerstone B Slides messages arm with 13 stems, 463 click events, 20 cues, and the B pad.
- Pause freezes the MIDI cursor.
- Seek, Play From Playhead, region Jump, Loop, Repeat Once, and Panic recovery reposition MIDI deterministically.
- Seek/recovery reconstructs the applicable note-on state so ProPresenter receives playlist, presentation, and target-slide commands after discontinuous movement.
- Stop flushes all notes, resets the cursor to zero, and remains available after readiness or engine faults.
- Native telemetry exposes dispatched-event, flush, and cursor counts for executable acceptance testing.

## ProPresenter acceptance

- Fixture: `Cornerstone 72 B`, the only current arrangement with a Reaper `Slides` track.
- ProPresenter's map was verified as Note 17 = Select Playlist, Note 18 = Select Playlist Item, and Note 19 = Trigger Slide with intensity as the index.
- A dedicated virtual cable, `Playback V3 to ProPresenter`, prevents other music software from competing for the production control path.
- ProPresenter is connected to that cable as a Source and Playback V3 persists it as the selected output.
- The loopMIDI wire counter advanced from 0 to 24 bytes during the focused start sequence.
- Play, Pause, Seek, Play From Playhead, region Jump, Loop, Repeat Once, Panic recovery, and Stop passed the executable matrix.

Evidence is stored in `artifacts/production-performance/verification.json`, the associated ProPresenter captures, and `loopmidi-wire-test.png`.

## Verification commands

```text
npm run check
npm test
npm run ui:build
npm run native:build
node tools/verify-production-performance.mjs
```

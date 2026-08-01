# Playback V3 Milestone Completion Ledger

This ledger is the completion authority. A milestone is complete only when every required row is implemented, integrated into the app, and covered by executable verification. Metadata representation alone is not completion.

## Consolidated Milestone 1/3/4 — Production Performance Readiness

Status: **COMPLETE**

Verified:

- Master spreadsheet identity/facts win over analyzer data.
- Zero-based 4/4 and compound-meter grid behavior.
- Confirm Set atomically copies and validates local assets.
- Native playback starts in milliseconds and survives transport stress.
- Dynamic click, cue, and key-matched pad are preloaded.
- Performance reads the confirmed local package rather than Dropbox.
- Audio devices and host modes are discoverable/selectable and persisted independently from song metadata.
- The native graph routes music to 1–2, click to 3, cue to 4, and pad to 5–6; six active outputs were verified using `CABLE In 16ch` in Windows Exclusive Mode.
- Stereo-only devices remain usable as an explicitly labelled fallback rather than being reported performance-ready.
- The production master library scan now covers all 134 matched catalog songs: 81 ready, 52 needing analyzer preparation, and one unavailable folder.
- The current and next songs retain separate pre-armed stem transports and live assets inside one continuously open native device graph.
- A verified two-song cache test switched banks in 198 ms, including 1.6 ms old-bank detachment, without restarting the audio process.
- App-created arrangements process every stem to the selected key and BPM before Confirm Set, then rebuild key-matched pad, click, cue, and MIDI assets.

- One operator-facing readiness report covers confirmed metadata, selection, structure, runtime isolation, assets, native engine state, hardware routing, Slides MIDI, and next-song preload.
- Blocking checks lock Performance controls and stop active playback; Stop remains available and Edit mode remains accessible.
- Native startup failure is handled as a recoverable engine fault instead of terminating Electron.
- Original Song can carry imported Slides control metadata without becoming or displaying as a Reaper arrangement.

## Milestone 2 — Edit Mode

Status: **COMPLETE**

Verified:

- Waveform/grid display, 21-region Original map including the final End section, region split/boundary changes, section naming, cue enable/target, undo/redo, approval, and atomic map revisions.
- Operator-facing boundary inputs use measure.beat.
- Non-destructive arrangement operations rename, reorder, duplicate, trim, and remove sections while closing the timeline gap.
- Pointer scrubbing and play-from-playhead use the native playback engine and remain grid-aligned in Edit mode.
- Arrangement key/BPM changes retime the structure, render every stem with pitch/tempo processing, and select the matching pad.
- App-created arrangements are immutable versions with their own metadata and confirmed performance cache; Original Song and master facts remain unchanged.
- Saved app arrangements are discovered by the desktop arrangement selector and arm in the native engine.
- Unit, desktop end-to-end, real FFmpeg render, FFprobe duration, and native play/seek/stop verification all pass.

Still required: **None.**

### Performance Mode

Verified:

- Play/pause/stop, boundary-aligned jump, continuous Loop, Panic recovery, bus gates, audio-clock playhead, and safety gestures.
- Destination cues are scheduled at advance markers.
- Loop says `Repeat` two beats before the section phrase and locks once that audible commitment begins.
- Repeat Once is a distinct one-boundary action and does not become a continuous Loop.
- Music, click, cue, and pad each have live gain controls in addition to bus gates.
- The displayed bus routes now correspond to native hardware channels when a six-output device is armed.
- Cue Next switches to the prepared next bank, clears old transport/MIDI/recovery state, enables the next key-specific pad, and leaves Play stopped.
- Old-bank read-ahead cleanup is moved off the live control path.

- The executable failure matrix covers invalid metadata, escaped cache paths, missing assets, native arm failure, inadequate routing, MIDI count mismatch, and failed next-song preload.

### Reaper Arrangement And Slides MIDI

Verified:

- Saved Cornerstone RPP content hash captured.
- New immutable arrangement version; Original Song/master facts preserved.
- 20 regions, 20 advance markers, 40 media items, B key, 72 BPM, 4/4, and 385-second structure imported.
- `Slides` track convention is case-insensitive and isolated from unrelated MIDI tracks.
- 29 Slides note-on events decoded from 960-PPQ deltas into absolute arrangement time.
- RPP snapshot and 19 unique media dependencies cached locally; unchanged re-import is idempotent.
- The 40 RPP media items are resolved into 13 continuous native-playable music stems (nine reused glued stems and four offline renders).
- A cache-only B/72 performance package contains 20 fully named cue announcements, 463 dynamic click events, and the B pad.
- Native playback and seek arm the real 385-second arrangement in 170 ms on the development device.
- All 59 Slides MIDI messages are loaded into a transport-clock scheduler; Stop and every seek/jump flush notes and reposition the event cursor.
- Disabled or unavailable MIDI remains non-blocking to audio and is reported separately.
- Original Song and Cornerstone 72 B are selectable prepared versions in the desktop app.
- Reaper import preview reports arrangement differences and offers New Version, Replace Selected Arrangement, and Cancel without overwriting Original Song facts.
- Native MIDI output discovery, persistent selection, disabled mode, and Ready/Off/Fault UI are integrated; all 59 events arm on the dedicated `Playback V3 to ProPresenter` port.
- ProPresenter's Note 17/18/19 playlist, presentation, and slide-index contract was confirmed against its live MIDI map.
- The dedicated loopMIDI cable is connected as a ProPresenter Source and persisted by Playback V3; its wire counter advanced during live native dispatch.
- Play, Pause, Seek, Play From Playhead, region Jump, Loop, Repeat Once, Panic recovery, and Stop passed the Cornerstone B matrix with MIDI dispatch, flush, and cursor telemetry.

Still required: **None.**

## Milestone 5 — Editor Workspace

Status: **COMPLETE**

Verified:

- The non-destructive arrangement engine can rename, move, duplicate, delete, trim, reflow, undo, redo, render, and save immutable arrangement versions.
- Whole-arrangement key/BPM processing, dynamic click/cue/pad rebuilding, cache isolation, and native audition are operational.
- Reaper arrangements and Slides MIDI can be imported without changing Original Song facts.
- Summary View displays a projected combined waveform for navigation and region/cue inspection.
- Expanded Stems displays every playable stem on one zero-based measure/beat timeline with persistent labels and one audio-clock playhead; nine-stem Original and 13-stem Reaper arrangements were verified.
- Stem labels are isolated in a fixed gutter; measured Electron layout verification reports 0 px offset between the ruler, timed canvas, and transport playhead.
- Zoom and horizontal navigation keep long arrangements readable without changing musical positions.
- The region list and colored timeline blocks support click selection, drag reordering, occurrence numbering, rename, duplicate, split, create-from-selection, trim, delete, and remove-and-close-gap.
- Arrangement edits project every waveform through the EDL and reflow duration, regions, destination cues, and Slides MIDI together.
- Cue phrases are validated against their destination region; duplicated/moved regions regenerate matching cues and missing cue audio blocks rendering.
- Slides MIDI markers are visible and inspectable by measure/beat, channel, event type, and data; events can be disabled and follow duplicate/move/delete/trim operations.
- Source audition, contiguous-boundary audition, selected-source Loop, native play-from-playhead, and exact rendered-arrangement audition are integrated.
- Draft dirty state, atomic Save Draft, restart restoration, undo/redo, and Revert are integrated and verified across Electron restarts.
- Original Song and immutable app/Reaper arrangement versions load from the selector with visible source ID, type, and content hash.
- Arrangement key/BPM editing shows Original facts separately, checks rubberband processing, selects the enharmonic pad filename, and never changes master facts.
- Readiness reports structure, stems, cache isolation, click, cues, pad, processing, Slides MIDI, and hardware routing as Ready, Ready with warnings, or Blocked.
- Reaper import remains preview-first and isolates the case-insensitive `Slides` track.
- In-app Render + Save created `Cornerstone Editor Workspace Validation`, which reloaded as an `app-edit` arrangement at D/80 with nine stems, two cues, and the D pad while preserving Original C/72 facts.
- The saved editor arrangement remained cache-isolated and armed in 122.906 ms; native play, exact 4.5-second seek, and stop passed.
- 72 unit/integration tests, Original Editor E2E, Reaper/Slides Editor E2E, draft restart E2E, render/save E2E, visual QA, Prep workflow E2E, and Performance-mode regression pass.

Still required: **None.**

Deferred by the milestone's approved scope boundary: deep per-stem clip editing, fades/crossfades, envelopes, and full DAW tooling.

## Operator Prep, Setlist, And Confirm Set

Status: **COMPLETE**

Verified:

- A dedicated Prep workspace scans and filters the 134-song production master library without touching the live command path.
- Prepared Original, Reaper, and app-created versions are discovered from local performance caches.
- Set names, ordered items, duplicates, move/remove operations, and clearing persist atomically as a restart-safe draft.
- Confirm Set copies the ordered songs and every live dependency into one immutable cache-only package, validates it, persists it as active, and reloads Electron into Performance.
- Confirmed packages freeze mixer gains, routing intent, transition rules, and Panic recovery policy in addition to song/audio metadata.
- Electron E2E reports five prepared versions, 134 catalog rows, and the current 81/52/1 readiness split.
- A real miniature WAV acceptance fixture passes the complete operator setlist-to-confirmed-package path.

Still required: **None in application code.** Production catalog preparation remains data work: 52 songs need analyzer output, one folder is unavailable, and missing master keys require evidence plus explicit approval.

## Remote And OSC Control

Status: **COMPLETE**

Verified:

- UI, authenticated remote HTTP, and OSC adapters converge on one validated, serialized command bus outside the audio thread.
- A responsive Stage Remote shows the authoritative set, song, clock, current region, readiness, Loop, and Panic state.
- Remote controls cover transport, musical jumps, Loop, Repeat Once, Panic recovery, Cue Next, song selection, bus gates, and gains.
- Normal playback requires a deliberate double-tap region jump; Panic recovery remains a single-tap selection.
- Live state synchronization is revisioned and broadcast at a bounded rate.
- LAN access is off by default, HTTP requires a private token, and LAN OSC requires that token as its first argument.
- The desktop Remote panel exposes the link, adapter status, ports, LAN control, and OSC control without putting settings in song metadata.
- Unit, HTTP/OSC integration, Electron end-to-end, and 390 × 844 visual/browser acceptance pass.

Still required: **None for the Remote/OSC milestone.** MIDI input/footswitch profiles and GLD-112 mixer control remain a separate physical-hardware milestone with a required safe test/learn gate.

See [Remote And OSC Control Milestone](REMOTE_OSC_CONTROL_MILESTONE.md).

## MIDI Input And GLD-112 Hardware Control

Status: **AWAITING PHYSICAL ACCEPTANCE**

Verified in code/local fixtures:

- Native MIDI-input enumeration/capture, persistent device selection, disabled-by-default foot-controller profiles, note-off rejection, debounce, and normalized command-bus dispatch.
- Three live Windows MIDI inputs were discovered and the native Cornerstone engine armed successfully with loopMIDI Port as input.
- Official GLD V1.4 strip addressing and byte-exact Mute, Fader, and Scene encoders.
- GLD fader values follow the official dB/value table.
- Operator-facing MIDI Input and GLD Safe Test/Learn controls.
- Connection testing sends zero bytes and every GLD write remains hard-locked.
- 72 unit/integration tests and Hardware Control Electron/native acceptance pass.

Still required: **Physical GLD-112 and foot-controller acceptance with Luis.** Confirm the console IP and MIDI channel, pass the no-write connection test, learn one non-critical strip, explicitly approve a Mute/Fader test, and actuate the intended foot controller. No console writes are enabled before this gate.

See [MIDI Input And GLD-112 Hardware Control Milestone](HARDWARE_CONTROL_MILESTONE.md).

## Completion Rule

No milestone status changes to complete until:

1. Every `Still required` item is closed or explicitly moved by an operator-approved scope decision.
2. Unit/integration tests pass.
3. Native verification passes on the prepared package.
4. Desktop end-to-end behavior passes.
5. Runtime-isolation verification proves no library, Dropbox, analyzer, or Reaper dependency.

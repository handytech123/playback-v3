# V3 Editor Workspace Milestone

Status: **COMPLETE**

The V3 editor must be a real song-map and arrangement workspace, not merely a waveform preview. The current non-destructive editing and rendering engine is the foundation; this milestone delivers the complete operator-facing workflow.

## Waveform Views

### Summary View

One combined waveform for the whole song. It supports fast navigation, Performance mode, remote view, and simple region/cue checking.

### Expanded Stem View

A DAW-style stacked waveform view showing every playable WAV/stem aligned to the same timeline:

- Track labels on the left.
- Time and musical grid from left to right.
- One vertical playhead through every stem.
- Visual evidence of what is playing in each section before trimming, removing gaps, or moving regions.

## Required Editor Capabilities

- Accurate zero-based grid.
- Measure/beat timeline.
- Summary waveform.
- Stacked stem waveforms.
- Cue markers.
- Region blocks.
- Region list.
- Clickable region selection.
- Rename regions.
- Create regions from a timeline selection.
- Move regions.
- Trim song start and end.
- Split at playhead.
- Delete selected section.
- Remove a section and close the gap.
- Undo and redo arrangement edits.
- Save an immutable arrangement version.
- Load Original Song or an arrangement version.
- Whole-arrangement key change.
- Whole-arrangement BPM change.
- Pad follows the selected key.
- Reaper arrangement import.
- ProPresenter MIDI cue import from the Reaper `Slides` track.
- Preview differences before writing an imported arrangement.
- Show arrangement source and version.

## Region And Cue Rules

- Cues announce the upcoming destination region.
- If a cue says `Verse`, its destination region must be `Verse`.
- Moving a region moves or regenerates its related cue at the correct advance marker.
- Duplicating a region creates the corresponding destination cue.
- Removing a region removes or retargets invalid related cues.
- Arrangement edits never modify or destroy the Original Song map.

## Waveform Editing Rules

- Expanded Stem View shows every playable stem so the operator can visually sculpt the song.
- Summary View shows the combined shape of the whole arrangement.
- Remove and Close Gap changes the arrangement timeline, redraws every waveform, moves regions, moves related cues and Slides MIDI, and shortens arrangement duration.
- Move, duplicate, trim, split, and delete operations remain aligned to the musical grid.
- The playhead and every waveform share the same timeline and transport clock.

## Initial Scope Boundary

This milestone is region-level song editing. It is not intended to become a full Reaper replacement.

Build first:

- View all stems.
- Create, rename, select, and move regions.
- Trim, split, delete, and close gaps.
- Undo and redo.
- Save and load arrangement versions.

Defer until the region-level workflow is complete:

- Deep per-stem clip editing.
- Clip-level slip edits.
- Fades and crossfades.
- Envelopes and automation drawing.
- Detailed DAW mixing and editing tools.

## Completion Workflow

This milestone is complete only when the operator can perform the following entirely inside V3:

1. Load Original Song or an existing arrangement.
2. Switch between Summary View and Expanded Stem View.
3. Inspect every playable stem against the zero-based measure/beat grid.
4. Select or create a region.
5. Rename, move, duplicate, split, trim, or delete it.
6. Remove a section and observe all waveforms, regions, cues, MIDI, and duration close the gap together.
7. Scrub and audition from the shared playhead.
8. Change arrangement key and BPM and verify the selected pad.
9. Undo and redo the edits.
10. Save a new immutable arrangement version.
11. Reload that version and confirm its source/version identity.
12. Render and Confirm Set.
13. Play the exact rendered result through the native engine.
14. Verify that Original Song remains unchanged.

## Completion Evidence

- Summary View visually verified against Cornerstone Original Song.
- Expanded Stem View visually verified with all 13 playable Cornerstone 72 B Reaper stems, cue markers, Slides markers, region blocks, labels, ruler, and shared playhead.
- Expanded Stem alignment is regression-tested: timeline, ruler, first stem canvas, label-gutter edge, and zero-position playhead reported the same x-coordinate with 0 px left and width deltas.
- Original Editor Electron E2E verified nine stem rows, twenty starting regions, split, rename, duplicate, move, delete/close-gap, D/80 change, cue integrity, undo, and redo.
- Reaper Editor Electron E2E verified 13 stem rows, source/version identity, and Slides MIDI duplication from 59 to 60 events with its containing section.
- Draft Save/Restart E2E restored the same valid revision with a clean dirty state.
- In-app Render + Save produced `app-e950a627be38`, then arrangement reload identified it as `Cornerstone Editor Workspace Validation`.
- The resulting local cache contains nine stems, two destination cues, dynamic click, and the D pad; Original Song remains C / 72 BPM.
- Native verification armed the saved arrangement in 122.906 ms, played, sought exactly to 4.5 seconds, and stopped at zero.
- Cache-isolation verification found no runtime dependency outside the immutable arrangement cache.
- Performance-mode regression verified transport, Panic deferral/announcement, click/pad survival, arrangement discovery, and live region naming after the editor UI rebuild.
- Final automated result: 49 tests passed, zero failed.

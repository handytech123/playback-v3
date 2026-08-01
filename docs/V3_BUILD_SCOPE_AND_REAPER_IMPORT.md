# Playback App V3 Build Scope And Reaper Import

## Priority Order

V3 should be built around the core playback product first.

The order is:

1. Library and metadata import
2. Setlist building
3. Confirm-set preparation and cache building
4. DAW-speed playback engine
5. Edit mode song map tools
6. Performance mode live controls
7. Reaper arrangement and ProPresenter cue import
8. Remote, MIDI, OSC, ProPresenter, and board control

Remote control, MIDI output, OSC, ProPresenter slide commands, and GLD-112 board control are important, but they are secondary. They are not the foundation of the app. They are icing on top of a playback system that must already be fast, stable, and musically correct.

## Core V3 Goal

V3 should feel like a DAW from a speed and reliability standpoint, but behave like a worship playback app from a workflow standpoint.

The app should:

- Load songs from the library without hunting through random fallback locations.
- Trust approved metadata.
- Build a zero-based musical grid from BPM, time signature, duration, and start time 0.000.
- Prepare everything needed at Confirm Set.
- Play instantly from prepared local cache.
- Keep edit tools separate from performance safety.
- Keep all performance actions tied to the song map and grid.

Performance mode must never be doing expensive prep work. It should only play, route, respond to commands, and protect the performance.

## Reaper Arrangement Import Priority

After the playback infrastructure is working, Reaper import becomes one of the most important V3 workflow features.

The goal is simple:

If a song has already been programmed in Reaper, V3 should be able to use that work instead of forcing the operator to rebuild every region, cue, and arrangement by hand.

The master sheet remains the source of truth for song facts. Reaper data is arrangement data.

Master sheet owns:

- Title
- Artist
- Vendor
- Original key
- Original BPM
- Original time signature
- Song identity

Reaper import owns:

- Arrangement versions
- Region layout
- Marker layout
- Song structure edits
- Arrangement tempo choices
- Arrangement key choices when intentionally changed
- MIDI/automation cues already programmed for ProPresenter
- Section-specific live commands when they exist

## What V3 Should Read From Reaper

V3 should be able to inspect a Reaper project file for a song and import:

- Region names
- Region start positions
- Region end positions
- Marker names
- Marker positions
- Arrangement structure
- MIDI item positions if they are used for ProPresenter commands
- MIDI command payloads when readable
- ProPresenter MIDI commands from the conventionally named `Slides` track (case-insensitive)
- Optional arrangement version name
- Optional notes about imported data

The imported data should become app metadata, not a live dependency on Reaper.

The `Slides` track name is the explicit routing convention for ProPresenter import. MIDI on other Reaper tracks must not be classified as slide control unless the operator maps it explicitly.

After import, V3 should save the results into the song metadata system so the app can load it without opening Reaper.

## Arrangement Versions

V3 should support arrangement versions per song.

Example versions:

- Original Song
- Sunday Set
- Radio Edit
- Rehearsal Edit
- Reaper Import
- Custom Arrangement 1

Each arrangement version should store:

- Arrangement id
- Arrangement name
- Source type: `reaper-import`, `app-edit`, or `analyzer-draft`
- Created date
- Last modified date
- Region order
- Region boundaries
- Cue markers connected to regions
- Trim edits
- Remove-and-close-gap edits
- Audio shift edits
- ProPresenter MIDI cues when imported from Reaper

The full original song must always be recoverable.

The user should be able to choose which version to load:

- Original song
- Reaper imported arrangement
- App-created arrangement
- Saved weekly/service arrangement

Loading an arrangement should not change the master song facts. It only changes the active structure and automation for that use of the song.

Original song and analyzer draft are not separate user-facing versions. The analyzer creates or refreshes the original song map. If that analyzer-created map has not been approved yet, it can be marked as draft/review internally, but the user should still understand it as the original song version.

Arrangement versions may intentionally differ from the original song facts. For example, a Reaper arrangement may raise or lower tempo, change key, trim sections, move regions, add repeats, or include ProPresenter MIDI cues. Those changes belong to that arrangement version only. They do not overwrite the master-sheet original unless the operator explicitly changes the master data.

The original song version may have no ProPresenter MIDI data. That is expected. ProPresenter MIDI cues usually come from imported Reaper arrangements or from app-created arrangement edits.

## Reaper As An Import Source, Not The Runtime

V3 should not need Reaper installed to perform.

Reaper is useful because many songs may already have correct regions, markers, arrangement edits, tempo choices, key choices, and ProPresenter MIDI commands. V3 should read that information, convert it, and store it.

Runtime playback should still come from V3's own prepared cache and engine.

## Metadata Rule

Song metadata should remain the source of truth inside Playback App V3.

The master spreadsheet should remain the external source of truth for song identity and musical facts.

Reaper import should update arrangement metadata only through an intentional import action.

The app should clearly show:

- Metadata source
- Imported from Reaper or analyzer
- Import timestamp
- Arrangement version currently active
- Whether the current arrangement has unsaved changes
- Whether ProPresenter MIDI cues came from Reaper

## Reaper Import Safety

Reaper import should never silently overwrite approved app edits.

Recommended behavior:

1. Read Reaper project.
2. Preview detected regions and markers.
3. Compare against existing app metadata.
4. Show differences.
5. Let operator choose:
   - Import as new arrangement version
   - Replace selected arrangement version
   - Cancel

Default should be: import as a new arrangement version.

If the Reaper project title or song identity disagrees with the master sheet, V3 should not automatically trust Reaper. It should keep the master-sheet identity and report the difference as an import warning.

If the Reaper project key, BPM, time signature, regions, markers, or MIDI cues differ from the master sheet/original song map, those differences may be imported as part of the arrangement version. They should be visible in the import preview so the operator understands what the arrangement changes.

## Reaper Import Direction

V3 should be import-first.

The app imports Reaper arrangements into Playback metadata. It should not send arrangement changes back into Reaper by default.

Exporting back to Reaper can be considered later for rare fine-tune workflows, but it is not part of the core V3 plan. The app should be able to do its own editing, so Reaper should not remain required after import.

## Song Matching

Most songs should be matched by their unique song folder or song title. The library is expected to have clear song names, so matching should usually be straightforward.

If there are duplicate or alternate original downloads for the same song, V3 should handle those case by case through manual approval. This is expected to be rare.

## Control Features

The control system should be built after the core playback system is stable.

Control features include:

- OSC remote from stage
- Remote transport
- Remote loop, jump, skip, panic, and cue-next commands
- Remote waveform/song map view
- MIDI input adapter
- MIDI output to ProPresenter
- GLD-112 board control adapter
- Optional Allen & Heath MIDI Control compatibility route

These should all connect through one internal command bus.

The playback engine should not care whether a command came from:

- Main app UI
- Remote
- MIDI controller
- OSC message
- Foot pedal
- Board surface

It should receive one normalized command and execute it safely.

## Live Command Protocol

For V3 remote control, use a dedicated live command protocol over the local network.

The remote should not depend on Windows RTP-MIDI.

Recommended path:

Remote controller or tablet -> V3 live command protocol -> Playback computer -> local MIDI/OSC/GLD output

The protocol should include:

- UDP for fast live commands
- Sequence numbers
- Timestamps
- Acknowledgements
- Heartbeat
- Duplicate rejection
- Connection status
- State broadcast back to remotes

This keeps remote performance commands fast while avoiding fragile Windows RTP-MIDI behavior.

## MIDI And ProPresenter

MIDI should be an output adapter, not the backbone of the app.

For ProPresenter:

- V3 sends MIDI locally from the playback computer.
- Slide commands are tied to song sections or cue points.
- MIDI failures should be logged and visible.
- MIDI failure should not stop playback.

## GLD-112 Board Control

The earlier scene-based board workflow proved the idea, but it should not be the main V3 design.

V3 should avoid making board scenes into a second song database.

Recommended GLD approach:

- Use broad board scenes only for service-level resets when needed.
- Use V3 track roles and routing metadata for song-specific control.
- Send specific commands for fader levels, mutes, routing, and selected scene recalls.
- Prefer direct GLD TCP/IP control where possible.
- Keep Allen & Heath MIDI Control optional, not required.

Board-control failure must never stop audio playback.

## What Not To Build First

Do not start V3 by building:

- Remote polish
- Board automation
- ProPresenter control
- Complex MIDI routing
- Every possible DAW editing feature
- A giant settings system

Build the playback foundation first.

The control layer becomes valuable only after the app can load, prepare, and play songs instantly and reliably.

## First V3 Milestone

The first milestone should prove:

1. A song can be imported from metadata.
2. Reaper regions/markers can be imported as an arrangement version.
3. A setlist can be built.
4. Confirm Set creates a complete local playback cache.
5. Playback starts instantly.
6. The waveform, grid, cues, and regions agree.
7. Performance mode uses only prepared data.

After that, add remote and MIDI/OSC control.

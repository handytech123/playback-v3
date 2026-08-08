# Playback App V3 Architecture

## Purpose

Playback App V3 is a clean rebuild focused on speed, reliability, and production readiness.

This architecture is informed by C2 testing and product research into Prime, Playback, DAWs, and Dante-based Windows workflows. See [Product Research Notes](PRODUCT_RESEARCH_NOTES.md).

C2 proved the feature set:

- Library import from Dropbox song folders
- Master spreadsheet metadata
- Setlist workflow
- Cue and region maps
- Dynamic click
- Dynamic cue
- Dynamic pad
- Key changes
- Mixer and routing
- Panic recovery
- Arrangement edits
- Export/import between home and church PCs
- Windows install packaging

V3 keeps those decisions but rebuilds the runtime so the app behaves more like a DAW.

The core rule:

**Performance mode never prepares. It only performs.**

## Why V3 Exists

C2 grew while the rules were still being discovered. That left too much work close to the live playback path:

- JSON reads and writes during live workflows
- Cache checks close to playback
- Manifest rebuilds near transport actions
- Preload/start decisions mixed with playback commands
- Analyzer/library logic too close to performance
- Multiple places that could decide timing, cues, keys, and cache validity

Those choices made the app functional, but not DAW-fast.

V3 separates preparation from performance.

## Architecture Lanes

V3 has three strict lanes.

There is also a control layer that connects UI, remote, MIDI, OSC, ProPresenter, and mixer control to the live engine without putting those systems inside the audio path. See [Control Architecture](CONTROL_ARCHITECTURE.md).

### 1. Library And Prep Lane

This lane may be slower. It is allowed to scan, analyze, validate, render, and write files.

Responsibilities:

- Scan the library root
- Read the master spreadsheet
- Import song metadata
- Validate song folders
- Build waveform summaries
- Build cue and region data
- Build dynamic cue plans
- Build dynamic click plans
- Prepare key-changed audio
- Prepare tempo-changed audio if needed
- Prepare arrangements
- Report missing or invalid data

This lane never runs during live playback.

### 2. Confirmed Set Lane

This lane freezes the show.

When the operator confirms the set, V3 creates a complete performance package for that set.

The confirmed set must contain:

- Setlist order
- Selected song keys
- Selected BPM values
- Time signatures
- Final audio cache paths
- Final waveform summaries
- Final tempo grids
- Final cue markers
- Final region blocks
- Dynamic click events
- Dynamic cue events
- Pad selection per song
- Mixer state
- Routing state
- Transition rules
- Panic recovery map

After confirmation, the live engine should not need to ask the library or analyzer for anything.

### 3. Live Engine Lane

This lane must be fast.

Responsibilities:

- Keep audio device open
- Keep current song armed
- Keep next song armed
- Start playback immediately
- Pause immediately
- Stop immediately
- Seek from playhead
- Schedule jumps and loops
- Run dynamic click
- Run dynamic cues
- Run dynamic pad
- Apply mixer changes in real time
- Apply routing to hardware outputs
- Handle panic without killing the timeline

This lane does not scan folders, read spreadsheets, run analyzers, render stems, or rebuild metadata.

## Target Runtime Shape

Ideal live command path:

```text
Operator action
  -> UI command
  -> Live command bus
  -> Already-running audio engine
  -> Immediate result
```

Not allowed in the live command path:

```text
Operator action
  -> scan library
  -> validate metadata
  -> rebuild manifest
  -> render cache
  -> open audio device
  -> then play
```

## Recommended Technology

Recommended V3 stack:

```text
Electron
  Desktop shell, menus, windows, file dialogs

Web UI
  Setlist, waveform, mixer, settings, remote

Node or TypeScript service
  Library, metadata, preparation, export/import

JUCE native audio engine
  Live playback, routing, audio device control
```

Electron is the shell. It is not the audio engine.

JUCE owns real-time audio.

This keeps V3 cross-platform-ready while still solving the immediate Windows/Dante need.

## Audio Engine Rule

The JUCE engine should be treated like a DAW engine:

- Device opens before performance
- Current song is loaded before Play
- Next song is loaded before transition
- Stems are already decoded or stream-ready
- Dynamic click/cue/pad are already loaded
- Transport commands do not trigger file preparation

Performance play should be:

```text
play()
```

Not:

```text
prepareThenMaybePlay()
```

## Library Source Of Truth

Default sources:

- Library root: `D:\Dropbox\Worship\Backing Tracks`
- Master spreadsheet: `D:\Dropbox\Worship\church_song_master_updated.xlsx`
- Vendors: `Loop Community`, `Multitracks`

The app should not hardcode these as permanent truths. They should live in settings.

But the app should use these as the expected production defaults.

## Song Metadata Contract

A song is usable only when it has the required data.

Required song facts:

- Stable song ID
- Title
- Artist
- Vendor
- Source folder path
- Key
- BPM
- Time signature
- Duration
- WAV inventory
- At least one playable music stem
- Tempo grid with `1.1 = 0.000`

Analyzer/source metadata may provide cue and region information, but live playback must consume a normalized app format.

## Timing Contract

The grid is the timing authority.

For every song:

- Measure 1 beat 1 is always time `0.000`
- No analyzer click offset may move the playback grid
- All stems are expected to start at zero
- Dynamic click follows the app grid
- Cue and region markers are placed on the app grid

Compound meter rule:

For worship vendor 6/8, 9/8, and 12/8 songs, BPM may represent dotted-quarter pulse depending on the trusted metadata and analyzer result. The analyzer must output the normalized grid. The app must not guess a different grid during playback.

## Dynamic Click Contract

The app owns the click.

The source click stem is not the performance click.

Dynamic click uses only the V3 template registry:

- `2-4-standard`
- `3-4-standard`
- `4-4-quarter`, `4-4-eighth`, or `4-4-half-time`
- `6-8-full` or `6-8-two-feel`
- `12-8-full` or `12-8-four-feel`

The selected template owns trigger and accent placement. The confirmed grid owns timing. The old meter-file and Normal/Double click paths are not supported.

## Dynamic Cue Contract

Dynamic cues are app-owned WAV phrases placed on the confirmed grid.

Rules:

- Cue phrase announces the upcoming region
- Count-in is scheduled relative to the upcoming region boundary
- 4/4 and 6/8 may use different cue/count behavior
- The analyzer decides cue placement and count intent
- The app plays what the confirmed cue plan says
- Performance mode does not reinterpret cue timing

## Dynamic Pad Contract

Pads must follow the selected song key.

Rules:

- Pad key comes from the selected setlist key
- If the operator changes the key, the pad key follows
- Pad files live in the configured pad folder
- Pad is part of live engine state
- Panic starts pad immediately
- Cue Next can move pad to the next song key before playback

## Export And Import Contract

Export/import must support the home-to-church workflow.

An export package should include enough prepared state for the church PC to use the set without rediscovering the songs.

The package should carry:

- Setlist
- Song metadata
- Set metadata
- Arrangement data
- Mixer data
- Routing intent
- Selected keys
- Dynamic cue/click/pad plans
- Prepared cache or enough dependencies to rebuild cache safely

If selected keys require rendered audio, the receiving PC must either:

- receive the rendered cache in the package, or
- have FFmpeg with Rubber Band bundled in the app

No fallback to original-key audio is allowed when a selected key is different.

## Panic Contract

Panic is musical recovery, not stop.

When Panic starts:

- Timeline keeps moving
- Click remains alive
- Tracks fade down fast
- Dynamic cues may be controlled by recovery logic
- Pad starts in song key
- Operator chooses recovery

When Panic exits:

- Recovery happens at the next natural section boundary after the operator selects a target
- Cue announces the recovery target
- Tracks fade back in
- Pad fades out
- Click continues

## Remote Contract

Remote must follow the main app and the main app must follow remote.

The state model must be two-way:

- Main app action updates remote
- Remote action updates main app
- Selected song stays synchronized
- Transport stays synchronized
- Current region stays synchronized
- Panic/loop/jump state stays synchronized

Remote should not own a separate truth.

For V3, remote commands should be designed around OSC-style command messages, with WebSocket or another state stream used where visual synchronization needs richer app state.

## V3 First Milestone

Build the smallest possible proof that the new architecture is right.

Milestone 1:

- Load one prepared song
- Open audio device once
- Arm the song before Play
- Press Play and start immediately
- Press Pause and pause immediately
- Press Stop and stop immediately
- Seek to playhead and start from there
- No library scan during Play
- No metadata reads during Play
- No render during Play

Pass condition:

Playback feels immediate.

## V3 Build Order

1. Project skeleton
2. Architecture document
3. Minimal JUCE live engine contract
4. One-song prepared playback test
5. Current/next song preload
6. Confirmed set file format
7. Library importer
8. Analyzer metadata importer
9. Waveform/timeline UI
10. Mixer/routing
11. Dynamic click
12. Dynamic cue
13. Dynamic pad
14. Panic
15. Remote
16. Export/import
17. Installer

## Non-Negotiables

- No fallback guessing in live playback
- No source click stem as performance click
- No cache render during performance
- No analyzer during performance
- No library refresh during performance
- No old metadata silently overriding current metadata
- No original-key audio when selected key requires transposed audio
- No hidden timing offsets
- No play command that rebuilds state first

## C2 Lessons To Carry Forward

- The workflow is valid
- The feature set is valid
- The library contract matters
- Metadata versions and fingerprints matter
- Dynamic click and cue need strict timing ownership
- Pads must follow selected key
- Export/import must carry dependencies or rendered cache
- UI can be web-based, but live audio must be native and already armed
- Most problems came from mixing prep work with live work

## Working Principle

V3 should feel boring in the best way.

The operator should press Play and trust that the app is already ready.

# Playback App V3

Playback App V3 is the clean rebuild of Playback App V2/C2.

The purpose of this project is not to rediscover the workflow. C2 already proved the workflow can work. V3 exists to rebuild the architecture so playback feels instant and dependable like a DAW.

Start here:

- [V3 Architecture](docs/V3_ARCHITECTURE.md)
- [Playback Audio Engine V3 — Phase 0 Audit](docs/PLAYBACK_AUDIO_ENGINE_V3_PHASE0_AUDIT.md)
- [Playback Audio Engine V3 — Phase 1 Core](docs/PLAYBACK_AUDIO_ENGINE_V3_PHASE1_CORE.md)
- [Playback Audio Engine V3 — Phase 2 Streaming](docs/PLAYBACK_AUDIO_ENGINE_V3_PHASE2_STREAMING.md)
- [Playback Audio Engine V3 — Phase 3 Mixer and Router](docs/PLAYBACK_AUDIO_ENGINE_V3_PHASE3_MIXER_ROUTER.md)
- [Playback Audio Engine V3 — Phases 4–8 and Church Test](docs/PLAYBACK_AUDIO_ENGINE_V3_PHASE4_TO_8.md)
- [Product Research Notes](docs/PRODUCT_RESEARCH_NOTES.md)
- [Control Architecture](docs/CONTROL_ARCHITECTURE.md)

## Milestone 1

Milestone 1 is implemented against the production `Cornerstone` library data:

- read-only master workbook import with master-fact authority
- setlist creation and ordering contracts
- zero-based simple and compound-meter grids
- atomic Confirm Set cache with SHA-256 stem verification
- cached waveform, regions, click plan, cue plan, and key-matched pad
- JUCE native nine-stem music engine with a permanently open audio graph

## Current Operator Workflow

Playback V3 now includes a dedicated Prep / Setlist workspace for scanning the master catalog, choosing prepared Original/Reaper/app versions, persisting an ordered set, and atomically creating the isolated confirmed package used by Performance. See [Operator Prep Milestone](docs/OPERATOR_PREP_MILESTONE.md).

The built-in token-protected Stage Remote and OSC adapter now share one serialized command bus with the desktop UI. See [Remote And OSC Control Milestone](docs/REMOTE_OSC_CONTROL_MILESTONE.md).

Native MIDI input, foot-controller profiles, and the locked GLD-112 Safe Test/Learn gate are implemented. Physical console/controller acceptance is intentionally still required. See [Hardware Control Milestone](docs/HARDWARE_CONTROL_MILESTONE.md).
- audio-callback clock and measured command-to-audio latency
- Electron Edit Map and locked Performance Mode surface
- waveform, grid, cue markers, regions, seeking, transport, and pad control
- end-to-end cache-isolation and transport stress verification

Run all contract tests and the production integration gate with:

```powershell
npm install
npm test
node tools/verify-milestone1.mjs
```

Build the native probe with CMake/MSVC, then launch the desktop surface with
`npm run desktop`. Performance Mode reads only the confirmed local package; it
does not scan the library, read the workbook, invoke the analyzer, or access
Dropbox.

For the locked Dante production profile and the short operator recovery sequence, see [Sunday audio recovery](docs/SUNDAY_AUDIO_RECOVERY.md).

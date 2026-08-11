# Active Project Boundary

This repository is **Playback V3**.

Active folder:

```text
C:\Users\Luis\Documents\Playback v 3
```

Git remote:

```text
https://github.com/handytech123/playback-v3.git
```

The active analyzer for this app is a separate project:

```text
D:\WavSongAnalyzerV2
https://github.com/handytech123/analyzerV2.git
```

## Playback V3 Job

Playback V3 is the runtime app.

It should:

- Open in Edit mode.
- Let the operator select songs.
- Let the operator edit arrangements.
- Prepare a confirmed set for Performance mode.
- Load approved `playback-song.json` metadata from Analyzer V2.
- Copy/cache the required audio for the set.
- Perform playback from the confirmed cache.

## Playback V3 Must Not Do

Playback V3 must not:

- Analyze cue audio.
- Guess BPM.
- Guess time signature.
- Guess song key.
- Detect click patterns.
- Invent regions from audio.
- Keep stale song data for songs not in the current setlist.
- Silently fall back to older metadata.
- Auto-preload editor workspaces before the operator selects a song.

## Analyzer V2 Job

Analyzer V2 owns metadata generation.

Analyzer V2 reads:

- The master spreadsheet.
- The song folder.
- Reaper/RPP data when present.
- Audio stems for inventory and diagnostics.

Analyzer V2 writes:

- `playback-song.json`
- `song-metadata.json`
- `analysis/grid-analysis.json`
- `analysis/cue-intelligence.json`

`playback-song.json` is the Playback-facing contract.

## Data Chain

The intended chain is:

```text
Master spreadsheet + song folder + optional RPP
  -> Analyzer V2
  -> playback-song.json
  -> Playback V3 library refresh
  -> current setlist
  -> confirmed performance cache
  -> Performance mode
```

## Rule For Future Work

If a change affects musical facts or metadata creation, it belongs in Analyzer V2.

If a change affects loading, editing, caching, routing, UI, or runtime performance, it belongs in Playback V3.

Do not solve an Analyzer problem by adding Playback fallback logic.

Do not solve a Playback cache/UI problem by changing Analyzer output.

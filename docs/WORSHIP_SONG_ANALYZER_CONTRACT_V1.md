# Worship Song Analyzer and Playback Metadata Contract V1

## Purpose

The Worship Song Analyzer is an offline preparation application. It transforms the raw multitrack audio for one worship song into a structured metadata package that Playback V3 can trust.

The analyzer's primary job is to build an accurate musical grid and attach all discovered song information to that grid.

Playback V3 must not infer BPM, key, cue phrases, region boundaries, click alignment, or stem identity from audio during a performance. It loads approved analyzer metadata, prepares the Confirmed Set cache, and reproduces the song consistently.

The responsibility is intentionally divided:

- The master spreadsheet provides authoritative original song facts.
- The analyzer discovers timing, structure, audio inventory, and missing-key evidence once.
- The operator reviews uncertain or conflicting results.
- Playback consumes approved metadata without guessing.
- The Confirmed Set contains everything required at runtime.

The analyzer is successful when its metadata is correct, not when it appears intelligent.

## Non-Goals

The analyzer does not:

- Replace master spreadsheet facts silently.
- Create stretched click-track audio.
- Choose a specific click WAV sound.
- Turn Reaper arrangements into Original Songs.
- Perform deep instrument classification when a reliable filename already exists.
- Require Playback to analyze audio again.
- Place arbitrary Start or Intro regions without evidence.
- Add occurrence numbers to spoken cue phrases.

## Source-of-Truth Rules

The master spreadsheet is authoritative for:

- Catalog/song identity
- Song title
- Artist
- Vendor
- Original BPM
- Original time signature
- Original key, when present
- Future facts such as CCLI number, album, or copyright information

The analyzer may compare its evidence with these facts and issue a warning, but it must not silently change them.

Examples:

- If the spreadsheet says 120 BPM and the click evidence resembles 60 or 240 BPM, retain 120 BPM and report a tempo-resolution warning.
- If the spreadsheet contains the key E and the analyzer estimates F, retain E and report a key conflict.
- If the spreadsheet key is empty, store the detected key as an estimate. It becomes the Original Song key only after operator approval.

Reaper remains an arrangement source. Reaper metadata must never overwrite the analyzer-approved Original Song map automatically.

## Analyzer Inputs

The analyzer receives:

1. One master spreadsheet row.
2. One song folder containing WAV and/or M4A files.
3. Optional existing analyzer metadata for comparison or refresh.
4. The approved cue vocabulary.
5. The supported Playback bus vocabulary.

All paths written to the metadata package must be relative to the song folder or metadata package. Machine-specific paths such as `D:\Dropbox\...` must not be stored in portable analyzer output.

## Required Analyzer Output

The analyzer produces one versioned JSON document named `playback-song.json`. Optional waveform peak files may accompany it, but the JSON document is the authoritative contract.

The output contains:

- Package and analyzer versions
- Master spreadsheet facts
- Audio inventory and fingerprints
- Canonical duration and sample rate
- Explicit musical grid
- Click-template selection
- Cue detections
- Region map
- Key evidence
- Diagnostics
- Review and approval state

Playback must reject an unsupported schema version rather than interpreting it loosely.

## Timing Model

### Three Required Representations

Every timing-sensitive object must contain:

1. `sampleFrame`: integer frame position at `timelineSampleRate`.
2. `timeMs`: integer milliseconds for interchange and diagnostics.
3. `position`: musical position expressed as Measure, Beat, and Tick.

Sample frame is authoritative for audio playback. Musical position is authoritative for operator commands. Milliseconds are a convenient secondary representation.

### Musical Position

The package uses 960 pulses per quarter note (`ppq: 960`).

```json
{
  "measure": 9,
  "beat": 1,
  "tick": 0
}
```

Rules:

- Measures and beats are one-based.
- Ticks are zero-based within the beat.
- Measure 1, Beat 1 is the first musical downbeat.
- Pre-roll or count-in audio before Measure 1 uses Measure 0.
- The grid origin explicitly states where Measure 1, Beat 1 occurs in the audio.
- The analyzer writes an anchor for every written beat and one closing boundary at song end.
- Playback interpolates ticks only between adjacent approved anchors. It does not reconstruct the grid from BPM alone.

### Grid Origin, Pickup, and Count-In

`grid.origin` identifies Measure 1, Beat 1. It is allowed to occur after audio time zero.

If audio exists before the origin:

- Classify it as count-in, pickup, control pre-roll, or unexplained pre-roll.
- Represent its beat anchors using Measure 0 when musically countable.
- Do not shift the music merely to make Measure 1 start at zero.
- Do not invent a Start region solely because audio exists before the first downbeat.

### Tempo and Meter

The spreadsheet BPM and time signature remain authoritative original facts. The analyzer additionally records:

- The BPM beat unit, such as `quarter`, `eighth`, or `dotted-quarter`.
- Tempo segments when the audio genuinely changes tempo.
- Meter segments when the meter changes.
- Drift between the expected grid and detected beat evidence.

The explicit anchors always win over a formula calculated from BPM.

### 6/8

A 6/8 measure contains six written eighth-note beat positions. The analyzer must also identify the musical pulse and BPM beat unit instead of assuming what the spreadsheet number means.

For the standard Playback 6/8 template:

- Written beats: 1, 2, 3, 4, 5, 6
- Primary accent: beat 1
- Secondary pulse: beat 4
- Cue lead: one complete 6/8 measure before the destination region

The exact timestamps come from the analyzer grid anchors, not from generic 6/8 arithmetic inside Playback.

## Click Analysis

The click stem is reference evidence. Playback does not copy its sound.

The analyzer must determine:

- Click event locations
- Primary accents, secondary pulses, and normal clicks
- Pattern cycle length
- Template ID
- Resolution/rate
- Phase relative to the musical grid
- Confidence and discrepancies

Supported resolution values:

- `normal`
- `double`
- `sixteenth`
- `custom`

Example click description:

```json
{
  "templateId": "4-4-quarter",
  "resolution": "normal",
  "stepsPerMeasure": 4,
  "pattern": ["primary", "normal", "normal", "normal"],
  "phaseTicks": 0,
  "confidence": 0.99
}
```

A custom pattern must serialize its step pattern. It cannot depend on an analyzer-only preset name that Playback does not understand.

Playback chooses the actual regular and accent WAV sounds from its own click library.

## Cue Analysis

The cue stem contains spoken navigation evidence.

For every cue, the analyzer stores:

- Stable cue ID
- Raw transcription
- Normalized spoken phrase
- Audio start and end
- Musical position
- Destination region ID
- Confidence
- Review status

Approved spoken vocabulary includes:

- Start
- Intro
- Verse
- Pre-Chorus
- Chorus
- Down Chorus
- Bridge
- Tag
- Vamp
- Turnaround
- Interlude
- Instrumental
- Breakdown
- Outro
- Ending
- End

Display-region occurrences and spoken phrases are separate:

- Region display name: `Chorus 3`
- Region type: `chorus`
- Spoken cue phrase: `Chorus`

### Cue-to-Region Timing Rule

The detected spoken cue belongs to the region it announces.

The normal rule is:

- The cue begins at the start of the warning measure.
- The destination region begins exactly one complete measure later.
- The cue stores `targetRegionId`; Playback never guesses the target by proximity.

4/4 example:

- 8.1: cue says “Chorus.”
- 9.1: the Chorus region begins.

6/8 example:

- 8.1: cue says “Chorus.”
- Six written beats later, at 9.1, the Chorus region begins.

If the speech begins slightly late inside its warning measure, preserve the detected speech timestamp but attach the cue to the warning measure and the target at the next approved measure boundary. Report a timing-offset diagnostic rather than moving the grid.

## Region Generation

Regions form the Original Song map.

Each region contains:

- Stable region ID
- Section type
- Display name
- Occurrence number
- Start and end timing points
- Source evidence
- Confidence
- Review status

Supported section types are:

- `start`
- `intro`
- `verse`
- `pre-chorus`
- `chorus`
- `down-chorus`
- `bridge`
- `tag`
- `turnaround`
- `interlude`
- `instrumental`
- `breakdown`
- `vamp`
- `outro`
- `ending`
- `end`
- `other`

Rules:

- A region boundary must land on an approved grid position.
- Related cues must identify the destination region explicitly.
- Regions must not overlap.
- Approved regions must cover the playable timeline without unexplained gaps.
- Adjacent regions must share the same boundary.
- The final region must end at the canonical song duration.
- Occurrence numbers are added consistently when a type appears more than once.
- Analyzer refresh updates the Original Song draft without destroying saved arrangements.
- Low-confidence regions remain reviewable and cannot silently become performance-approved.

## Musical Key Detection

The analyzer prioritizes harmonic stems:

1. Piano and keys
2. Organ
3. Pads and synths
4. Acoustic guitar
5. Electric guitar
6. Strings and orchestral stems

It normally excludes:

- Click
- Cue
- Drums
- Most percussion
- Noise and effect-only stems

The output includes:

- Detected key
- Major/minor mode
- Confidence
- Supporting stems
- Excluded stems and reasons
- Alternative estimates
- Conflict with master key, if any
- Approval status

If the spreadsheet key is missing, Confirm Set remains blocked until an operator approves a key estimate.

## Stem Identification and Routing

Classification priority is:

1. Filename
2. Folder convention
3. Audio analysis only when ambiguous

Each audio file must include a detailed role and a Playback bus. Supported music buses are:

- `drums`
- `bass`
- `acoustic`
- `electric`
- `keys`
- `strings`
- `vocals`
- `other`
- `pad`

Piano is classified to `keys`. Percussion and loops are classified to `drums`.

Reference tracks use `click-reference` or `cue-reference` and set `playLive` to `false`.

Every audio entry contains:

- Relative path
- File format
- SHA-256 fingerprint
- Sample rate
- Channel count
- Duration
- Timeline offset
- Detailed role
- Playback bus
- `playLive`
- Classification method and confidence

Duration or alignment differences must produce diagnostics. The analyzer must not silently time-stretch or shift a stem.

## Diagnostics and Readiness

Every diagnostic has a stable code, severity, message, and relevant evidence.

Severity values:

- `info`
- `warning`
- `error`

Errors block approval. Warnings require review but may be accepted explicitly.

Approval is blocked when:

- The grid is missing or invalid.
- Measure 1, Beat 1 cannot be established.
- Regions overlap or fail to reach song duration.
- A cue target does not exist.
- A required cue phrase is outside the approved vocabulary.
- The master key is missing and no detected key has been approved.
- A live stem is missing or unreadable.
- Stem timing differs beyond the permitted tolerance.
- Source fingerprints no longer match.

## Complete Example: `playback-song.json`

This is a complete four-measure 4/4 demonstration at 120 BPM and 48 kHz. The cue at Measure 2 announces the Chorus that begins at Measure 3.

```json
{
  "schema": "playback-analyzer-package/v1",
  "schemaVersion": 1,
  "packageId": "song-demo-001-analysis-2026-08-04",
  "generatedAt": "2026-08-04T18:00:00.000Z",
  "analyzer": {
    "name": "Worship Song Analyzer",
    "version": "3.0.0"
  },
  "review": {
    "status": "approved",
    "revision": 1,
    "approvedAt": "2026-08-04T18:10:00.000Z",
    "approvedBy": "Luis"
  },
  "master": {
    "catalogId": "song-demo-001",
    "title": "Example Song",
    "artist": "Example Artist",
    "vendor": "Example Vendor",
    "originalBpm": 120,
    "bpmBeatUnit": "quarter",
    "originalTimeSignature": {
      "numerator": 4,
      "denominator": 4
    },
    "originalKey": "E",
    "ccli": null
  },
  "timeline": {
    "timelineSampleRate": 48000,
    "durationSamples": 384000,
    "durationMs": 8000
  },
  "audioFiles": [
    {
      "id": "stem-keys-01",
      "path": "Piano.wav",
      "format": "wav",
      "sha256": "45c91c1f4223e014ddc9c73ca9031c1c5ef5a64fb917351a589f3014525c8f2a",
      "sampleRate": 48000,
      "channels": 2,
      "durationSamples": 384000,
      "durationMs": 8000,
      "timelineOffsetSamples": 0,
      "role": "keys",
      "playbackBus": "keys",
      "playLive": true,
      "classification": {
        "method": "filename",
        "confidence": 1.0
      }
    },
    {
      "id": "stem-drums-01",
      "path": "Drums.wav",
      "format": "wav",
      "sha256": "72f8f47b2426b14d15cf818f76d5cb38759f18904de3ff5fa578b6f648a155d9",
      "sampleRate": 48000,
      "channels": 2,
      "durationSamples": 384000,
      "durationMs": 8000,
      "timelineOffsetSamples": 0,
      "role": "drums",
      "playbackBus": "drums",
      "playLive": true,
      "classification": {
        "method": "filename",
        "confidence": 1.0
      }
    },
    {
      "id": "reference-click-01",
      "path": "Click.wav",
      "format": "wav",
      "sha256": "6c9a6adc89a3f740eabdad8f3f8babe07c93982fd3f39fc5e54fe7a43f622e88",
      "sampleRate": 48000,
      "channels": 1,
      "durationSamples": 384000,
      "durationMs": 8000,
      "timelineOffsetSamples": 0,
      "role": "click-reference",
      "playbackBus": null,
      "playLive": false,
      "classification": {
        "method": "filename",
        "confidence": 1.0
      }
    },
    {
      "id": "reference-cue-01",
      "path": "Cue.wav",
      "format": "wav",
      "sha256": "30dc87819e5fe4ae081376d385339e8d683604a19b6372ca4526f9427c667895",
      "sampleRate": 48000,
      "channels": 1,
      "durationSamples": 384000,
      "durationMs": 8000,
      "timelineOffsetSamples": 0,
      "role": "cue-reference",
      "playbackBus": null,
      "playLive": false,
      "classification": {
        "method": "filename",
        "confidence": 1.0
      }
    }
  ],
  "grid": {
    "ppq": 960,
    "origin": {
      "sampleFrame": 0,
      "timeMs": 0,
      "position": { "measure": 1, "beat": 1, "tick": 0 }
    },
    "tempoSegments": [
      {
        "start": {
          "sampleFrame": 0,
          "timeMs": 0,
          "position": { "measure": 1, "beat": 1, "tick": 0 }
        },
        "bpm": 120,
        "beatUnit": "quarter",
        "confidence": 0.99
      }
    ],
    "meterSegments": [
      {
        "start": {
          "sampleFrame": 0,
          "timeMs": 0,
          "position": { "measure": 1, "beat": 1, "tick": 0 }
        },
        "numerator": 4,
        "denominator": 4
      }
    ],
    "anchors": [
      { "sampleFrame": 0, "timeMs": 0, "position": { "measure": 1, "beat": 1, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 24000, "timeMs": 500, "position": { "measure": 1, "beat": 2, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 48000, "timeMs": 1000, "position": { "measure": 1, "beat": 3, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 72000, "timeMs": 1500, "position": { "measure": 1, "beat": 4, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 96000, "timeMs": 2000, "position": { "measure": 2, "beat": 1, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 120000, "timeMs": 2500, "position": { "measure": 2, "beat": 2, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 144000, "timeMs": 3000, "position": { "measure": 2, "beat": 3, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 168000, "timeMs": 3500, "position": { "measure": 2, "beat": 4, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 192000, "timeMs": 4000, "position": { "measure": 3, "beat": 1, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 216000, "timeMs": 4500, "position": { "measure": 3, "beat": 2, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 240000, "timeMs": 5000, "position": { "measure": 3, "beat": 3, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 264000, "timeMs": 5500, "position": { "measure": 3, "beat": 4, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 288000, "timeMs": 6000, "position": { "measure": 4, "beat": 1, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 312000, "timeMs": 6500, "position": { "measure": 4, "beat": 2, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 336000, "timeMs": 7000, "position": { "measure": 4, "beat": 3, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 360000, "timeMs": 7500, "position": { "measure": 4, "beat": 4, "tick": 0 }, "confidence": 0.99 },
      { "sampleFrame": 384000, "timeMs": 8000, "position": { "measure": 5, "beat": 1, "tick": 0 }, "confidence": 0.99 }
    ],
    "drift": {
      "maximumMs": 3,
      "status": "within-tolerance"
    }
  },
  "click": {
    "referenceAudioId": "reference-click-01",
    "templateId": "4-4-quarter",
    "resolution": "normal",
    "stepsPerMeasure": 4,
    "pattern": ["primary", "normal", "normal", "normal"],
    "phaseTicks": 0,
    "confidence": 0.99,
    "reviewStatus": "approved"
  },
  "regions": [
    {
      "id": "region-intro-01",
      "sectionType": "intro",
      "displayName": "Intro",
      "occurrence": 1,
      "start": {
        "sampleFrame": 0,
        "timeMs": 0,
        "position": { "measure": 1, "beat": 1, "tick": 0 }
      },
      "end": {
        "sampleFrame": 192000,
        "timeMs": 4000,
        "position": { "measure": 3, "beat": 1, "tick": 0 }
      },
      "confidence": 0.98,
      "reviewStatus": "approved",
      "evidence": ["cue-reference", "grid"]
    },
    {
      "id": "region-chorus-01",
      "sectionType": "chorus",
      "displayName": "Chorus",
      "occurrence": 1,
      "start": {
        "sampleFrame": 192000,
        "timeMs": 4000,
        "position": { "measure": 3, "beat": 1, "tick": 0 }
      },
      "end": {
        "sampleFrame": 384000,
        "timeMs": 8000,
        "position": { "measure": 5, "beat": 1, "tick": 0 }
      },
      "confidence": 0.98,
      "reviewStatus": "approved",
      "evidence": ["cue-reference", "grid"]
    }
  ],
  "cues": [
    {
      "id": "cue-chorus-01",
      "referenceAudioId": "reference-cue-01",
      "rawTranscript": "chorus",
      "spokenPhrase": "Chorus",
      "start": {
        "sampleFrame": 96000,
        "timeMs": 2000,
        "position": { "measure": 2, "beat": 1, "tick": 0 }
      },
      "end": {
        "sampleFrame": 117600,
        "timeMs": 2450,
        "position": { "measure": 2, "beat": 1, "tick": 864 }
      },
      "warningMeasureStart": {
        "sampleFrame": 96000,
        "timeMs": 2000,
        "position": { "measure": 2, "beat": 1, "tick": 0 }
      },
      "targetRegionId": "region-chorus-01",
      "confidence": 0.99,
      "reviewStatus": "approved"
    }
  ],
  "keyAnalysis": {
    "masterKey": "E",
    "detectedKey": "E",
    "mode": "major",
    "confidence": 0.93,
    "status": "confirmed-by-master",
    "supportingAudioIds": ["stem-keys-01"],
    "excludedAudio": [
      { "audioId": "stem-drums-01", "reason": "non-harmonic" },
      { "audioId": "reference-click-01", "reason": "click-reference" },
      { "audioId": "reference-cue-01", "reason": "cue-reference" }
    ],
    "alternatives": [
      { "key": "C#m", "confidence": 0.04 }
    ]
  },
  "diagnostics": [
    {
      "code": "GRID_DRIFT_WITHIN_TOLERANCE",
      "severity": "info",
      "message": "Maximum detected grid drift is 3 ms."
    }
  ],
  "readiness": {
    "metadataComplete": true,
    "operatorReviewRequired": false,
    "performanceEligible": true
  }
}
```

## Missing-Key Example

If the spreadsheet contains no original key, the analyzer must not mark the package performance-ready automatically:

```json
{
  "masterKey": null,
  "detectedKey": "Bb",
  "mode": "major",
  "confidence": 0.87,
  "status": "needs-operator-approval",
  "approvedKey": null
}
```

After approval:

```json
{
  "masterKey": null,
  "detectedKey": "Bb",
  "mode": "major",
  "confidence": 0.87,
  "status": "operator-approved",
  "approvedKey": "Bb"
}
```

## Playback Consumption Rules

Playback performs the following sequence:

1. Validate `schema` and `schemaVersion`.
2. Verify source fingerprints.
3. Apply master spreadsheet authority rules.
4. Reject unapproved blocking diagnostics.
5. Load the explicit grid anchors.
6. Load regions and resolve every cue's `targetRegionId`.
7. Map live audio files to Playback buses.
8. Select click sounds from the Playback click library using `templateId` and `pattern`.
9. Generate approved cue audio from `spokenPhrase` during Confirm Set preparation.
10. Build waveform and local playback caches.
11. Copy all runtime assets into the Confirmed Set.
12. Enter Performance Mode without Dropbox, analyzer, Reaper, or source-folder dependencies.

Playback must not:

- Recalculate the grid from BPM when approved anchors exist.
- Move a region because a click transient is offset.
- Infer cue targets using nearest timestamps.
- Replace master facts with analyzer estimates.
- Use reference click or cue tracks as live music stems.
- Modify the Original Song map when editing a saved arrangement.

## Modular Validation Suite

The analyzer validation suite should test independent capabilities:

- Source-of-truth precedence
- Audio inventory and fingerprints
- Stem alignment
- Measure 1 origin detection
- Constant-tempo grid accuracy
- Drift and tempo-change mapping
- 4/4 click template selection
- 6/8 click template and pulse selection
- Double-time click recognition
- Cue transcription
- Cue vocabulary normalization
- One-measure cue-to-region relationship
- Region continuity and final duration
- Key estimation and conflict handling
- Filename-first stem classification
- Missing-key approval gate
- JSON schema validation
- Playback import round-trip

The final acceptance test is not merely that the analyzer produced JSON. Playback must load the package, display the same grid and regions, generate the expected click and cue schedule, and prepare a performance-ready Confirmed Set without making any new musical inference.

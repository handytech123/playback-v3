import assert from "node:assert/strict";
import test from "node:test";
import {
  applyArrangementCommand,
  arrangementSourceFingerprint,
  createArrangementDraft,
  reconcileArrangementDraftSource,
  validateArrangementDraft,
} from "../src/edit/arrangement-editor.js";
import { songId, type PreparedSong } from "../src/domain/song.js";
import { saveAppArrangement } from "../src/edit/app-arrangement-save.js";
const song: PreparedSong = {
  song: {
    id: songId("s"),
    title: "Song",
    artist: "A",
    vendor: "V",
    originalKey: "C",
    originalBpm: 120,
    originalTimeSignature: { numerator: 4, denominator: 4 },
  },
  selectedKey: "C",
  selectedBpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  durationSeconds: 12,
  stems: [{ role: "music", sourcePath: "music.wav", durationSeconds: 12 }],
  regions: [
    { id: "a", name: "Verse 1", startSeconds: 0, endSeconds: 4 },
    { id: "b", name: "Chorus 1", startSeconds: 4, endSeconds: 8 },
    { id: "c", name: "Verse 2", startSeconds: 8, endSeconds: 12 },
  ],
  cues: [{ phrase: "Chorus", atSeconds: 3, targetRegionId: "b" }],
  cacheFingerprint: "x",
};
const pos = (measure: number, beat: number) => ({ measure, beat, tick: 0 });
test("moves, duplicates, deletes, and reflows non-destructive source slices", () => {
  let draft = createArrangementDraft(song);
  draft = applyArrangementCommand(draft, {
    type: "move-section",
    sectionId: "b",
    toIndex: 0,
  });
  assert.deepEqual(
    draft.sections.map((x) => [x.id, x.startSeconds, x.sourceStartSeconds]),
    [
      ["b", 0, 4],
      ["a", 4, 0],
      ["c", 8, 8],
    ],
  );
  draft = applyArrangementCommand(draft, {
    type: "duplicate-section",
    sectionId: "b",
    newSectionId: "b2",
  });
  assert.equal(draft.durationSeconds, 16);
  assert.equal(draft.sections[1]?.sourceRegionId, "b");
  draft = applyArrangementCommand(draft, {
    type: "delete-section",
    sectionId: "a",
  });
  assert.equal(draft.durationSeconds, 12);
  assert.deepEqual(
    draft.sections.map((x) => x.startSeconds),
    [0, 4, 8],
  );
});
test("trims source slices, renames, and changes arrangement facts only", () => {
  let draft = createArrangementDraft(song);
  draft = applyArrangementCommand(draft, {
    type: "trim-start",
    atPosition: pos(2, 1),
  });
  draft = applyArrangementCommand(draft, {
    type: "trim-end",
    atPosition: pos(5, 3),
  });
  draft = applyArrangementCommand(draft, {
    type: "rename-section",
    sectionId: "b",
    name: "Big Chorus",
  });
  draft = applyArrangementCommand(draft, {
    type: "set-key-tempo",
    key: "D",
    bpm: 100,
  });
  assert.ok(Math.abs(draft.durationSeconds - 10.8) < 1e-9);
  assert.equal(draft.sections[0]?.sourceStartSeconds, 2);
  assert.equal(draft.sections.at(-1)?.sourceEndSeconds, 11);
  assert.equal(draft.sections.find((x) => x.id === "b")?.name, "Big Chorus");
  assert.equal(song.selectedKey, "C");
});
test("rejects invalid drafts before rendering", () => {
  const draft = createArrangementDraft(song),
    broken = {
      ...draft,
      sections: draft.sections.map((section, index) =>
        index === 1 ? { ...section, startSeconds: 5 } : section,
      ),
      cues: [
        ...draft.cues,
        {
          ...draft.cues[0]!,
          id: "bad-cue",
          phrase: "Missing",
          atSeconds: 99,
          targetRegionId: "missing",
        },
      ],
    };
  const issues = validateArrangementDraft(broken);
  assert.ok(issues.some((issue) => issue.includes("Gap or overlap")));
  assert.ok(issues.some((issue) => issue.includes("Invalid cue")));
});
test("save service rejects an invalid draft before touching render inputs", async () => {
  const draft = createArrangementDraft(song),
    broken = { ...draft, name: "" };
  await assert.rejects(
    saveAppArrangement({
      draft: broken,
      source: song,
      metadataRoot: "unused",
      cacheRoot: "unused",
    }),
    /Arrangement name is missing/,
  );
});
test("splits and creates named regions from a timeline selection without a gap", () => {
  let draft = createArrangementDraft(song);
  draft = applyArrangementCommand(draft, {
    type: "split-section",
    atPosition: pos(2, 1),
    newSectionId: "a-right",
  });
  assert.deepEqual(
    draft.sections
      .slice(0, 2)
      .map((section) => [
        section.startSeconds,
        section.endSeconds,
        section.sourceStartSeconds,
        section.sourceEndSeconds,
      ]),
    [
      [0, 2, 0, 2],
      [2, 4, 2, 4],
    ],
  );
  draft = applyArrangementCommand(draft, {
    type: "create-region-from-selection",
    startPosition: pos(3, 3),
    endPosition: pos(4, 3),
    name: "Build",
  });
  assert.equal(
    draft.sections.find((section) => section.name === "Build")
      ?.sourceStartSeconds,
    5,
  );
  assert.deepEqual(
    draft.sections.map((section) => section.startSeconds).slice(1),
    draft.sections.map((section) => section.endSeconds).slice(0, -1),
  );
});
test("region edits keep destination cue names and duplicate Slides MIDI with their source section", () => {
  const withMidi: PreparedSong = {
    ...song,
    arrangement: {
      id: "r",
      name: "R",
      sourceType: "reaper-import",
      sourceSha256: "x",
      proPresenterMidi: [{ atSeconds: 5, status: 144, data1: 60, data2: 100 }],
      midiOutputName: null,
    },
  };
  let draft = createArrangementDraft(withMidi);
  draft = applyArrangementCommand(draft, {
    type: "rename-section",
    sectionId: "b",
    name: "Big Chorus",
  });
  assert.equal(
    draft.cues.find((cue) => cue.targetRegionId === "b")?.phrase,
    "Big Chorus",
  );
  draft = applyArrangementCommand(draft, {
    type: "duplicate-section",
    sectionId: "b",
    newSectionId: "b2",
  });
  assert.equal(draft.midi.length, 2);
  assert.ok(draft.midi.some((event) => event.id.startsWith("b2:")));
  draft = applyArrangementCommand(draft, {
    type: "delete-section",
    sectionId: "b",
  });
  assert.equal(draft.midi.length, 1);
  assert.equal(
    draft.cues.find((cue) => cue.targetRegionId === "b2")?.phrase,
    "Big Chorus",
  );
  assert.deepEqual(validateArrangementDraft(draft), []);
});
test("Original Song control metadata supplies Slides MIDI without becoming an arrangement", () => {
  const originalWithMidi: PreparedSong = {
    ...song,
    control: {
      sourceType: "reaper-import",
      sourceSha256: "slides",
      proPresenterMidi: [{ atSeconds: 5, status: 144, data1: 19, data2: 2 }],
      midiOutputName: null,
    },
  };
  assert.equal(originalWithMidi.arrangement, undefined);
  assert.equal(createArrangementDraft(originalWithMidi).midi.length, 1);
});

test("source reconciliation imports new cues and MIDI while preserving operator choices", () => {
  const original: PreparedSong = {
    ...song,
    control: { sourceType: "reaper-import", sourceSha256: "old", midiOutputName: null, proPresenterMidi: [] },
    liveAssets: { click: { regularPath: "click.wav", accentPath: "accent.wav", events: [], templateId: "4-4-quarter" }, cues: [{ label: "Chorus", atSeconds: 3, targetRegionId: "b", audioPath: "chorus.wav" }], repeatCuePath: "repeat.wav", pad: { key: "C", audioPath: "pad.wav" } },
  };
  let saved = createArrangementDraft(original);
  saved = applyArrangementCommand(saved, { type: "set-name", name: "Operator Arrangement" });
  saved = applyArrangementCommand(saved, { type: "set-key-tempo", key: "Bb", bpm: 100 });
  const refreshed: PreparedSong = {
    ...original,
    control: { sourceType: "reaper-import", sourceSha256: "new", midiOutputName: null, proPresenterMidi: [{ atSeconds: 9, status: 0x90, data1: 19, data2: 4 }] },
    cues: [...original.cues, { phrase: "Verse", atSeconds: 7, targetRegionId: "c" }],
    liveAssets: { ...original.liveAssets!, cues: [...original.liveAssets!.cues, { label: "Verse", atSeconds: 7, targetRegionId: "c", audioPath: "verse.wav" }] },
  };
  assert.notEqual(arrangementSourceFingerprint(original), arrangementSourceFingerprint(refreshed));
  const merged = reconcileArrangementDraftSource(saved, createArrangementDraft(refreshed));
  assert.equal(merged.name, "Operator Arrangement");
  assert.equal(merged.selectedKey, "Bb");
  assert.equal(merged.selectedBpm, 100);
  assert.deepEqual(merged.cues.map(cue => cue.sourceRegionId), ["b", "c"]);
  assert.equal(merged.midi.length, 1);
  assert.equal(merged.sourceFingerprint, arrangementSourceFingerprint(refreshed));
  assert.deepEqual(validateArrangementDraft(merged), []);
});
test("arrangement drafts preserve source lead-in before the first RPP region", () => {
  const withLeadIn: PreparedSong = {
    ...song,
    durationSeconds: 12,
    regions: [
      { id: "intro", name: "Intro", startSeconds: 2, endSeconds: 6 },
      { id: "verse", name: "Verse", startSeconds: 6, endSeconds: 12 },
    ],
    cues: [
      { phrase: "Intro", atSeconds: 0, targetRegionId: "intro" },
      { phrase: "Verse", atSeconds: 5, targetRegionId: "verse" },
    ],
  };
  const draft = createArrangementDraft(withLeadIn);
  assert.deepEqual(
    draft.sections.map((section) => [
      section.name,
      section.startSeconds,
      section.endSeconds,
      section.sourceStartSeconds,
      section.sourceEndSeconds,
    ]),
    [
      ["Count Off", 0, 2, 0, 2],
      ["Intro", 2, 6, 2, 6],
      ["Verse", 6, 12, 6, 12],
    ],
  );
  assert.equal(draft.durationSeconds, 12);
  assert.deepEqual(
    draft.cues.map((cue) => [cue.phrase, cue.atSeconds, cue.targetRegionId]),
    [
      ["Intro", 0, "intro"],
      ["Verse", 5, "verse"],
    ],
  );
});
test("numbers every repeated canonical section and keeps cues on the numbered destination", () => {
  const repeated: PreparedSong = {
    ...song,
    regions: [
      { id: "v1", name: "Verse", startSeconds: 0, endSeconds: 4 },
      { id: "v2", name: "Verse 2", startSeconds: 4, endSeconds: 8 },
      { id: "end", name: "End", startSeconds: 8, endSeconds: 12 },
    ],
  };
  let draft = createArrangementDraft(repeated);
  assert.deepEqual(
    draft.sections.map((section) => section.name),
    ["Verse 1", "Verse 2", "End"],
  );
  draft = applyArrangementCommand(draft, {
    type: "duplicate-section",
    sectionId: "v1",
    newSectionId: "v3",
  });
  assert.deepEqual(
    draft.sections.slice(0, 3).map((section) => section.name),
    ["Verse 1", "Verse 2", "Verse 3"],
  );
  assert.ok(
    draft.cues.every(
      (cue) =>
        draft.sections.find((section) => section.id === cue.targetRegionId)
          ?.name === cue.phrase,
    ),
  );
});
test("cue markers can move while remaining before their announced section", () => {
  const draft = createArrangementDraft(song),
    cue = draft.cues.find((item) => item.targetRegionId === "b")!,
    moved = applyArrangementCommand(draft, {
      type: "set-cue-time",
      cueId: cue.id,
      atPosition: pos(2, 1),
    });
  assert.equal(moved.cues.find((item) => item.id === cue.id)?.atSeconds, 2);
  const clamped = applyArrangementCommand(moved, {
    type: "set-cue-time",
    cueId: cue.id,
    atPosition: pos(99, 1),
  });
  assert.equal(
    clamped.cues.find((item) => item.id === cue.id)?.atSeconds,
    clamped.sections.find((item) => item.id === "b")?.startSeconds,
  );
});
test("typed region boundaries move the shared cut without gaps", () => {
  const draft = createArrangementDraft(song),
    moved = applyArrangementCommand(draft, {
      type: "set-section-boundary",
      sectionId: "b",
      edge: "start",
      atPosition: pos(2, 3),
    });
  assert.deepEqual(
    moved.sections
      .slice(0, 2)
      .map((section) => [
        section.startSeconds,
        section.endSeconds,
        section.sourceStartSeconds,
        section.sourceEndSeconds,
      ]),
    [
      [0, 3, 0, 3],
      [3, 8, 3, 8],
    ],
  );
  assert.deepEqual(validateArrangementDraft(moved), []);
});
test("click template is an arrangement choice that does not change BPM or grid", () => {
  const draft = createArrangementDraft(song),
    eighths = applyArrangementCommand(draft, {
      type: "set-click-template",
      templateId: "4-4-eighth",
    });
  assert.equal(eighths.clickTemplateId, "4-4-eighth");
  assert.equal(eighths.selectedBpm, 120);
  assert.deepEqual(eighths.timeSignature, { numerator: 4, denominator: 4 });
});
test("regions without source cue markers do not invent unavailable spoken cues", () => {
  let draft = createArrangementDraft(song);
  assert.deepEqual(
    draft.cues.map((cue) => cue.targetRegionId),
    ["b"],
  );
  draft = applyArrangementCommand(draft, {
    type: "move-section",
    sectionId: "a",
    toIndex: 2,
  });
  assert.deepEqual(
    draft.cues.map((cue) => cue.targetRegionId),
    ["b"],
  );
  draft = applyArrangementCommand(draft, {
    type: "duplicate-section",
    sectionId: "b",
    newSectionId: "b2",
  });
  assert.deepEqual(
    draft.cues.map((cue) => cue.targetRegionId),
    ["b", "b2"],
  );
});
test("editor drafts persist musical positions and accept edits only as measure and beat", () => {
  const draft = createArrangementDraft(song);
  assert.deepEqual(draft.sections[1]?.startPosition, pos(3, 1));
  assert.deepEqual(draft.cues[0]?.position, pos(2, 3));
  const moved = applyArrangementCommand(draft, {
    type: "set-cue-time",
    cueId: draft.cues[0]!.id,
    atPosition: pos(2, 1),
  });
  assert.deepEqual(moved.cues[0]?.position, pos(2, 1));
});
test("slide ticks move with their note-off, edit values, add, delete, and keep note 18 automatic", () => {
  const controlled: PreparedSong = {
    ...song,
    control: {
      sourceType: "reaper-import",
      sourceSha256: "slides",
      midiOutputName: null,
      proPresenterMidi: [
        { atSeconds: 0, status: 0x90, data1: 18, data2: 7 },
        { atSeconds: 0.1, status: 0x80, data1: 18, data2: 0 },
        { atSeconds: 4, status: 0x90, data1: 19, data2: 2 },
        { atSeconds: 4.25, status: 0x80, data1: 19, data2: 0 },
      ],
    },
  };
  let draft = createArrangementDraft(controlled),
    slide = draft.midi.find((event) => event.data1 === 19 && event.data2 > 0)!;
  draft = applyArrangementCommand(draft, {
    type: "set-midi-time",
    eventId: slide.id,
    atPosition: pos(4, 1),
  });
  const movedOn = draft.midi.find(
      (event) => event.data1 === 19 && event.data2 > 0,
    )!,
    movedOff = draft.midi.find(
      (event) => event.data1 === 19 && event.data2 === 0,
    )!;
  assert.equal(movedOn.atSeconds, 6);
  assert.equal(movedOff.atSeconds, 6.25);
  draft = applyArrangementCommand(draft, {
    type: "set-midi-value",
    eventId: movedOn.id,
    value: 9,
  });
  assert.equal(
    draft.midi.find((event) => event.data1 === 19 && event.data2 > 0)?.data2,
    9,
  );
  const automatic = draft.midi.find(
    (event) => event.data1 === 18 && event.data2 > 0,
  )!;
  assert.throws(
    () =>
      applyArrangementCommand(draft, {
        type: "set-midi-value",
        eventId: automatic.id,
        value: 4,
      }),
    /Only fixed note 17 and note 19/,
  );
  draft = applyArrangementCommand(draft, {
    type: "add-slide-midi",
    atPosition: pos(5, 1),
    value: 10,
  });
  assert.equal(
    draft.midi.filter(
      (event) =>
        event.data1 === 19 && (event.status & 0xf0) === 0x90 && event.data2 > 0,
    ).length,
    2,
  );
  const added = draft.midi.find(
    (event) => event.data1 === 19 && event.data2 === 10,
  )!;
  draft = applyArrangementCommand(draft, {
    type: "delete-midi-event",
    eventId: added.id,
  });
  assert.equal(
    draft.midi.some((event) => event.data1 === 19 && event.data2 === 10),
    false,
  );
  assert.deepEqual(validateArrangementDraft(draft), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  proPresenterApiSlideEvents,
  proPresenterCueIndexFromMidiValue,
  proPresenterDueSlideEvents,
} from "../src/control/propresenter-api-slides.js";
import { songId, type PreparedSong } from "../src/domain/song.js";

const baseSong: PreparedSong = {
  song: {
    id: songId("slides"),
    title: "Slides",
    artist: "Artist",
    vendor: "Vendor",
    originalKey: "C",
    originalBpm: 120,
    originalTimeSignature: { numerator: 4, denominator: 4 },
  },
  selectedKey: "C",
  selectedBpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  durationSeconds: 60,
  stems: [],
  regions: [],
  cues: [],
  cacheFingerprint: "slides",
  control: {
    sourceType: "reaper-import",
    sourceSha256: "sha",
    midiOutputName: null,
    proPresenterMidi: [
      { atSeconds: 0, status: 0x90, data1: 18, data2: 1 },
      { atSeconds: 4, status: 0x90, data1: 19, data2: 2 },
      { atSeconds: 4.2, status: 0x80, data1: 19, data2: 0 },
      { atSeconds: 4.35, status: 0x90, data1: 19, data2: 3 },
      { atSeconds: 12, status: 0x90, data1: 19, data2: 0 },
    ],
  },
};

test("ProPresenter API slide events include only slide note-ons", () => {
  const events = proPresenterApiSlideEvents(baseSong);
  assert.deepEqual(
    events.map(({ event }) => [event.atSeconds, event.data1, event.data2]),
    [
      [4, 19, 2],
      [4.35, 19, 3],
    ],
  );
});

test("ProPresenter API slide window catches crossed events and skips fired keys", () => {
  const events = proPresenterApiSlideEvents(baseSong),
    first = proPresenterDueSlideEvents(events, {
      fromSeconds: 3.9,
      toSeconds: 4.5,
      firedKeys: new Set(),
    });
  assert.deepEqual(first.map(({ event }) => event.data2), [2, 3]);
  const fired = new Set([first[0]!.key]);
  assert.deepEqual(
    proPresenterDueSlideEvents(events, {
      fromSeconds: 3.9,
      toSeconds: 4.5,
      firedKeys: fired,
    }).map(({ event }) => event.data2),
    [3],
  );
});

test("ProPresenter API cue indexes are zero-based while MIDI values stay one-based", () => {
  assert.equal(proPresenterCueIndexFromMidiValue(1), 0);
  assert.equal(proPresenterCueIndexFromMidiValue(2), 1);
  assert.equal(proPresenterCueIndexFromMidiValue(24), 23);
});

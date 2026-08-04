import assert from "node:assert/strict";
import test from "node:test";
import { spokenCuePhrase } from "./arrangement-confirm.js";

test("saved arrangements do not speak region occurrence numbers", () => {
  assert.equal(spokenCuePhrase("Verse 1"), "Verse");
  assert.equal(spokenCuePhrase("Chorus 12"), "Chorus");
  assert.equal(spokenCuePhrase("  Bridge 2  "), "Bridge");
  assert.equal(spokenCuePhrase("Interlude"), "Interlude");
});

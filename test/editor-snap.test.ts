import test from "node:test";
import assert from "node:assert/strict";
import { buildZeroBasedGrid } from "../src/domain/grid.js";
import { snapEditorPosition } from "../src/edit/editor-snap.js";

const grid = buildZeroBasedGrid(120, { numerator: 4, denominator: 4 }, 8);

test("editor transport snaps to the nearest beat", () => {
  assert.equal(snapEditorPosition(grid, 1.31, "beat"), 1.5);
  assert.equal(snapEditorPosition(grid, 1.18, "beat"), 1);
});

test("editor transport snaps to the nearest measure boundary", () => {
  assert.equal(snapEditorPosition(grid, 1.31, "measure"), 2);
  assert.equal(snapEditorPosition(grid, 0.7, "measure"), 0);
});

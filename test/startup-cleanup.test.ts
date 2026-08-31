import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearGeneratedSongStateAtStartup } from "../src/desktop/startup-cleanup.js";

test("packaged startup clears only generated song and browser caches", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-startup-cleanup-"));
  await Promise.all([
    mkdir(join(root, ".playback-cache", "library-review"), { recursive: true }),
    mkdir(join(root, ".playback-data", "editor-drafts"), { recursive: true }),
    mkdir(join(root, ".playback-metadata", "song"), { recursive: true }),
    mkdir(join(root, "Cache"), { recursive: true }),
    mkdir(join(root, "Code Cache"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, ".playback-cache", "library-review", "stale.json"), "stale"),
    writeFile(join(root, ".playback-data", "library-index.json"), "stale"),
    writeFile(join(root, ".playback-data", "device-settings.json"), "device"),
    writeFile(join(root, ".playback-data", "draft-setlist.json"), "setlist"),
    writeFile(join(root, ".playback-data", "editor-drafts", "draft.json"), "draft"),
    writeFile(join(root, ".playback-metadata", "song", "arrangement.json"), "arrangement"),
    writeFile(join(root, "Cache", "cache.bin"), "cache"),
    writeFile(join(root, "Code Cache", "code.bin"), "code"),
  ]);

  await clearGeneratedSongStateAtStartup(root, true);

  assert.equal(await readFile(join(root, ".playback-data", "device-settings.json"), "utf8"), "device");
  assert.equal(await readFile(join(root, ".playback-data", "draft-setlist.json"), "utf8"), "setlist");
  assert.equal(await readFile(join(root, ".playback-data", "editor-drafts", "draft.json"), "utf8"), "draft");
  assert.equal(await readFile(join(root, ".playback-metadata", "song", "arrangement.json"), "utf8"), "arrangement");
  await assert.rejects(readFile(join(root, ".playback-cache", "library-review", "stale.json")));
  await assert.rejects(readFile(join(root, ".playback-data", "library-index.json")));
  await assert.rejects(readFile(join(root, "Cache", "cache.bin")));
  await assert.rejects(readFile(join(root, "Code Cache", "code.bin")));
});

test("development startup leaves local data untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-startup-cleanup-dev-"));
  await mkdir(join(root, ".playback-cache"), { recursive: true });
  await writeFile(join(root, ".playback-cache", "keep.json"), "keep");
  await clearGeneratedSongStateAtStartup(root, false);
  assert.equal(await readFile(join(root, ".playback-cache", "keep.json"), "utf8"), "keep");
});

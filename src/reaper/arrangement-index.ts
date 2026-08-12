import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ArrangementVersion } from "./arrangement.js";

export interface SourceArrangementIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly songId: string;
  readonly sourceType: ArrangementVersion["sourceType"];
  readonly sourceSha256: string;
  readonly selectedKey: string | null;
  readonly selectedBpm: number;
  readonly timeSignature: string;
  readonly arrangementPath: string;
  readonly performanceManifestPath: string;
  readonly updatedAt: string;
}

interface SourceArrangementIndex {
  readonly schemaVersion: 1;
  readonly songId: string;
  readonly updatedAt: string;
  readonly arrangements: readonly SourceArrangementIndexEntry[];
}

export function sourceArrangementIndexPath(sourceSongFolder: string): string {
  return join(sourceSongFolder, "Arrangements", "arrangement-index.json");
}

export async function registerSourceArrangement(input: {
  readonly sourceSongFolder: string;
  readonly arrangement: ArrangementVersion;
  readonly arrangementPath: string;
  readonly performanceManifestPath: string;
}): Promise<string> {
  const root = join(input.sourceSongFolder, "Arrangements");
  const indexPath = sourceArrangementIndexPath(input.sourceSongFolder);
  const existing = await loadSourceArrangementIndex(indexPath, String(input.arrangement.songId));
  const updatedAt = new Date().toISOString();
  const entry: SourceArrangementIndexEntry = {
    id: input.arrangement.id,
    name: input.arrangement.name,
    songId: String(input.arrangement.songId),
    sourceType: input.arrangement.sourceType,
    sourceSha256: input.arrangement.sourceSha256,
    selectedKey: input.arrangement.selectedKey,
    selectedBpm: input.arrangement.selectedBpm,
    timeSignature: `${input.arrangement.timeSignature.numerator}/${input.arrangement.timeSignature.denominator}`,
    arrangementPath: portableRelative(root, input.arrangementPath),
    performanceManifestPath: portableRelative(root, input.performanceManifestPath),
    updatedAt,
  };
  const arrangements = [...existing.arrangements.filter((item) => item.id !== entry.id), entry].sort((a, b) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const next: SourceArrangementIndex = {
    schemaVersion: 1,
    songId: String(input.arrangement.songId),
    updatedAt,
    arrangements,
  };
  await atomicWriteJson(indexPath, next);
  return indexPath;
}

export async function registeredSourceArrangementManifestPaths(sourceSongFolder: string): Promise<string[]> {
  const root = join(sourceSongFolder, "Arrangements");
  let parsed: SourceArrangementIndex;
  try {
    parsed = JSON.parse(await readFile(sourceArrangementIndexPath(sourceSongFolder), "utf8")) as SourceArrangementIndex;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.arrangements)) return [];
  return parsed.arrangements
    .map((item) => (typeof item.performanceManifestPath === "string" ? resolve(root, item.performanceManifestPath) : ""))
    .filter(Boolean);
}

async function loadSourceArrangementIndex(path: string, songId: string): Promise<SourceArrangementIndex> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as SourceArrangementIndex;
    if (parsed.schemaVersion === 1 && parsed.songId === songId && Array.isArray(parsed.arrangements)) return parsed;
  } catch {}
  return { schemaVersion: 1, songId, updatedAt: new Date(0).toISOString(), arrangements: [] };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type SharedCandidateStatus = "review" | "missing-folder" | "insufficient-source" | "manual-map-required" | "failed";

export interface SharedCandidateIndexEntry {
  readonly catalogId: string;
  readonly title: string;
  readonly artist: string;
  readonly vendor: string;
  readonly bpm: number;
  readonly key: string | null;
  readonly estimatedKey: string | null;
  readonly timeSignature: string;
  readonly folderRelativePath: string;
  readonly status: SharedCandidateStatus;
  readonly candidateFile: string | null;
  readonly issue: string | null;
}

export interface SharedCandidateIndex {
  readonly schema: "playback-v3-shared-library";
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly catalogSongs: number;
  readonly entries: readonly SharedCandidateIndexEntry[];
}

export async function loadSharedCandidateIndex(sharedMetadataRoot: string): Promise<SharedCandidateIndex | null> {
  try {
    const parsed = JSON.parse(await readFile(join(sharedMetadataRoot, "library-index-v3.json"), "utf8")) as SharedCandidateIndex;
    if (parsed.schema !== "playback-v3-shared-library" || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error("Unsupported shared library index");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function sharedCandidateMap(index: SharedCandidateIndex | null): ReadonlyMap<string, SharedCandidateIndexEntry> {
  return new Map((index?.entries ?? []).map((entry) => [entry.catalogId, entry]));
}

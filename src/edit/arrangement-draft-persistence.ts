import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppArrangementDraft } from "./arrangement-editor.js";
import { validateArrangementDraft } from "./arrangement-editor.js";
import { requiredDefaultClickTemplate } from "../domain/click-templates.js";

export function arrangementDraftPath(root: string, songId: string, sourceId: string) {
  return join(root, "editor-drafts", safe(songId), `${safe(sourceId)}.json`);
}

export async function saveArrangementDraft(path: string, draft: AppArrangementDraft) {
  const issues = validateArrangementDraft(draft);
  if (issues.length) throw new Error(`Draft is invalid: ${issues.join("; ")}`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(draft, null, 2));
  const { rename } = await import("node:fs/promises");
  await rename(temporary, path);
  return path;
}

export async function loadArrangementDraft(path: string, baseSongId: string) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as AppArrangementDraft;
    const draft = { ...parsed, clickTemplateId: parsed.clickTemplateId ?? requiredDefaultClickTemplate(parsed.timeSignature) };
    if (draft.schemaVersion !== 1 || draft.baseSongId !== baseSongId) return null;
    if (validateArrangementDraft(draft).length) return null;
    return draft;
  } catch {
    return null;
  }
}

function safe(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "source";
}

import { open, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";

export interface ClickSoundSettings {
  readonly schemaVersion: 1;
  readonly normalPath: string;
  readonly accentPath: string;
  readonly updatedAt: string;
}

export async function loadClickSoundSettings(path: string, defaults: { normalPath: string; accentPath: string }): Promise<ClickSoundSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.schemaVersion !== 1 || typeof parsed.normalPath !== "string" || typeof parsed.accentPath !== "string") throw new Error("Unsupported click sound settings");
    await Promise.all([validateClickSound(parsed.normalPath), validateClickSound(parsed.accentPath)]);
    return parsed;
  } catch {
    return { schemaVersion: 1, ...defaults, updatedAt: new Date().toISOString() };
  }
}

export async function saveClickSoundSettings(path: string, settings: ClickSoundSettings): Promise<void> {
  await Promise.all([validateClickSound(settings.normalPath), validateClickSound(settings.accentPath)]);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function validateClickSound(path: string): Promise<void> {
  if (extname(path).toLowerCase() !== ".wav") throw new Error("Click sounds must be WAV files");
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const container = header.toString("ascii", 0, 4);
    if (bytesRead !== 12 || !["RIFF", "RF64"].includes(container) || header.toString("ascii", 8, 12) !== "WAVE") throw new Error("The selected file is not a valid WAV audio file");
  } finally {
    await handle.close();
  }
}

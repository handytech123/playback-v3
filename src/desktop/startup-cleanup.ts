import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export async function clearGeneratedSongStateAtStartup(
  projectRoot: string,
  packaged: boolean,
): Promise<void> {
  if (!packaged) return;
  await Promise.all([
    rm(join(projectRoot, ".playback-cache"), { recursive: true, force: true }),
    rm(join(projectRoot, ".playback-data", "library-index.json"), { force: true }),
    rm(join(projectRoot, "Cache"), { recursive: true, force: true }),
    rm(join(projectRoot, "Code Cache"), { recursive: true, force: true }),
  ]);
  await mkdir(join(projectRoot, ".playback-cache"), { recursive: true });
}

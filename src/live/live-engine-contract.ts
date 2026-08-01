import { validateConfirmedSet, type ConfirmedSetManifest } from "../confirmed-set/manifest.js";

export interface TransportSnapshot {
  readonly state: "idle" | "armed" | "playing" | "paused" | "stopped";
  readonly songIndex: number | null;
  readonly positionSeconds: number;
}

export interface LiveEngine {
  arm(manifest: ConfirmedSetManifest, songIndex: number): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(positionSeconds: number): void;
  snapshot(): TransportSnapshot;
}

/**
 * Contract harness for UI and prep integration. This deliberately performs no
 * filesystem access: a native engine will replace its clock/audio behavior.
 */
export class InMemoryLiveEngine implements LiveEngine {
  private manifest: ConfirmedSetManifest | null = null;
  private current: TransportSnapshot = { state: "idle", songIndex: null, positionSeconds: 0 };

  async arm(manifest: ConfirmedSetManifest, songIndex: number): Promise<void> {
    const report = validateConfirmedSet(manifest);
    if (!report.ready) throw new Error(`Confirmed set is not ready: ${report.issues.map((x) => x.message).join("; ")}`);
    if (!manifest.songs[songIndex]) throw new Error("Song index is outside the confirmed set");
    this.manifest = manifest;
    this.current = { state: "armed", songIndex, positionSeconds: 0 };
  }

  play(): void {
    this.assertArmed();
    this.current = { ...this.current, state: "playing" };
  }

  pause(): void {
    if (this.current.state !== "playing") throw new Error("Only a playing engine can pause");
    this.current = { ...this.current, state: "paused" };
  }

  stop(): void {
    this.assertArmed();
    this.current = { ...this.current, state: "stopped", positionSeconds: 0 };
  }

  seek(positionSeconds: number): void {
    this.assertArmed();
    const song = this.manifest!.songs[this.current.songIndex!];
    if (!song || positionSeconds < 0 || positionSeconds > song.durationSeconds) {
      throw new Error("Seek position is outside the prepared song");
    }
    this.current = { ...this.current, positionSeconds };
  }

  snapshot(): TransportSnapshot {
    return { ...this.current };
  }

  private assertArmed(): void {
    if (!this.manifest || this.current.songIndex === null) throw new Error("No confirmed song is armed");
  }
}


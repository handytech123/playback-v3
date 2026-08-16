import type { PerformanceReadinessReport } from "./performance-readiness.js";
import type { SongTransitionPlan } from "./song-transition.js";

export interface TimedSongTransitionEffects {
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly stop: () => void;
  readonly selectSong: (index: number) => Promise<PerformanceReadinessReport>;
  readonly setPad: (enabled: boolean) => void;
  readonly play: () => void;
}

/**
 * Safe single-engine fallback for timed transitions. The current song keeps
 * playing through its remaining transition window, then the preloaded next
 * song is activated and started. This guarantees forward progress until the
 * native engine supports two simultaneously audible song graphs.
 */
export async function runTimedSongTransition(
  plan: SongTransitionPlan,
  effects: TimedSongTransitionEffects,
): Promise<PerformanceReadinessReport> {
  await effects.wait(Math.max(0, plan.durationSeconds) * 1000);
  effects.stop();
  const readiness = await effects.selectSong(plan.toSongIndex);
  if (!readiness.ready) return readiness;
  effects.setPad(plan.continuePad);
  effects.play();
  return readiness;
}

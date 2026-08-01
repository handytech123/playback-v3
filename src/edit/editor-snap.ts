import type { GridPosition } from "../domain/grid.js";

export type EditorSnapMode = "beat" | "measure";

export function snapEditorPosition(
  grid: readonly GridPosition[],
  atSeconds: number,
  mode: EditorSnapMode,
): number {
  if (!grid.length || !Number.isFinite(atSeconds)) return 0;
  const candidates = mode === "measure" ? grid.filter((position) => position.beat === 1) : grid;
  const available = candidates.length ? candidates : grid;
  return available.reduce((closest, position) =>
    Math.abs(position.timeSeconds - atSeconds) < Math.abs(closest.timeSeconds - atSeconds)
      ? position
      : closest,
  ).timeSeconds;
}

import type { NativeAudioRouting } from "../live/native-engine-client.js";

/**
 * Carries saved operator routing forward when the selected song has a
 * different stem count. Existing stem assignments remain stable; new stems
 * receive the device-appropriate fallback and removed stems are discarded.
 */
export function reconcileAudioRouting(
  saved: NativeAudioRouting | null | undefined,
  fallback: NativeAudioRouting,
  stemCount: number,
): NativeAudioRouting {
  const source = saved ?? fallback;
  const validOutput = (value: unknown, alternative: number): number =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 32 ? Number(value) : alternative;
  const validWidth = (value: unknown, alternative: 1 | 2): 1 | 2 => value === 1 || value === 2 ? value : alternative;
  const stemOutput = (index: number): number => validOutput(source.stems[index], fallback.stems[index] ?? 0);
  const stemWidth = (index: number): 1 | 2 => validWidth(source.stemChannels[index], fallback.stemChannels[index] ?? 1);

  return {
    stems: Array.from({ length: stemCount }, (_, index) => stemOutput(index)),
    stemChannels: Array.from({ length: stemCount }, (_, index) => stemWidth(index)),
    click: validOutput(source.click, fallback.click),
    clickChannels: validWidth(source.clickChannels, fallback.clickChannels),
    cue: validOutput(source.cue, fallback.cue),
    cueChannels: validWidth(source.cueChannels, fallback.cueChannels),
    pad: validOutput(source.pad, fallback.pad),
    padChannels: validWidth(source.padChannels, fallback.padChannels),
    iem: validOutput(source.iem, fallback.iem),
    iemChannels: validWidth(source.iemChannels, fallback.iemChannels),
  };
}

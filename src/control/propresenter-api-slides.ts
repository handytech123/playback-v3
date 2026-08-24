import type { PreparedMidiEvent, PreparedSong } from "../domain/song.js";
import { preparedControl } from "../domain/song.js";

export interface ProPresenterSlideCandidate {
  readonly event: PreparedMidiEvent;
  readonly key: string;
}

export interface ProPresenterSlideWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly firedKeys: ReadonlySet<string>;
}

export function proPresenterApiSlideEvents(
  song: PreparedSong,
): readonly ProPresenterSlideCandidate[] {
  return (preparedControl(song)?.proPresenterMidi ?? [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => isProPresenterSlideMidiEvent(event))
    .sort((left, right) => left.event.atSeconds - right.event.atSeconds)
    .map(({ event, index }) => ({
      event,
      key: `${index}:${event.atSeconds.toFixed(3)}:${event.status}:${event.data1}:${event.data2}`,
    }));
}

export function proPresenterDueSlideEvents(
  events: readonly ProPresenterSlideCandidate[],
  window: ProPresenterSlideWindow,
): readonly ProPresenterSlideCandidate[] {
  return events.filter(({ event, key }) => {
    if (window.firedKeys.has(key)) return false;
    return event.atSeconds >= window.fromSeconds && event.atSeconds <= window.toSeconds;
  });
}

export function proPresenterCueIndexFromMidiValue(value: number): number {
  return Math.max(0, Math.trunc(value) - 1);
}

function isProPresenterSlideMidiEvent(event: PreparedMidiEvent): boolean {
  return (event.status & 0xf0) === 0x90 && event.data1 === 19 && event.data2 > 0;
}

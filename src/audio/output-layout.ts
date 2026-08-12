export interface PlaybackOutputDefinition {
  readonly output: number;
  readonly key: string;
  readonly appBus: string;
  readonly danteLabel: string;
  readonly format: "mono";
  readonly destination: string;
}

export const PLAYBACK_OUTPUT_PROFILE = "playback-12-mono-v3";

export const PLAYBACK_OUTPUTS: readonly PlaybackOutputDefinition[] = [
  { output: 1, key: "click", appBus: "Dynamic Click", danteLabel: "PB_CLICK", format: "mono", destination: "GLD Input 30" },
  { output: 2, key: "cue", appBus: "Dynamic Cue", danteLabel: "PB_CUE", format: "mono", destination: "GLD Input 31" },
  { output: 3, key: "iem", appBus: "PB_IEM", danteLabel: "PB_IEM", format: "mono", destination: "Direct IEM destination" },
  { output: 4, key: "acoustic", appBus: "Playback Acoustic", danteLabel: "PB_ACOUSTIC", format: "mono", destination: "GLD Input 33" },
  { output: 5, key: "electric", appBus: "Playback Electric", danteLabel: "PB_ELECTRIC", format: "mono", destination: "GLD Input 34" },
  { output: 6, key: "bass", appBus: "Playback Bass", danteLabel: "PB_BASS", format: "mono", destination: "GLD Input 35" },
  { output: 7, key: "keys", appBus: "Playback Keys", danteLabel: "PB_KEYS", format: "mono", destination: "GLD Input 36" },
  { output: 8, key: "strings", appBus: "Playback Strings", danteLabel: "PB_STRINGS", format: "mono", destination: "GLD Input 37" },
  { output: 9, key: "drums", appBus: "Playback Drums", danteLabel: "PB_DRUMS", format: "mono", destination: "GLD Input 38" },
  { output: 10, key: "vocals", appBus: "Playback Vocals", danteLabel: "PB_VOCALS", format: "mono", destination: "GLD Input 39" },
  { output: 11, key: "other", appBus: "Playback Other", danteLabel: "PB_OTHER", format: "mono", destination: "GLD Input 40" },
  { output: 12, key: "pad", appBus: "Dynamic Pad", danteLabel: "PB_PAD", format: "mono", destination: "GLD Input 41" },
] as const;

export const INSTRUMENT_OUTPUTS = PLAYBACK_OUTPUTS.filter(({ output }) => output >= 4 && output <= 11);
export const DEFAULT_INSTRUMENT_OUTPUTS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(INSTRUMENT_OUTPUTS.map(({ key, output }) => [key, output])));

export function classifyStemOutput(label: string): string {
  const value = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(drum|drums|kick|snare|tom|cymbal|hi hat|hihat|loop|loops|shaker|tambourine|percussion|perc|conga|bongo|clap)\b/.test(value)) return "drums";
  if (/\bbass\b/.test(value)) return "bass";
  if (/\b(acoustic|ac gtr|acoustic guitar)\b/.test(value)) return "acoustic";
  if (/\b(electric|guitar|gtr)\b/.test(value)) return "electric";
  if (/\b(piano|organ|rhodes|synth|synths|keyboard|keys)\b/.test(value)) return "keys";
  if (/\b(string|strings|cello|violin|viola|orchestra|orchestral|horn|horns|brass|trumpet|trombone|sax|saxophone|flute|woodwind)\b/.test(value)) return "strings";
  if (/\b(vocal|vocals|bgv|bgvs|choir)\b/.test(value)) return "vocals";
  if (/\bpad\b/.test(value)) return "pad";
  if (/\b(fx|effect|effects|misc)\b/.test(value)) return "other";
  return "other";
}

export interface PlaybackOutputDefinition {
  readonly output: number;
  readonly key: string;
  readonly appBus: string;
  readonly danteLabel: string;
  readonly format: "mono";
  readonly destination: string;
}

export const PLAYBACK_OUTPUT_PROFILE = "playback-16-mono-v1";

export const PLAYBACK_OUTPUTS: readonly PlaybackOutputDefinition[] = [
  { output: 1, key: "click", appBus: "Dynamic Click", danteLabel: "PB_CLICK", format: "mono", destination: "GLD Input 30" },
  { output: 2, key: "cue", appBus: "Dynamic Cue", danteLabel: "PB_CUE", format: "mono", destination: "GLD Input 31" },
  { output: 3, key: "iem-left", appBus: "IEM Send Left", danteLabel: "PB_IEM_L", format: "mono", destination: "Direct IEM destination" },
  { output: 4, key: "iem-right", appBus: "IEM Send Right", danteLabel: "PB_IEM_R", format: "mono", destination: "Direct IEM destination" },
  { output: 5, key: "drums", appBus: "Playback Drums", danteLabel: "PB_DRUMS", format: "mono", destination: "GLD Input 33" },
  { output: 6, key: "percussion", appBus: "Playback Percussion", danteLabel: "PB_PERC", format: "mono", destination: "GLD Input 34" },
  { output: 7, key: "bass", appBus: "Playback Bass", danteLabel: "PB_BASS", format: "mono", destination: "GLD Input 35" },
  { output: 8, key: "acoustic", appBus: "Playback Acoustic", danteLabel: "PB_ACOUSTIC", format: "mono", destination: "GLD Input 36" },
  { output: 9, key: "electric", appBus: "Playback Electric", danteLabel: "PB_ELECTRIC", format: "mono", destination: "GLD Input 37" },
  { output: 10, key: "piano", appBus: "Playback Piano", danteLabel: "PB_PIANO", format: "mono", destination: "GLD Input 38" },
  { output: 11, key: "organ", appBus: "Playback Organ", danteLabel: "PB_ORGAN", format: "mono", destination: "GLD Input 39" },
  { output: 12, key: "synths", appBus: "Playback Synths", danteLabel: "PB_SYNTHS", format: "mono", destination: "GLD Input 40" },
  { output: 13, key: "orchestra", appBus: "Playback Orchestra", danteLabel: "PB_ORCHESTRA", format: "mono", destination: "GLD Input 41" },
  { output: 14, key: "vocals", appBus: "Playback Vocals", danteLabel: "PB_VOCALS", format: "mono", destination: "GLD Input 42" },
  { output: 15, key: "misc", appBus: "Playback Misc", danteLabel: "PB_MISC", format: "mono", destination: "GLD Input 43" },
  { output: 16, key: "pad", appBus: "Playback Pad", danteLabel: "PB_PAD", format: "mono", destination: "GLD Input 44" },
] as const;

export const INSTRUMENT_OUTPUTS = PLAYBACK_OUTPUTS.filter(({ output }) => output >= 5 && output <= 15);
export const DEFAULT_INSTRUMENT_OUTPUTS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(INSTRUMENT_OUTPUTS.map(({ key, output }) => [key, output])));

export function classifyStemOutput(label: string): string {
  const value = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(shaker|tambourine|percussion|perc|conga|bongo|clap)\b/.test(value)) return "percussion";
  if (/\b(drum|drums|kick|snare|tom|cymbal|hi hat|hihat)\b/.test(value)) return "drums";
  if (/\bbass\b/.test(value)) return "bass";
  if (/\b(acoustic|ac gtr|acoustic guitar)\b/.test(value)) return "acoustic";
  if (/\b(electric|guitar|gtr)\b/.test(value)) return "electric";
  if (/\bpiano\b/.test(value)) return "piano";
  if (/\borgan\b/.test(value)) return "organ";
  if (/\b(synth|synths|keyboard|keys)\b/.test(value)) return "synths";
  if (/\b(string|strings|cello|violin|viola|orchestra|orchestral)\b/.test(value)) return "orchestra";
  if (/\b(vocal|vocals|bgv|bgvs|choir)\b/.test(value)) return "vocals";
  if (/\bpad\b/.test(value)) return "pad";
  if (/\b(horn|horns|brass|trumpet|trombone|sax|saxophone|flute|woodwind|loop|loops|fx|effect|effects|misc)\b/.test(value)) return "misc";
  return "misc";
}

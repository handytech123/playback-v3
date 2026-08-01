import { Socket } from "node:net";

export type GldStrip =
  | { readonly kind: "input"; readonly number: number }
  | { readonly kind: "mix"; readonly number: number }
  | { readonly kind: "dca"; readonly number: number }
  | { readonly kind: "fx-send"; readonly number: number }
  | { readonly kind: "fx-return"; readonly number: number };
export type GldIntent =
  | { readonly type: "mute"; readonly strip: GldStrip; readonly muted: boolean }
  | { readonly type: "fader"; readonly strip: GldStrip; readonly db: number | "-inf" }
  | { readonly type: "scene"; readonly scene: number };
export interface GldProfile { readonly model: "GLD-112"; readonly midiChannel: number; readonly host: string; readonly port: number; }
export interface GldPreview { readonly intent: GldIntent; readonly bytes: readonly number[]; readonly hex: string; }
export type GldTestState = "disabled" | "disconnected" | "connection-tested" | "fault";

export function encodeGldIntent(intent: GldIntent, midiChannel: number): GldPreview {
  const channel = midiStatusChannel(midiChannel);
  let bytes: number[];
  if (intent.type === "mute") { const strip = stripCode(intent.strip), velocity = intent.muted ? 0x7f : 0x3f; bytes = [0x90 | channel, strip, velocity, 0x90 | channel, strip, 0]; }
  else if (intent.type === "fader") { const strip = stripCode(intent.strip), level = gldFaderValue(intent.db); bytes = [0xb0 | channel, 0x63, strip, 0xb0 | channel, 0x62, 0x17, 0xb0 | channel, 0x06, level]; }
  else { if (!Number.isInteger(intent.scene) || intent.scene < 1 || intent.scene > 500) throw new Error("GLD scene must be between 1 and 500"); const zero = intent.scene - 1, bank = Math.floor(zero / 128), program = zero % 128; bytes = [0xb0 | channel, 0x00, bank, 0xc0 | channel, program]; }
  return { intent: structuredClone(intent), bytes, hex: bytes.map(value => value.toString(16).padStart(2, "0").toUpperCase()).join(" ") };
}

export function stripCode(strip: GldStrip): number {
  const ranges = { "fx-send": [1, 8, 0x00], "fx-return": [1, 8, 0x08], dca: [1, 16, 0x10], input: [1, 48, 0x20], mix: [1, 20, 0x60] } as const;
  const [minimum, maximum, offset] = ranges[strip.kind]; if (!Number.isInteger(strip.number) || strip.number < minimum || strip.number > maximum) throw new Error(`GLD ${strip.kind} number must be between ${minimum} and ${maximum}`); return offset + strip.number - 1;
}

export function gldFaderValue(db: number | "-inf"): number {
  if (db === "-inf") return 0;
  if (!Number.isFinite(db) || db < -40 || db > 10) throw new Error("GLD fader dB must be -inf or between -40 and +10");
  const points = [[-40, 0x1b], [-35, 0x25], [-30, 0x2f], [-25, 0x39], [-20, 0x43], [-15, 0x4d], [-10, 0x57], [-5, 0x61], [0, 0x6b], [5, 0x74], [10, 0x7f]] as const;
  for (let index = 0; index < points.length - 1; index++) { const lower = points[index]!, upper = points[index + 1]!; if (db >= lower[0] && db <= upper[0]) return Math.round(lower[1] + (upper[1] - lower[1]) * ((db - lower[0]) / (upper[0] - lower[0]))); }
  return 0;
}

export class Gld112SafeClient {
  private current: GldTestState = "disconnected"; private fault: string | null = null;
  constructor(readonly profile: GldProfile) { validateProfile(profile); }
  get state(): { status: GldTestState; fault: string | null } { return { status: this.current, fault: this.fault }; }
  preview(intent: GldIntent): GldPreview { return encodeGldIntent(intent, this.profile.midiChannel); }
  async testConnection(timeoutMs = 1500): Promise<void> { const socket = new Socket(); try { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { socket.destroy(); reject(new Error("GLD connection timed out")); }, timeoutMs); socket.once("error", error => { clearTimeout(timer); reject(error); }); socket.connect(this.profile.port, this.profile.host, () => { clearTimeout(timer); resolve(); }); }); this.current = "connection-tested"; this.fault = null; } catch (error) { this.current = "fault"; this.fault = error instanceof Error ? error.message : String(error); throw error; } finally { socket.destroy(); } }
  async send(): Promise<never> { throw new Error("GLD writes are locked until the physical test/learn acceptance is approved"); }
}

function midiStatusChannel(channel: number): number { if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error("GLD MIDI channel must be between 1 and 16"); return channel - 1; }
function validateProfile(profile: GldProfile): void { if (profile.model !== "GLD-112") throw new Error("Unsupported mixer profile"); midiStatusChannel(profile.midiChannel); if (!profile.host.trim()) throw new Error("GLD host is required"); if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new Error("GLD port is invalid"); }

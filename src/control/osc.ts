import type { PlaybackCommand } from "./command-bus.js";

export type OscArgument = string | number;
export interface OscMessage { readonly address: string; readonly args: readonly OscArgument[]; }

export function decodeOscMessage(packet: Buffer): OscMessage {
  const address = readString(packet, 0); if (!address.value.startsWith("/")) throw new Error("Invalid OSC address");
  const tags = readString(packet, address.next); if (!tags.value.startsWith(",")) throw new Error("Invalid OSC type tag");
  const args: OscArgument[] = []; let offset = tags.next;
  for (const tag of tags.value.slice(1)) {
    if (tag === "s") { const value = readString(packet, offset); args.push(value.value); offset = value.next; }
    else if (tag === "i") { requireBytes(packet, offset, 4); args.push(packet.readInt32BE(offset)); offset += 4; }
    else if (tag === "f") { requireBytes(packet, offset, 4); args.push(packet.readFloatBE(offset)); offset += 4; }
    else throw new Error(`Unsupported OSC type: ${tag}`);
  }
  return { address: address.value, args };
}

export function encodeOscMessage(message: OscMessage): Buffer {
  const tags = message.args.map(value => typeof value === "string" ? "s" : Number.isInteger(value) ? "i" : "f").join("");
  const chunks = [writeString(message.address), writeString(`,${tags}`)];
  for (const value of message.args) { if (typeof value === "string") chunks.push(writeString(value)); else { const bytes = Buffer.alloc(4); Number.isInteger(value) ? bytes.writeInt32BE(value) : bytes.writeFloatBE(value); chunks.push(bytes); } }
  return Buffer.concat(chunks);
}

export function oscToPlaybackCommand(message: OscMessage): PlaybackCommand {
  const address = message.address.replace(/\/$/, "");
  const simple: Record<string, PlaybackCommand["type"]> = { "/playback/play": "transport.play", "/playback/pause": "transport.pause", "/playback/stop": "transport.stop", "/playback/panic": "panic.enter", "/playback/next": "section.next", "/playback/previous": "section.previous", "/playback/cue-next": "song.cue-next" };
  if (simple[address]) return { type: simple[address] } as PlaybackCommand;
  const region: Record<string, "panic.recover" | "section.jump" | "section.loop" | "section.repeat-once"> = { "/playback/recover": "panic.recover", "/playback/jump": "section.jump", "/playback/loop": "section.loop", "/playback/repeat": "section.repeat-once" };
  if (region[address]) { const regionId = message.args[0]; if (typeof regionId !== "string" || !regionId) throw new Error("OSC region command requires a region id"); return { type: region[address], regionId }; }
  if (address === "/playback/song") { const index = message.args[0]; if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw new Error("OSC song index must be a non-negative integer"); return { type: "song.select", index }; }
  const busMatch = address.match(/^\/playback\/bus\/(music|click|cue|pad)$/); if (busMatch) { const value = message.args[0]; if (typeof value !== "number") throw new Error("OSC bus state must be numeric"); return { type: "bus.set", bus: busMatch[1] as "music" | "click" | "cue" | "pad", enabled: value !== 0 }; }
  const gainMatch = address.match(/^\/playback\/gain\/(music|click|cue|pad)$/); if (gainMatch) { const gain = message.args[0]; if (typeof gain !== "number") throw new Error("OSC gain must be numeric"); return { type: "bus.gain", bus: gainMatch[1] as "music" | "click" | "cue" | "pad", gain }; }
  throw new Error(`Unsupported OSC address: ${address}`);
}

function readString(packet: Buffer, start: number): { value: string; next: number } { const end = packet.indexOf(0, start); if (end < 0) throw new Error("OSC string is not terminated"); const next = align4(end + 1); requireBytes(packet, 0, next); return { value: packet.toString("utf8", start, end), next }; }
function writeString(value: string): Buffer { const content = Buffer.from(value, "utf8"), result = Buffer.alloc(align4(content.length + 1)); content.copy(result); return result; }
function align4(value: number): number { return Math.ceil(value / 4) * 4; }
function requireBytes(packet: Buffer, offset: number, count: number): void { if (offset < 0 || offset + count > packet.length) throw new Error("Truncated OSC packet"); }

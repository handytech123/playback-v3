import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

export interface NativeReadyState {
  readonly deviceOpenMs: number; readonly armMs: number; readonly stems: number;
  readonly clickEvents?: number; readonly cueEvents?: number; readonly padKey?: string;
  readonly midiEvents?: number; readonly midiEnabled?: boolean; readonly midiInputEnabled?: boolean;
  readonly outputChannels?: number; readonly routingReady?: boolean; readonly iemReady?: boolean;
  readonly stereoFallback?: boolean; readonly nextReady?: boolean; readonly nextIndex?: number;
}
export interface NativeAudioDeviceSelection { readonly type: string; readonly name: string; readonly outputChannels?: number; readonly maxOutputChannels?: number; }
export interface NativeAudioRouting { readonly stems: readonly number[]; readonly stemChannels: readonly (1|2)[]; readonly click: number; readonly clickChannels:1|2; readonly cue: number; readonly cueChannels:1|2; readonly pad: number; readonly padChannels:1|2; readonly iem: number; readonly iemChannels:1|2; }
export interface NativeTransportState { readonly state: "playing" | "paused"; readonly positionSeconds: number; readonly startLatencyMs?: number; }
export interface NativeSongSelectionState extends NativeReadyState { readonly index: number; }
export interface NativeMidiInputEvent { readonly status: number; readonly data1: number; readonly data2: number; }
export interface NativeMixerMeters { readonly master: number; readonly channels: readonly number[]; }

export function nativeRoutingCommand(routing:NativeAudioRouting):string {
  const values=["routing",String(routing.stems.length)];
  for(let index=0;index<routing.stems.length;index++)values.push(String(routing.stems[index]),String(routing.stemChannels[index]));
  values.push(String(routing.click),String(routing.clickChannels),String(routing.cue),String(routing.cueChannels),String(routing.pad),String(routing.padChannels),String(routing.iem),String(routing.iemChannels));
  return values.join(" ");
}

export function parseNativeLine(line: string): NativeReadyState | NativeTransportState | null {
  const fields = fieldsFromLine(line);
  if (line.startsWith("READY ")) return {
    deviceOpenMs: numberField(fields, "device_open_ms"), armMs: numberField(fields, "arm_ms"), stems: numberField(fields, "stems"),
    ...(fields.click_events ? { clickEvents: numberField(fields, "click_events") } : {}),
    ...(fields.cue_events ? { cueEvents: numberField(fields, "cue_events") } : {}),
    ...(fields.pad_key ? { padKey: fields.pad_key } : {}),
    ...(fields.midi_events ? { midiEvents: numberField(fields, "midi_events") } : {}),
    ...(fields.midi_enabled ? { midiEnabled: fields.midi_enabled === "1" } : {}),
    ...(fields.midi_input_enabled ? { midiInputEnabled: fields.midi_input_enabled === "1" } : {}),
    ...(fields.output_channels ? { outputChannels: numberField(fields, "output_channels") } : {}),
    ...(fields.routing_ready ? { routingReady: fields.routing_ready === "1" } : {}),
    ...(fields.iem_ready ? { iemReady: fields.iem_ready === "1" } : {}),
    ...(fields.stereo_fallback ? { stereoFallback: fields.stereo_fallback === "1" } : {}),
    ...(fields.next_ready ? { nextReady: fields.next_ready === "1" } : {}),
    ...(fields.next_index ? { nextIndex: numberField(fields, "next_index") } : {}),
  };
  if (line.startsWith("STATE ")) {
    const state = fields.state;
    if (state !== "playing" && state !== "paused") throw new Error(`Unknown native transport state: ${state}`);
    return { state, positionSeconds: numberField(fields, "position_seconds"), ...(fields.start_latency_ms ? { startLatencyMs: numberField(fields, "start_latency_ms") } : {}) };
  }
  return null;
}

export function parseNativeMeters(line: string): NativeMixerMeters | null {
  if (!line.startsWith("METERS ")) return null;
  const fields = fieldsFromLine(line), channels = (fields.channels ?? "").split(",").filter(Boolean).map(Number);
  if (channels.some((value) => !Number.isFinite(value))) throw new Error("Invalid native mixer channel meter");
  return { master: numberField(fields, "master"), channels };
}

export class NativeEngineClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly expectedExits = new WeakSet<ChildProcessWithoutNullStreams>();

  get isRunning(): boolean { return this.process !== null; }

  async start(executablePath: string, manifestPath: string, songIndex = 0, midiOutputName?: string | null, audioDevice?: NativeAudioDeviceSelection | null, midiInputName?: string | null, routing?: NativeAudioRouting): Promise<NativeReadyState> {
    if (this.process) throw new Error("Native engine is already running");
    const args = [manifestPath, "--interactive", "--song-index", String(songIndex)];
    if (midiOutputName === null) args.push("--disable-midi"); else if (midiOutputName) args.push("--midi-output", midiOutputName);
    if (midiInputName === null) args.push("--disable-midi-input"); else if (midiInputName) args.push("--midi-input", midiInputName);
    if (audioDevice) { args.push("--audio-device-type", audioDevice.type, "--audio-device-name", audioDevice.name); if(audioDevice.outputChannels)args.push("--output-count",String(audioDevice.outputChannels)); }
    if(routing){for(let index=0;index<routing.stems.length;index++)args.push("--stem-output",String(routing.stems[index]),"--stem-channels",String(routing.stemChannels[index]));args.push("--click-output",String(routing.click),"--click-channels",String(routing.clickChannels),"--cue-output",String(routing.cue),"--cue-channels",String(routing.cueChannels),"--pad-output",String(routing.pad),"--pad-channels",String(routing.padChannels),"--iem-output",String(routing.iem),"--iem-channels",String(routing.iemChannels));}
    const child = spawn(executablePath, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;
    child.once("exit", (code) => { if (this.process === child) this.process = null; if (!this.expectedExits.has(child)) this.emit("fault", new Error(`Native audio engine stopped unexpectedly (${code ?? "no exit code"})`)); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      this.emit("native-line", line);
      const message = parseNativeLine(line);
      if (message && "positionSeconds" in message) this.emit("transport", message);
      const meters = parseNativeMeters(line); if (meters) this.emit("meters", meters);
      if (line.startsWith("MIDI_IN ")) { const fields = fieldsFromLine(line); this.emit("midi-input", { status: numberField(fields, "status"), data1: numberField(fields, "data1"), data2: numberField(fields, "data2") } satisfies NativeMidiInputEvent); }
    });
    return await new Promise<NativeReadyState>((resolve, reject) => {
      const onLine = (line: string): void => { const message = parseNativeLine(line); if (message && "deviceOpenMs" in message) { lines.off("line", onLine); resolve(message); } };
      lines.on("line", onLine); child.once("error", reject); child.once("exit", (code) => { if (code !== 0) reject(new Error(`Native engine exited with code ${code}`)); });
    });
  }

  play(): void { this.send("play"); }
  pause(): void { this.send("pause"); }
  stop(): void { this.send("stop"); }
  seek(seconds: number): void { if (seconds < 0 || !Number.isFinite(seconds)) throw new Error("Seek must be non-negative"); this.send(`seek ${seconds}`); }
  requestStatus(): void { this.send("status"); }
  padOn(): void { this.send("pad_on"); } padOff(): void { this.send("pad_off"); }
  musicOn(): void { this.send("music_on"); } musicOff(): void { this.send("music_off"); }
  clickOn(): void { this.send("click_on"); } clickOff(): void { this.send("click_off"); }
  cueOn(): void { this.send("cue_on"); } cueOff(): void { this.send("cue_off"); }
  slidesMidiOn(): void { this.send("slides_midi_on"); } slidesMidiOff(): void { this.send("slides_midi_off"); }
  setCueTime(targetRegionId:string,atSeconds:number):void { if(!/^[a-zA-Z0-9._:-]+$/.test(targetRegionId)||!Number.isFinite(atSeconds)||atSeconds<0)throw new Error("Cue schedule update is invalid");this.send(`cue_time ${targetRegionId} ${atSeconds}`); }
  panic(): void { this.send("panic"); }
  announceRecovery(regionId: string, atSeconds: number, repeatAtSeconds: number | null): void { if (!/^[a-zA-Z0-9._:-]+$/.test(regionId) || !Number.isFinite(atSeconds) || atSeconds < 0 || repeatAtSeconds !== null && (!Number.isFinite(repeatAtSeconds) || repeatAtSeconds < 0 || repeatAtSeconds >= atSeconds)) throw new Error("Recovery announcement is invalid"); this.send(`announce_recovery ${regionId} ${atSeconds} ${repeatAtSeconds ?? -1}`); }
  cancelTransition(): void { this.send("cancel_transition"); } recover(): void { this.send("recover"); }
  setBusGain(bus: "music" | "click" | "cue" | "pad", gain: number): void { validateGain(gain); this.send(`gain ${bus} ${gain}`); }
  setMixerChannel(index: number, gain: number, muted: boolean, solo: boolean, iem: boolean): void { if (!Number.isInteger(index) || index < 0) throw new Error("Mixer channel index must be non-negative"); validateGain(gain); this.send(`mixer_channel ${index} ${gain} ${muted ? 1 : 0} ${solo ? 1 : 0} ${iem ? 1 : 0}`); }
  setMasterGain(gain: number): void { validateGain(gain); this.send(`master_gain ${gain}`); }
  setRouting(routing:NativeAudioRouting):Promise<void>{
    if(routing.stems.length!==routing.stemChannels.length)throw new Error("Every stem route requires a channel width");
    return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.off("native-line",onLine);reject(new Error("Native routing update timed out"));},3000),onLine=(line:string):void=>{if(line.startsWith("ROUTING_FAILED")){clearTimeout(timeout);this.off("native-line",onLine);reject(new Error(line));}else if(line.startsWith("ROUTING_UPDATED")){clearTimeout(timeout);this.off("native-line",onLine);resolve();}};this.on("native-line",onLine);this.send(nativeRoutingCommand(routing));});
  }
  selectSong(index: number): Promise<NativeSongSelectionState> {
    if (!Number.isInteger(index) || index < 0) throw new Error("Song index must be non-negative");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.off("native-line", onLine); reject(new Error("Native song selection timed out")); }, 10000);
      const onLine = (line: string): void => {
        if (line.startsWith("SELECT_FAILED ")) { clearTimeout(timeout); this.off("native-line", onLine); reject(new Error(line)); }
        else if (line.startsWith("SELECTED ")) { clearTimeout(timeout); this.off("native-line", onLine); const fields = fieldsFromLine(line); resolve({ index: numberField(fields, "index"), deviceOpenMs: numberField(fields, "device_open_ms"), armMs: numberField(fields, "arm_ms"), stems: numberField(fields, "stems"), clickEvents: numberField(fields, "click_events"), cueEvents: numberField(fields, "cue_events"), padKey: fields.pad_key ?? "", midiEvents: numberField(fields, "midi_events"), midiEnabled: fields.midi_enabled === "1", outputChannels: numberField(fields, "output_channels"), routingReady: fields.routing_ready === "1", iemReady: fields.iem_ready === "1", stereoFallback: fields.stereo_fallback === "1", nextReady: fields.next_ready === "1", nextIndex: numberField(fields, "next_index") }); }
      };
      this.on("native-line", onLine); this.send(`select_song ${index}`);
    });
  }
  selectManifest(manifestPath:string,index:number):Promise<NativeSongSelectionState>{
    if(!manifestPath||!Number.isInteger(index)||index<0)throw new Error("Manifest song selection is invalid");
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.off("native-line",onLine);reject(new Error("Native manifest selection timed out"));},10000);
      const onLine=(line:string):void=>{
        if(line.startsWith("SELECT_FAILED ")){clearTimeout(timeout);this.off("native-line",onLine);reject(new Error(line));}
        else if(line.startsWith("SELECTED ")){clearTimeout(timeout);this.off("native-line",onLine);const fields=fieldsFromLine(line);resolve({index:numberField(fields,"index"),deviceOpenMs:numberField(fields,"device_open_ms"),armMs:numberField(fields,"arm_ms"),stems:numberField(fields,"stems"),clickEvents:numberField(fields,"click_events"),cueEvents:numberField(fields,"cue_events"),padKey:fields.pad_key??"",midiEvents:numberField(fields,"midi_events"),midiEnabled:fields.midi_enabled==="1",outputChannels:numberField(fields,"output_channels"),routingReady:fields.routing_ready==="1",iemReady:fields.iem_ready==="1",stereoFallback:fields.stereo_fallback==="1",nextReady:fields.next_ready==="1",nextIndex:numberField(fields,"next_index")});}
      };
      this.on("native-line",onLine);this.send(`select_manifest ${index} ${JSON.stringify(manifestPath)}`);
    });
  }
  close(): void { if (this.process) { this.expectedExits.add(this.process); this.process.stdin.write("quit\n"); this.process = null; } }
  async closeAndWait(): Promise<void> { const child = this.process; if (!child) return; this.expectedExits.add(child); child.stdin.write("quit\n"); await new Promise<void>((resolve) => child.once("exit", () => resolve())); if (this.process === child) this.process = null; }
  private send(command: string): void { if (!this.process) throw new Error("Native engine is not running"); this.process.stdin.write(`${command}\n`); }
}

function fieldsFromLine(line: string): Record<string, string> { return Object.fromEntries(line.trim().split(/\s+/).slice(1).map((part) => { const separator = part.indexOf("="); return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)]; })); }
function numberField(fields: Record<string, string>, name: string): number { const value = Number(fields[name]); if (!Number.isFinite(value)) throw new Error(`Invalid native field: ${name}`); return value; }
function validateGain(gain: number): void { if (!Number.isFinite(gain) || gain < 0 || gain > 1.25) throw new Error("Gain must be between 0 and 1.25"); }

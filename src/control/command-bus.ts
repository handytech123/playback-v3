import type { LiveBus, PerformanceSession, PerformanceSnapshot } from "../live/performance-session.js";
import { preparedControl } from "../domain/song.js";

export type ControlSource = "ui" | "keyboard" | "remote" | "osc" | "midi" | "system";
export type PlaybackCommand =
  | { readonly type: "transport.play" | "transport.pause" | "transport.stop" | "transport.toggle" | "panic.enter" | "section.next" | "section.previous" | "song.cue-next" }
  | { readonly type: "panic.recover" | "section.jump" | "section.loop" | "section.repeat-once"; readonly regionId: string }
  | { readonly type: "song.select"; readonly index: number }
  | { readonly type: "bus.set"; readonly bus: LiveBus; readonly enabled: boolean }
  | { readonly type: "bus.gain"; readonly bus: LiveBus; readonly gain: number }
  | { readonly type: "mixer.channel"; readonly index:number;readonly gain:number;readonly muted:boolean;readonly solo:boolean;readonly iem:boolean }
  | { readonly type: "mixer.master"; readonly gain:number };

export interface CommandEnvelope { readonly id: string; readonly source: ControlSource; readonly issuedAt: string; readonly command: PlaybackCommand; }
export interface CommandResult { readonly id: string; readonly ok: boolean; readonly completedAt: string; readonly state: PerformanceSnapshot; readonly error?: string; }
export interface ControlState { readonly revision: number; readonly updatedAt: string; readonly setName: string; readonly songs: readonly { index: number; title: string; artist: string; arrangement:string;key:string;bpm:number;durationSeconds:number;regions: readonly { id: string; name: string; startSeconds: number; endSeconds: number }[];proPresenterMidi:readonly {atSeconds:number;status:number;data1:number;data2:number}[] }[]; readonly transitions:readonly {fromSongIndex:number;toSongIndex:number;type:string;durationSeconds:number;continuePad:boolean}[];readonly performance: PerformanceSnapshot; }

type StateListener = (state: ControlState) => void;
type ResultListener = (result: CommandResult) => void;

export class PlaybackCommandBus {
  private revision = 0;
  private readonly stateListeners = new Set<StateListener>();
  private readonly resultListeners = new Set<ResultListener>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly session: PerformanceSession, private readonly setName: string) {}

  state(): ControlState {
    const manifest = this.session.confirmedSet;
    return { revision: this.revision, updatedAt: new Date().toISOString(), setName: this.setName, songs: manifest.songs.map((song, index) => ({ index, title: song.song.title, artist: song.song.artist, arrangement:song.arrangement?.name??"Original Song",key:song.selectedKey,bpm:song.selectedBpm,durationSeconds:song.durationSeconds,regions: song.regions.map(({ id, name, startSeconds, endSeconds }) => ({ id, name, startSeconds, endSeconds })),proPresenterMidi:(preparedControl(song)?.proPresenterMidi??[]).map(({atSeconds,status,data1,data2})=>({atSeconds,status,data1,data2})) })),transitions:(manifest.transitions??[]).map(({fromSongIndex,toSongIndex,type,durationSeconds,continuePad})=>({fromSongIndex,toSongIndex,type,durationSeconds,continuePad})), performance: this.session.snapshot };
  }

  dispatch(command: PlaybackCommand, source: ControlSource = "system"): Promise<CommandResult> {
    const envelope: CommandEnvelope = { id: crypto.randomUUID(), source, issuedAt: new Date().toISOString(), command };
    const task = this.chain.then(() => this.execute(envelope), () => this.execute(envelope));
    this.chain = task.then(() => undefined, () => undefined);
    return task;
  }

  publishState(): ControlState { this.revision += 1; const state = this.state(); for (const listener of this.stateListeners) listener(state); return state; }
  onState(listener: StateListener): () => void { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onResult(listener: ResultListener): () => void { this.resultListeners.add(listener); return () => this.resultListeners.delete(listener); }

  private async execute(envelope: CommandEnvelope): Promise<CommandResult> {
    try {
      const command = envelope.command;
      if (command.type === "transport.play") this.session.play();
      else if (command.type === "transport.pause") this.session.pause();
      else if (command.type === "transport.stop") this.session.stop();
      else if (command.type === "transport.toggle") this.session.snapshot.playing?this.session.pause():this.session.play();
      else if (command.type === "panic.enter") this.session.panic();
      else if (command.type === "panic.recover") this.session.armRecovery(command.regionId);
      else if (command.type === "section.jump") this.session.jumpToRegion(command.regionId);
      else if (command.type === "section.next") this.session.nextSection();
      else if (command.type === "section.previous") this.session.previousSection();
      else if (command.type === "section.loop") this.session.toggleLoop(command.regionId);
      else if (command.type === "section.repeat-once") this.session.repeatOnce(command.regionId);
      else if (command.type === "song.cue-next") await this.session.cueNext();
      else if (command.type === "song.select") await this.session.selectSong(command.index);
      else if (command.type === "bus.set") this.session.setBus(command.bus, command.enabled);
      else if (command.type === "bus.gain") this.session.setBusGain(command.bus, command.gain);
      else if (command.type === "mixer.channel") this.session.setMixerChannel(command.index,command);
      else if (command.type === "mixer.master") this.session.setMasterGain(command.gain);
      else throw new Error("Unsupported normalized command");
      const state = this.publishState(), result: CommandResult = { id: envelope.id, ok: true, completedAt: new Date().toISOString(), state: state.performance };
      for (const listener of this.resultListeners) listener(result);
      return result;
    } catch (error) {
      const result: CommandResult = { id: envelope.id, ok: false, completedAt: new Date().toISOString(), state: this.session.snapshot, error: error instanceof Error ? error.message : String(error) };
      for (const listener of this.resultListeners) listener(result);
      return result;
    }
  }
}

export function parsePlaybackCommand(value: unknown): PlaybackCommand {
  if (!value || typeof value !== "object") throw new Error("Command must be an object");
  const item = value as Record<string, unknown>, type = item.type;
  if (typeof type !== "string") throw new Error("Command type is required");
  const simple = ["transport.play", "transport.pause", "transport.stop", "transport.toggle", "panic.enter", "section.next", "section.previous", "song.cue-next"] as const;
  if (simple.includes(type as typeof simple[number])) return { type: type as typeof simple[number] };
  if (["panic.recover", "section.jump", "section.loop", "section.repeat-once"].includes(type)) {
    if (typeof item.regionId !== "string" || !item.regionId.trim()) throw new Error("regionId is required");
    return { type: type as "panic.recover" | "section.jump" | "section.loop" | "section.repeat-once", regionId: item.regionId };
  }
  if (type === "song.select") { if (!Number.isInteger(item.index) || Number(item.index) < 0) throw new Error("index must be a non-negative integer"); return { type, index: Number(item.index) }; }
  if (type === "bus.set") { const bus = parseBus(item.bus); if (typeof item.enabled !== "boolean") throw new Error("enabled must be boolean"); return { type, bus, enabled: item.enabled }; }
  if (type === "bus.gain") { const bus = parseBus(item.bus), gain = Number(item.gain); if (!Number.isFinite(gain) || gain < 0 || gain > 1.25) throw new Error("gain must be between 0 and 1.25"); return { type, bus, gain }; }
  if(type==="mixer.channel"){const index=Number(item.index),gain=Number(item.gain);if(!Number.isInteger(index)||index<0)throw new Error("index must be a non-negative integer");if(!Number.isFinite(gain)||gain<0||gain>1.25)throw new Error("gain must be between 0 and 1.25");if(typeof item.muted!=="boolean"||typeof item.solo!=="boolean"||typeof item.iem!=="boolean")throw new Error("mixer channel switches must be boolean");return{type,index,gain,muted:item.muted,solo:item.solo,iem:item.iem};}
  if(type==="mixer.master"){const gain=Number(item.gain);if(!Number.isFinite(gain)||gain<0||gain>1.25)throw new Error("gain must be between 0 and 1.25");return{type,gain};}
  throw new Error(`Unsupported command: ${type}`);
}

function parseBus(value: unknown): LiveBus { if (value === "music" || value === "click" || value === "cue" || value === "pad") return value; throw new Error("Unknown bus"); }

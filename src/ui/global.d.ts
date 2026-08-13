import type { NativeTransportState } from "../live/native-engine-client.js";

declare global {
  interface Window {
    playback: {
      bootstrap(): Promise<any>;
      command(command: string, value?: number): void;
      onTransport(listener: (state: NativeTransportState) => void): void;
      windows: { onMenuAction(listener: (action: string) => void): void };
      performance: { get(): Promise<any>; command(value: any): Promise<any>; onState(listener: (state: any) => void): void; onMeters(listener: (meters: { master: number; channels: readonly number[] }) => void): void };
      set: { getSong(index: number): Promise<any>; selectSong(index: number): Promise<any> };
      control: { get(): Promise<any>; command(command: any): Promise<any>; setSettings(settings: any): Promise<any>; setMidiInput(settings: any): Promise<any>; gldPreview(settings: any): Promise<any>; gldTest(settings: any): Promise<any>; onState(listener: (state: any) => void): void; onMidiInput(listener: (state: any) => void): void };
      arrangements: { previewReaper(): Promise<any>; commitReaper(action: "new" | "replace" | "cancel"): Promise<any> };
      midi: { setOutput(name: string | null): Promise<any> };
      audio: { setDevice(device: { type: string; name: string } | null): Promise<any>; setRouting(routing: any): Promise<any>; setGlobalBusRouting(routing: any): Promise<any>; refresh(): Promise<any> };
      clickSounds: { get(): Promise<any>; choose(kind: "normal" | "accent"): Promise<any>; reset(): Promise<any>; preview(kind: "normal" | "accent"): Promise<string> };
      transitions: { get(): Promise<any>; set(settings: any): Promise<any> };
      prep: { get(): Promise<any>; status(): Promise<any>; update(): Promise<any>; review(songId: string): Promise<any>; command(command: any): Promise<any>; loadItem(itemId: string): Promise<any>; confirm(options?: { selectedIndex?: number }): Promise<any>; exportSetlist(): Promise<any>; importSetlist(): Promise<any>; onStatus(listener: (state: any) => void): void; onLoadStatus(listener: (state: { itemId: string; progress: number; label: string }) => void): void; onConfirmStatus(listener: (state: { progress: number; label: string }) => void): void };
      arrange: { get(): Promise<any>; workspace(): Promise<any>; command(command: any): Promise<any>; undo(): Promise<any>; redo(): Promise<any>; saveDraft(): Promise<any>; revert(): Promise<any>; auditionCue(cueId: string): Promise<string>; save(): Promise<any> };
      editor: { get(): Promise<any>; command(command: any): Promise<any>; mixerChannel(channel: any): Promise<any>; undo(): Promise<any>; redo(): Promise<any>; save(): Promise<any>; approve(): Promise<any>; auditionCue(cueId: string): Promise<string> };
    };
  }
}

export {};

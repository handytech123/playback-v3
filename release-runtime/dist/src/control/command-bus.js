import { preparedControl } from "../domain/song.js";
export class PlaybackCommandBus {
    session;
    setName;
    revision = 0;
    stateListeners = new Set();
    resultListeners = new Set();
    chain = Promise.resolve();
    constructor(session, setName) {
        this.session = session;
        this.setName = setName;
    }
    state() {
        const manifest = this.session.confirmedSet;
        return { revision: this.revision, updatedAt: new Date().toISOString(), setName: this.setName, songs: manifest.songs.map((song, index) => ({ index, title: song.song.title, artist: song.song.artist, arrangement: song.arrangement?.name ?? "Original Song", key: song.selectedKey, bpm: song.selectedBpm, timeSignature: song.timeSignature, durationSeconds: song.durationSeconds, ...(song.waveformPath ? { waveformPath: song.waveformPath } : {}), regions: song.regions.map(({ id, name, startSeconds, endSeconds, startPosition, endPosition }) => ({ id, name, startSeconds, endSeconds, ...(startPosition ? { startPosition } : {}), ...(endPosition ? { endPosition } : {}) })), cues: (song.liveAssets?.cues ?? song.cues.map(cue => ({ label: cue.phrase, atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId, position: cue.position }))).map(cue => ({ phrase: cue.label, atSeconds: cue.atSeconds, targetRegionId: cue.targetRegionId, ...(cue.position ? { position: cue.position } : {}) })), proPresenterMidi: (preparedControl(song)?.proPresenterMidi ?? []).map(({ atSeconds, status, data1, data2 }) => ({ atSeconds, status, data1, data2 })) })), transitions: (manifest.transitions ?? []).map(({ fromSongIndex, toSongIndex, type, durationSeconds, continuePad }) => ({ fromSongIndex, toSongIndex, type, durationSeconds, continuePad })), performance: this.session.snapshot };
    }
    dispatch(command, source = "system") {
        const envelope = { id: crypto.randomUUID(), source, issuedAt: new Date().toISOString(), command };
        const task = this.chain.then(() => this.execute(envelope), () => this.execute(envelope));
        this.chain = task.then(() => undefined, () => undefined);
        return task;
    }
    publishState() { this.revision += 1; const state = this.state(); for (const listener of this.stateListeners)
        listener(state); return state; }
    onState(listener) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
    onResult(listener) { this.resultListeners.add(listener); return () => this.resultListeners.delete(listener); }
    async execute(envelope) {
        try {
            const command = envelope.command;
            if (command.type === "transport.play")
                this.session.play();
            else if (command.type === "transport.pause")
                this.session.pause();
            else if (command.type === "transport.stop")
                this.session.stop();
            else if (command.type === "transport.toggle")
                this.session.snapshot.playing ? this.session.pause() : this.session.play();
            else if (command.type === "transport.seek")
                this.session.seek(command.seconds);
            else if (command.type === "panic.enter")
                this.session.panic();
            else if (command.type === "panic.recover")
                this.session.armRecovery(command.regionId);
            else if (command.type === "section.jump")
                this.session.jumpToRegion(command.regionId);
            else if (command.type === "section.next")
                this.session.nextSection();
            else if (command.type === "section.previous")
                this.session.previousSection();
            else if (command.type === "section.loop")
                this.session.toggleLoop(command.regionId);
            else if (command.type === "section.repeat-once")
                this.session.repeatOnce(command.regionId);
            else if (command.type === "song.cue-next")
                await this.session.cueNext();
            else if (command.type === "song.select")
                await this.session.selectSong(command.index);
            else if (command.type === "bus.set")
                this.session.setBus(command.bus, command.enabled);
            else if (command.type === "bus.gain")
                this.session.setBusGain(command.bus, command.gain);
            else if (command.type === "mixer.channel")
                this.session.setMixerChannel(command.index, command);
            else if (command.type === "mixer.master")
                this.session.setMasterGain(command.gain);
            else if (command.type === "midi.slides")
                this.session.setSlidesMidiEnabled(command.enabled);
            else if (command.type === "midi.surface")
                await this.session.setSurfaceMixerMidiEnabled(command.enabled);
            else
                throw new Error("Unsupported normalized command");
            const state = this.publishState(), result = { id: envelope.id, ok: true, completedAt: new Date().toISOString(), state: state.performance };
            for (const listener of this.resultListeners)
                listener(result);
            return result;
        }
        catch (error) {
            const result = { id: envelope.id, ok: false, completedAt: new Date().toISOString(), state: this.session.snapshot, error: error instanceof Error ? error.message : String(error) };
            for (const listener of this.resultListeners)
                listener(result);
            return result;
        }
    }
}
export function parsePlaybackCommand(value) {
    if (!value || typeof value !== "object")
        throw new Error("Command must be an object");
    const item = value, type = item.type;
    if (typeof type !== "string")
        throw new Error("Command type is required");
    const simple = ["transport.play", "transport.pause", "transport.stop", "transport.toggle", "panic.enter", "section.next", "section.previous", "song.cue-next"];
    if (simple.includes(type))
        return { type: type };
    if (type === "transport.seek") {
        const seconds = Number(item.seconds);
        if (!Number.isFinite(seconds) || seconds < 0)
            throw new Error("seconds must be a non-negative number");
        return { type, seconds };
    }
    if (["panic.recover", "section.jump", "section.loop", "section.repeat-once"].includes(type)) {
        if (typeof item.regionId !== "string" || !item.regionId.trim())
            throw new Error("regionId is required");
        return { type: type, regionId: item.regionId };
    }
    if (type === "song.select") {
        if (!Number.isInteger(item.index) || Number(item.index) < 0)
            throw new Error("index must be a non-negative integer");
        return { type, index: Number(item.index) };
    }
    if (type === "bus.set") {
        const bus = parseBus(item.bus);
        if (typeof item.enabled !== "boolean")
            throw new Error("enabled must be boolean");
        return { type, bus, enabled: item.enabled };
    }
    if (type === "bus.gain") {
        const bus = parseBus(item.bus), gain = Number(item.gain);
        if (!Number.isFinite(gain) || gain < 0 || gain > 1.25)
            throw new Error("gain must be between 0 and 1.25");
        return { type, bus, gain };
    }
    if (type === "mixer.channel") {
        const index = Number(item.index), gain = Number(item.gain);
        if (!Number.isInteger(index) || index < 0)
            throw new Error("index must be a non-negative integer");
        if (!Number.isFinite(gain) || gain < 0 || gain > 3.1622776601683795)
            throw new Error("gain must be between 0 and 3.1622776601683795");
        if (typeof item.muted !== "boolean" || typeof item.solo !== "boolean" || typeof item.iem !== "boolean")
            throw new Error("mixer channel switches must be boolean");
        return { type, index, gain, muted: item.muted, solo: item.solo, iem: item.iem };
    }
    if (type === "mixer.master") {
        const gain = Number(item.gain);
        if (!Number.isFinite(gain) || gain < 0 || gain > 1.25)
            throw new Error("gain must be between 0 and 1.25");
        return { type, gain };
    }
    if (type === "midi.slides") {
        if (typeof item.enabled !== "boolean")
            throw new Error("enabled must be boolean");
        return { type, enabled: item.enabled };
    }
    if (type === "midi.surface") {
        if (typeof item.enabled !== "boolean")
            throw new Error("enabled must be boolean");
        return { type, enabled: item.enabled };
    }
    throw new Error(`Unsupported command: ${type}`);
}
function parseBus(value) { if (value === "music" || value === "click" || value === "cue" || value === "pad")
    return value; throw new Error("Unknown bus"); }
//# sourceMappingURL=command-bus.js.map
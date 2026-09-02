import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
export function nativeRoutingCommand(routing) {
    if (routing.stemBuses && routing.busRoutes) {
        const values = ["bus_routing", String(routing.stemBuses.length), ...routing.stemBuses, String(routing.busRoutes.length)];
        for (const route of routing.busRoutes)
            values.push(route.bus, String(route.output), String(route.channels));
        values.push(String(routing.click), String(routing.clickChannels), String(routing.cue), String(routing.cueChannels), String(routing.pad), String(routing.padChannels), String(routing.iem), String(routing.iemChannels));
        return values.join(" ");
    }
    const values = ["routing", String(routing.stems.length)];
    for (let index = 0; index < routing.stems.length; index++)
        values.push(String(routing.stems[index]), String(routing.stemChannels[index]));
    values.push(String(routing.click), String(routing.clickChannels), String(routing.cue), String(routing.cueChannels), String(routing.pad), String(routing.padChannels), String(routing.iem), String(routing.iemChannels));
    return values.join(" ");
}
export function parseNativeLine(line) {
    const fields = fieldsFromLine(line);
    if (line.startsWith("READY "))
        return {
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
        if (state !== "playing" && state !== "paused")
            throw new Error(`Unknown native transport state: ${state}`);
        return { state, positionSeconds: numberField(fields, "position_seconds"), ...(fields.start_latency_ms ? { startLatencyMs: numberField(fields, "start_latency_ms") } : {}) };
    }
    return null;
}
export function parseNativeMeters(line) {
    if (!line.startsWith("METERS "))
        return null;
    const fields = fieldsFromLine(line), channels = (fields.channels ?? "").split(",").filter(Boolean).map(Number);
    if (channels.some((value) => !Number.isFinite(value)))
        throw new Error("Invalid native mixer channel meter");
    return { master: numberField(fields, "master"), channels };
}
export function parseNativeHealth(line) {
    if (!line.startsWith("HEALTH "))
        return null;
    const fields = fieldsFromLine(line);
    return { sampleRate: numberField(fields, "sample_rate"), blockFrames: numberField(fields, "block_frames"), callbacks: numberField(fields, "callbacks"), xruns: numberField(fields, "xruns"), deadlineMisses: numberField(fields, "deadline_misses"), maximumCallbackNanoseconds: numberField(fields, "max_callback_ns"), deviceError: fields.device_error === "1", iemPeak: fields.iem_peak ? numberField(fields, "iem_peak") : 0, iemClips: fields.iem_clips ? numberField(fields, "iem_clips") : 0 };
}
export class NativeEngineClient extends EventEmitter {
    process = null;
    expectedExits = new WeakSet();
    get isRunning() { return this.process !== null; }
    async start(executablePath, manifestPath, songIndex = 0, midiOutputName, audioDevice, midiInputName, routing) {
        if (this.process)
            throw new Error("Native engine is already running");
        const args = [manifestPath, "--interactive", "--song-index", String(songIndex)];
        if (midiOutputName === null)
            args.push("--disable-midi");
        else if (midiOutputName)
            args.push("--midi-output", midiOutputName);
        if (midiInputName === null)
            args.push("--disable-midi-input");
        else if (midiInputName)
            args.push("--midi-input", midiInputName);
        if (audioDevice) {
            args.push("--audio-device-type", audioDevice.type, "--audio-device-name", audioDevice.name);
            if (audioDevice.outputChannels)
                args.push("--output-count", String(audioDevice.outputChannels));
        }
        if (routing) {
            if (routing.stemBuses && routing.busRoutes) {
                for (const bus of routing.stemBuses)
                    args.push("--stem-bus", bus);
                for (const route of routing.busRoutes)
                    args.push("--bus-route", route.bus, String(route.output), String(route.channels));
            }
            else
                for (let index = 0; index < routing.stems.length; index++)
                    args.push("--stem-output", String(routing.stems[index]), "--stem-channels", String(routing.stemChannels[index]));
            args.push("--click-output", String(routing.click), "--click-channels", String(routing.clickChannels), "--cue-output", String(routing.cue), "--cue-channels", String(routing.cueChannels), "--pad-output", String(routing.pad), "--pad-channels", String(routing.padChannels), "--iem-output", String(routing.iem), "--iem-channels", String(routing.iemChannels));
        }
        const child = spawn(executablePath, args, { stdio: ["pipe", "pipe", "pipe"] });
        this.process = child;
        child.once("exit", (code) => { if (this.process === child)
            this.process = null; if (!this.expectedExits.has(child))
            this.emit("fault", new Error(`Native audio engine stopped unexpectedly (${code ?? "no exit code"})`)); });
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
            this.emit("native-line", line);
            const message = parseNativeLine(line);
            if (message && "positionSeconds" in message)
                this.emit("transport", message);
            const meters = parseNativeMeters(line);
            if (meters)
                this.emit("meters", meters);
            const health = parseNativeHealth(line);
            if (health)
                this.emit("health", health);
            if (line.startsWith("MIDI_IN ")) {
                const fields = fieldsFromLine(line);
                this.emit("midi-input", { status: numberField(fields, "status"), data1: numberField(fields, "data1"), data2: numberField(fields, "data2") });
            }
        });
        return await new Promise((resolve, reject) => {
            const onLine = (line) => { const message = parseNativeLine(line); if (message && "deviceOpenMs" in message) {
                lines.off("line", onLine);
                resolve(message);
            } };
            lines.on("line", onLine);
            child.once("error", reject);
            child.once("exit", (code) => { if (code !== 0)
                reject(new Error(`Native engine exited with code ${code}`)); });
        });
    }
    play() { this.send("play"); }
    pause() { this.send("pause"); }
    stop() { this.send("stop"); }
    seek(seconds) { if (seconds < 0 || !Number.isFinite(seconds))
        throw new Error("Seek must be non-negative"); this.send(`seek ${seconds}`); }
    requestStatus() { this.send("status"); }
    padOn() { this.send("pad_on"); }
    padOff() { this.send("pad_off"); }
    musicOn() { this.send("music_on"); }
    musicOff() { this.send("music_off"); }
    clickOn() { this.send("click_on"); }
    clickOff() { this.send("click_off"); }
    cueOn() { this.send("cue_on"); }
    cueOff() { this.send("cue_off"); }
    slidesMidiOn() { this.send("slides_midi_on"); }
    slidesMidiOff() { this.send("slides_midi_off"); }
    setCueTime(targetRegionId, atSeconds) { if (!/^[a-zA-Z0-9._:-]+$/.test(targetRegionId) || !Number.isFinite(atSeconds) || atSeconds < 0)
        throw new Error("Cue schedule update is invalid"); this.send(`cue_time ${targetRegionId} ${atSeconds}`); }
    panic() { this.send("panic"); }
    announceRecovery(regionId, atSeconds, repeatAtSeconds) { if (!/^[a-zA-Z0-9._:-]+$/.test(regionId) || !Number.isFinite(atSeconds) || atSeconds < 0 || repeatAtSeconds !== null && (!Number.isFinite(repeatAtSeconds) || repeatAtSeconds < 0 || repeatAtSeconds >= atSeconds))
        throw new Error("Recovery announcement is invalid"); this.send(`announce_recovery ${regionId} ${atSeconds} ${repeatAtSeconds ?? -1}`); }
    cancelTransition() { this.send("cancel_transition"); }
    recover() { this.send("recover"); }
    setBusGain(bus, gain) { validateGain(gain); this.send(`gain ${bus} ${gain}`); }
    setMixerChannel(index, gain, muted, solo, iem) { if (!Number.isInteger(index) || index < 0)
        throw new Error("Mixer channel index must be non-negative"); validateGain(gain, 3.1622776601683795); this.send(`mixer_channel ${index} ${gain} ${muted ? 1 : 0} ${solo ? 1 : 0} ${iem ? 1 : 0}`); }
    setStemTrim(index, gain, muted, solo, iem) { if (!Number.isInteger(index) || index < 0)
        throw new Error("Stem trim index must be non-negative"); validateGain(gain); this.send(`stem_trim ${index} ${gain} ${muted ? 1 : 0} ${solo ? 1 : 0} ${iem ? 1 : 0}`); }
    setExternalOutputs(outputs) {
        if(!Array.isArray(outputs)||outputs.some(n=>!Number.isInteger(n)||n<1||n>32)||new Set(outputs).size!==outputs.length)
            return Promise.reject(new Error("Invalid external return outputs"));
        const next=(this.externalUpdates??Promise.resolve()).catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
            const finish=(error)=>{clearTimeout(timer);this.off("native-line",onLine);error?reject(error):resolve();};
            const onLine=line=>{if(line==="EXTERNAL_RETURNS_READY")finish();else if(line.startsWith("EXTERNAL_RETURNS_FAILED"))finish(new Error(line));};
            const timer=setTimeout(()=>finish(new Error("Native GLD ownership acknowledgment timed out")),3000);
            this.on("native-line",onLine);
            try{this.send(`external_returns ${outputs.length}${outputs.length?' '+outputs.join(' '):''}`);}catch(error){finish(error);}
        }));
        this.externalUpdates=next;return next;
    }
    setMasterGain(gain) { validateGain(gain); this.send(`master_gain ${gain}`); }
    setRouting(routing) {
        if (routing.stems.length !== routing.stemChannels.length || routing.stemBuses && routing.stemBuses.length !== routing.stems.length)
            throw new Error("Every stem route requires one bus and channel width");
        return new Promise((resolve, reject) => { const timeout = setTimeout(() => { this.off("native-line", onLine); reject(new Error("Native routing update timed out")); }, 3000), onLine = (line) => { if (line.startsWith("ROUTING_FAILED")) {
            clearTimeout(timeout);
            this.off("native-line", onLine);
            reject(new Error(line));
        }
        else if (line.startsWith("ROUTING_UPDATED")) {
            clearTimeout(timeout);
            this.off("native-line", onLine);
            resolve();
        } }; this.on("native-line", onLine); this.send(nativeRoutingCommand(routing)); });
    }
    selectSong(index) {
        if (!Number.isInteger(index) || index < 0)
            throw new Error("Song index must be non-negative");
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.off("native-line", onLine); reject(new Error("Native song selection timed out")); }, 10000);
            const onLine = (line) => {
                if (line.startsWith("SELECT_FAILED ")) {
                    clearTimeout(timeout);
                    this.off("native-line", onLine);
                    reject(new Error(line));
                }
                else if (line.startsWith("SELECTED ")) {
                    clearTimeout(timeout);
                    this.off("native-line", onLine);
                    const fields = fieldsFromLine(line);
                    resolve({ index: numberField(fields, "index"), deviceOpenMs: numberField(fields, "device_open_ms"), armMs: numberField(fields, "arm_ms"), stems: numberField(fields, "stems"), clickEvents: numberField(fields, "click_events"), cueEvents: numberField(fields, "cue_events"), padKey: fields.pad_key ?? "", midiEvents: numberField(fields, "midi_events"), midiEnabled: fields.midi_enabled === "1", outputChannels: numberField(fields, "output_channels"), routingReady: fields.routing_ready === "1", iemReady: fields.iem_ready === "1", stereoFallback: fields.stereo_fallback === "1", nextReady: fields.next_ready === "1", nextIndex: numberField(fields, "next_index") });
                }
            };
            this.on("native-line", onLine);
            this.send(`select_song ${index}`);
        });
    }
    beginSongTransition(index, type, durationSeconds, continuePad) {
        if (!Number.isInteger(index) || index < 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 5)
            throw new Error("Native song transition is invalid");
        return new Promise((resolve, reject) => { const timeout = setTimeout(() => { this.off("native-line", onLine); reject(new Error("Native A/B transition timed out")); }, Math.ceil(durationSeconds * 1000) + 10000), onLine = (line) => { if (line.startsWith("TRANSITION_FAILED ")) {
            clearTimeout(timeout);
            this.off("native-line", onLine);
            reject(new Error(line));
        }
        else if (line.startsWith("TRANSITION_COMPLETE ")) {
            clearTimeout(timeout);
            this.off("native-line", onLine);
            const fields = fieldsFromLine(line), deck = fields.deck;
            if (deck !== "A" && deck !== "B")
                return reject(new Error("Native transition returned an invalid deck"));
            resolve({ index: numberField(fields, "index"), elapsedSeconds: numberField(fields, "elapsed_seconds"), deck, deviceOpenMs: numberField(fields, "device_open_ms"), armMs: numberField(fields, "arm_ms"), stems: numberField(fields, "stems"), clickEvents: numberField(fields, "click_events"), cueEvents: numberField(fields, "cue_events"), padKey: fields.pad_key ?? "", midiEvents: numberField(fields, "midi_events"), midiEnabled: fields.midi_enabled === "1", outputChannels: numberField(fields, "output_channels"), routingReady: fields.routing_ready === "1", iemReady: fields.iem_ready === "1", stereoFallback: fields.stereo_fallback === "1", nextReady: fields.next_ready === "1", nextIndex: numberField(fields, "next_index") });
        } }; this.on("native-line", onLine); this.send(`transition_song ${index} ${type} ${durationSeconds} ${continuePad ? 1 : 0}`); });
    }
    selectManifest(manifestPath, index) {
        if (!manifestPath || !Number.isInteger(index) || index < 0)
            throw new Error("Manifest song selection is invalid");
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.off("native-line", onLine); reject(new Error("Native manifest selection timed out")); }, 10000);
            const onLine = (line) => {
                if (line.startsWith("SELECT_FAILED ")) {
                    clearTimeout(timeout);
                    this.off("native-line", onLine);
                    reject(new Error(line));
                }
                else if (line.startsWith("SELECTED ")) {
                    clearTimeout(timeout);
                    this.off("native-line", onLine);
                    const fields = fieldsFromLine(line);
                    resolve({ index: numberField(fields, "index"), deviceOpenMs: numberField(fields, "device_open_ms"), armMs: numberField(fields, "arm_ms"), stems: numberField(fields, "stems"), clickEvents: numberField(fields, "click_events"), cueEvents: numberField(fields, "cue_events"), padKey: fields.pad_key ?? "", midiEvents: numberField(fields, "midi_events"), midiEnabled: fields.midi_enabled === "1", outputChannels: numberField(fields, "output_channels"), routingReady: fields.routing_ready === "1", iemReady: fields.iem_ready === "1", stereoFallback: fields.stereo_fallback === "1", nextReady: fields.next_ready === "1", nextIndex: numberField(fields, "next_index") });
                }
            };
            this.on("native-line", onLine);
            this.send(`select_manifest ${index} ${JSON.stringify(manifestPath)}`);
        });
    }
    close() { if (this.process) {
        this.expectedExits.add(this.process);
        this.process.stdin.write("quit\n");
        this.process = null;
    } }
    async closeAndWait() { const child = this.process; if (!child)
        return; this.expectedExits.add(child); child.stdin.write("quit\n"); await new Promise((resolve) => child.once("exit", () => resolve())); if (this.process === child)
        this.process = null; }
    send(command) { if (!this.process)
        throw new Error("Native engine is not running"); this.process.stdin.write(`${command}\n`); }
}
function fieldsFromLine(line) { return Object.fromEntries(line.trim().split(/\s+/).slice(1).map((part) => { const separator = part.indexOf("="); return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)]; })); }
function numberField(fields, name) { const value = Number(fields[name]); if (!Number.isFinite(value))
    throw new Error(`Invalid native field: ${name}`); return value; }
function validateGain(gain, maximum = 1.25) { if (!Number.isFinite(gain) || gain < 0 || gain > maximum)
    throw new Error(`Gain must be between 0 and ${maximum}`); }
//# sourceMappingURL=native-engine-client.js.map

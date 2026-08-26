import { applyBusMix } from "../control/mixers/gld-bus-mix.js";
import { isMediaOnlySong } from "../domain/song.js";
import { positionToGridBeats, secondsPerNotatedBeat } from "../domain/grid.js";
export const DEFAULT_ROUTES = {
    music: { firstOutput: 4, channels: 1 }, click: { firstOutput: 1, channels: 1 },
    cue: { firstOutput: 2, channels: 1 }, pad: { firstOutput: 12, channels: 1 },
};
export class PerformanceSession {
    manifest;
    effects;
    current;
    songTransitionInFlight = false;
    constructor(manifest, effects, routes = DEFAULT_ROUTES, readiness = unverifiedReadiness(), gains = { music: 1, click: 1, cue: 1, pad: 1 }, initialSongIndex = 0) {
        this.manifest = manifest;
        this.effects = effects;
        if (!manifest.songs.length)
            throw new Error("Confirmed set is empty");
        if (!manifest.songs[initialSongIndex])
            throw new Error("Initial song is outside the confirmed set");
        validateRoutingPlan(routes);
        const initialSong = manifest.songs[initialSongIndex];
        this.current = { ready: readiness.ready, readiness, fault: null, songIndex: initialSongIndex, positionSeconds: 0, playing: false, currentRegionId: initialSong.regions[0]?.id ?? null, loopRegionId: null, channels: { music: true, click: true, cue: true, pad: false }, gains: { ...gains }, mixer: createMixerState(initialSong), slidesMidiEnabled: true, surfaceMixerMidiEnabled: false, routes, panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null };
    }
    get snapshot() { return structuredClone(this.current); }
    get confirmedSet() { return this.manifest; }
    setTransitionPlan(plan) { if (plan.fromSongIndex < 0 || plan.toSongIndex !== plan.fromSongIndex + 1 || !this.manifest.songs[plan.toSongIndex])
        throw new Error("Transition must connect adjacent songs"); const transitions = [...(this.manifest.transitions ?? [])].filter(item => item.fromSongIndex !== plan.fromSongIndex); transitions.push(plan); transitions.sort((a, b) => a.fromSongIndex - b.fromSongIndex); this.manifest.transitions = transitions; }
    get song() { return this.manifest.songs[this.current.songIndex]; }
    play() { this.requireReady(); this.effects.play(); this.current = { ...this.current, playing: true }; }
    pause() { this.requireReady(); this.effects.pause(); this.current = { ...this.current, playing: false }; }
    seek(seconds) { this.requireReady(); const position = Math.max(0, Math.min(Number(seconds), this.song.durationSeconds)); if (!Number.isFinite(position))
        throw new Error("Seek position must be a finite number"); this.effects.seek(position); this.current = { ...this.current, positionSeconds: position, currentRegionId: regionAt(this.song, position)?.id ?? null }; }
    stop() { this.effects.stop(); this.current = { ...this.current, channels: { ...this.current.channels, pad: false }, playing: false, positionSeconds: 0, currentRegionId: this.song.regions[0]?.id ?? null, loopRegionId: null, panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null }; }
    panic() { this.requireReady(); if (!this.current.playing)
        throw new Error("Musical Panic is available while the timeline is playing"); this.effects.panic(); this.current = { ...this.current, panicActive: true, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null, loopRegionId: null, channels: { ...this.current.channels, pad: true } }; }
    armRecovery(regionId) { if (!this.current.panicActive)
        throw new Error("Panic recovery is not active"); const region = this.region(regionId); if (!region)
        throw new Error("Recovery section is not in the armed song"); const cue = this.song.liveAssets?.cues.find((item) => item.targetRegionId === regionId); if (!cue)
        throw new Error("Recovery section has no prepared announcement"); const leadSeconds = this.cueLeadSeconds(region, cue), regions = this.song.regions; let index = Math.max(0, regions.findIndex((item) => this.current.positionSeconds >= item.startSeconds && this.current.positionSeconds < item.endSeconds)), boundary = regions[index]?.endSeconds ?? this.current.positionSeconds, cueAt = boundary - leadSeconds; if (cueAt <= this.current.positionSeconds + .05 && index + 1 < regions.length) {
        boundary = regions[++index].endSeconds;
        cueAt = boundary - leadSeconds;
    } if (cueAt <= this.current.positionSeconds)
        throw new Error("Not enough song remains to give the full recovery announcement"); this.effects.announceRecovery(regionId, cueAt, null); this.current = { ...this.current, recoveryRegionId: regionId, recoveryCueAtSeconds: cueAt, recoverAtSeconds: boundary }; }
    reportFault(reason) { this.current = { ...this.current, ready: false, playing: false, channels: { ...this.current.channels, pad: false }, loopRegionId: null, panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null, fault: reason }; }
    clearFault() { if (!this.current.readiness.ready)
        throw new Error("Performance readiness is still blocked"); this.current = { ...this.current, ready: true, fault: null }; }
    setReadiness(readiness) { this.current = { ...this.current, readiness, ready: (readiness.ready || this.current.playing) && !this.current.fault }; }

    updatePosition(seconds) { if (!Number.isFinite(seconds) || seconds < 0)
        return; if (this.current.recoveryRegionId && this.current.recoverAtSeconds !== null && seconds >= this.current.recoverAtSeconds) {
        const target = this.region(this.current.recoveryRegionId);
        this.effects.seek(target.startSeconds);
        this.effects.recover();
        const looping = this.current.loopRegionId === target.id;
        if (looping) {
            const cue = this.cueFor(target.id), lead = this.cueLeadSeconds(target, cue), cueAt = target.endSeconds - lead, repeatAt = cueAt - this.twoBeatSeconds();
            this.effects.announceRecovery(target.id, cueAt, repeatAt);
            this.current = { ...this.current, positionSeconds: target.startSeconds, currentRegionId: target.id, panicActive: false, recoveryCueAtSeconds: cueAt, recoverAtSeconds: target.endSeconds, channels: { ...this.current.channels, pad: false } };
        }
        else
            this.current = { ...this.current, positionSeconds: target.startSeconds, currentRegionId: target.id, panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null, channels: { ...this.current.channels, pad: false } };
        return;
    } const transition = this.manifest.transitions?.find(item => item.fromSongIndex === this.current.songIndex); if (this.current.playing && !transition && seconds >= this.song.durationSeconds) {
        this.current = { ...this.current, positionSeconds: this.song.durationSeconds, playing: false, currentRegionId: this.song.regions.at(-1)?.id ?? null };
        return;
    } this.current = { ...this.current, positionSeconds: Math.min(seconds, this.song.durationSeconds), currentRegionId: regionAt(this.song, seconds)?.id ?? null }; this.maybeRunSongTransition(seconds); }
    jumpToRegion(regionId) { this.requireReady(); if (this.current.panicActive)
        throw new Error("Choose a Panic recovery target instead of jumping immediately"); const region = this.region(regionId); if (!region)
        throw new Error("Section is not in the armed song"); if (this.current.playing) {
        this.armTimedTransition(region.id);
        return;
    } this.effects.seek(region.startSeconds); this.current = { ...this.current, positionSeconds: region.startSeconds, currentRegionId: region.id }; }
    nextSection() { const regions = this.song.regions, index = Math.max(0, regions.findIndex((x) => x.id === this.current.currentRegionId)); this.jumpToRegion(regions[Math.min(index + 1, regions.length - 1)].id); }
    previousSection() { const regions = this.song.regions, index = Math.max(0, regions.findIndex((x) => x.id === this.current.currentRegionId)); this.jumpToRegion(regions[Math.max(index - 1, 0)].id); }
    toggleLoop(regionId = this.current.currentRegionId) { if (this.current.panicActive)
        throw new Error("Loop is unavailable during Panic recovery"); if (!regionId || !this.region(regionId))
        throw new Error("No section is selected for looping"); if (this.current.loopRegionId === regionId) {
        const lockAt = (this.current.recoveryCueAtSeconds ?? 0) - this.twoBeatSeconds();
        if (this.current.playing && this.current.positionSeconds >= lockAt)
            throw new Error("Loop is locked because the Repeat cue has already begun");
        this.effects.cancelTransition();
        this.current = { ...this.current, loopRegionId: null, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null };
        return;
    } this.current = { ...this.current, loopRegionId: regionId }; if (this.current.playing)
        this.armTimedTransition(regionId, true); }
    repeatOnce(regionId = this.current.currentRegionId) { this.requireReady(); if (this.current.panicActive)
        throw new Error("Repeat Once is unavailable during Panic recovery"); if (!this.current.playing)
        throw new Error("Repeat Once is available while the timeline is playing"); if (!regionId || !this.region(regionId))
        throw new Error("No section is selected to repeat"); if (this.current.loopRegionId)
        throw new Error("Release Loop before arming Repeat Once"); this.armTimedTransition(regionId, true); }
    setBus(bus, enabled) { this.requireReady(); this.effects.setBus(bus, enabled); this.current = { ...this.current, channels: { ...this.current.channels, [bus]: enabled } }; }
    setBusGain(bus, gain) { this.requireReady(); if (!Number.isFinite(gain) || gain < 0 || gain > 1.25)
        throw new Error("Bus gain must be between 0 and 125%"); this.effects.setBusGain?.(bus, gain); this.current = { ...this.current, gains: { ...this.current.gains, [bus]: gain } }; }
    setMixerChannel(index, patch) { this.requireReady(); const current = this.current.mixer.channels[index]; if (!current)
        throw new Error("Mixer channel is outside the armed song"); const next = { ...current, ...patch }; if (!Number.isFinite(next.gain) || next.gain < 0 || next.gain > ((next.kind === "stem" || next.kind === "pad") ? 3.1622776601683795 : 1.25))
        throw new Error("GLD bus gain must be between -inf and +10 dB"); this.effects.setMixerChannel?.(next); const channels = [...this.current.mixer.channels]; channels[index] = next; this.current = { ...this.current, mixer: { ...this.current.mixer, channels } }; }
    setMasterGain(gain) { this.requireReady(); if (!Number.isFinite(gain) || gain < 0 || gain > 1.25)
        throw new Error("Master gain must be between 0 and 125%"); this.effects.setMasterGain?.(gain); this.current = { ...this.current, mixer: { ...this.current.mixer, masterGain: gain } }; }
    setSlidesMidiEnabled(enabled) { this.requireReady(); this.effects.setSlidesMidiEnabled?.(enabled); this.current = { ...this.current, slidesMidiEnabled: enabled }; }
    async setSurfaceMixerMidiEnabled(enabled) { if(enabled)this.requireReady(); try {await this.effects.setSurfaceMixerMidiEnabled?.(enabled);this.syncSurfaceMixerState(enabled);} catch(error){this.syncSurfaceMixerState(false);throw error;} }
    syncSurfaceMixerState(enabled) {this.current={...this.current,surfaceMixerMidiEnabled:enabled};}
    setRoutingPlan(routes) { validateRoutingPlan(routes); this.current = { ...this.current, routes: structuredClone(routes) }; }
    async selectSong(index) { const song = this.manifest.songs[index]; if (!song)
        throw new Error("Song is outside the confirmed set"); this.effects.stop(); const readiness = await this.effects.selectSong(index), nextReadiness = readiness ?? this.current.readiness; this.current = { ...this.current, readiness: nextReadiness, ready: nextReadiness.ready, songIndex: index, positionSeconds: 0, playing: false, currentRegionId: song.regions[0]?.id ?? null, loopRegionId: null, fault: null, channels: { ...this.current.channels, pad: false }, mixer: createMixerState(song), panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null }; }
    async cueNext() { const index = this.current.songIndex + 1, song = this.manifest.songs[index]; if (!song)
        throw new Error("There is no next song in the confirmed set"); this.effects.stop(); const readiness = await this.effects.selectSong(index), nextReadiness = readiness ?? this.current.readiness; if (!nextReadiness.ready)
        throw new Error("Next song did not pass performance readiness"); this.effects.setBus("pad", true); this.current = { ...this.current, readiness: nextReadiness, ready: true, songIndex: index, positionSeconds: 0, playing: false, currentRegionId: song.regions[0]?.id ?? null, loopRegionId: null, fault: null, channels: { ...this.current.channels, pad: true }, mixer: createMixerState(song), panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null }; }
    maybeRunSongTransition(seconds) { if (!this.current.playing || this.songTransitionInFlight)
        return; const plan = this.manifest.transitions?.find(item => item.fromSongIndex === this.current.songIndex); if (!plan)
        return; const triggerAt = this.song.durationSeconds - plan.durationSeconds; if (seconds + 0.01 < triggerAt)
        return; this.songTransitionInFlight = true; void this.runSongTransition(plan).catch(error => this.reportFault(error instanceof Error ? error.message : String(error))).finally(() => { this.songTransitionInFlight = false; }); }
    async runSongTransition(plan) { if (plan.type === "stay-in-song") {
        this.effects.stop();
        this.current = { ...this.current, positionSeconds: this.song.durationSeconds, playing: false, currentRegionId: this.song.regions.at(-1)?.id ?? null };
        return;
    } if (plan.type === "cue-next") {
        await this.finishSongSelection(plan, false);
        return;
    } if (plan.type === "auto-link") {
        await this.finishSongSelection(plan, true);
        return;
    } if (!this.effects.beginTimedSongTransition)
        throw new Error(`${plan.type} is not available in the active audio engine`); const result = await this.effects.beginTimedSongTransition(plan), timed = result && "elapsedSeconds" in result ? result : null, nextReadiness = timed?.readiness ?? (result && !("elapsedSeconds" in result) ? result : this.current.readiness), song = this.manifest.songs[plan.toSongIndex], elapsed = Math.max(0, Math.min(timed?.elapsedSeconds ?? 0, song.durationSeconds)); if (!nextReadiness.ready)
        throw new Error("Next song did not pass performance readiness"); this.current = { ...this.current, readiness: nextReadiness, ready: true, songIndex: plan.toSongIndex, positionSeconds: elapsed, playing: true, currentRegionId: regionAt(song, elapsed)?.id ?? song.regions[0]?.id ?? null, loopRegionId: null, fault: null, channels: { ...this.current.channels, pad: plan.continuePad }, mixer: createMixerState(song), panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null }; }
    async finishSongSelection(plan, startNext) { this.effects.stop(); const readiness = await this.effects.selectSong(plan.toSongIndex), nextReadiness = readiness ?? this.current.readiness, song = this.manifest.songs[plan.toSongIndex]; if (!nextReadiness.ready)
        throw new Error("Next song did not pass performance readiness"); this.effects.setBus("pad", plan.continuePad); if (startNext)
        this.effects.play(); this.current = { ...this.current, readiness: nextReadiness, ready: true, songIndex: plan.toSongIndex, positionSeconds: 0, playing: startNext, currentRegionId: song.regions[0]?.id ?? null, loopRegionId: null, fault: null, channels: { ...this.current.channels, pad: plan.continuePad }, mixer: createMixerState(song), panicActive: false, recoveryRegionId: null, recoveryCueAtSeconds: null, recoverAtSeconds: null }; }
    region(id) { return id ? this.song.regions.find((x) => x.id === id) : undefined; }
    cueFor(regionId) { return this.song.liveAssets?.cues.find((item) => item.targetRegionId === regionId); }
    armTimedTransition(regionId, repeatPrefix = false) { const region = this.region(regionId), cue = this.cueFor(regionId); if (!cue)
        throw new Error("Target section has no prepared announcement"); const lead = this.cueLeadSeconds(region, cue), regions = this.song.regions; let index = Math.max(0, regions.findIndex((item) => this.current.positionSeconds >= item.startSeconds && this.current.positionSeconds < item.endSeconds)), boundary = regions[index]?.endSeconds ?? this.current.positionSeconds, cueAt = boundary - lead, repeatAt = repeatPrefix ? cueAt - this.twoBeatSeconds() : null, warningAt = repeatAt ?? cueAt; if (warningAt <= this.current.positionSeconds + .05 && index + 1 < regions.length) {
        boundary = regions[++index].endSeconds;
        cueAt = boundary - lead;
        repeatAt = repeatPrefix ? cueAt - this.twoBeatSeconds() : null;
        warningAt = repeatAt ?? cueAt;
    } if (warningAt <= this.current.positionSeconds)
        throw new Error("Not enough song remains to give the full transition announcement"); this.effects.announceRecovery(regionId, cueAt, repeatAt); this.current = { ...this.current, recoveryRegionId: regionId, recoveryCueAtSeconds: cueAt, recoverAtSeconds: boundary }; }
    cueLeadSeconds(region, cue) { if (region.startPosition && cue.position) {
        const leadGridBeats = positionToGridBeats(region.startPosition, this.song.timeSignature) - positionToGridBeats(cue.position, this.song.timeSignature);
        return Math.max(0, leadGridBeats) * secondsPerNotatedBeat(this.song.selectedBpm, this.song.timeSignature);
    } return Math.max(0, region.startSeconds - cue.atSeconds); }
    twoBeatSeconds() { return secondsPerNotatedBeat(this.song.selectedBpm, this.song.timeSignature) * 2; }
    requireReady() { if (this.current.fault)
        throw new Error("Clear panic or fault before continuing playback"); if (!this.current.ready || (!this.current.playing && !this.current.readiness.ready))
        throw new Error("Performance session is not ready"); }
}
export function keyboardAction(key) { const normalized = key.toLowerCase(); return normalized === " " ? "play-pause" : normalized === "escape" ? "panic" : normalized === "arrowleft" ? "previous-section" : normalized === "arrowright" ? "next-section" : normalized === "l" ? "loop" : normalized === "c" ? "toggle-click" : normalized === "q" ? "toggle-cue" : normalized === "p" ? "toggle-pad" : null; }
export function validateRoutingPlan(plan) { const used = new Set(); for (const [bus, route] of Object.entries(plan)) {
    if (!Number.isInteger(route.firstOutput) || route.firstOutput < 1)
        throw new Error(`${bus} route must begin on a positive output`);
    for (let channel = route.firstOutput; channel < route.firstOutput + route.channels; channel += 1) {
        if (used.has(channel))
            throw new Error(`Output ${channel} is assigned more than once`);
        used.add(channel);
    }
} }
function regionAt(song, seconds) { return song.regions.find((region) => seconds >= region.startSeconds && seconds < region.endSeconds) ?? song.regions.at(-1); }
export function createMixerState(song) { const channels = song.stems.map((_, index) => { const mix = song.stemMix?.find(item => item.index === index), gain = Number(mix?.gain ?? 1), muted = Boolean(mix?.muted); return { id: `stem-${index}`, index, kind: "stem", gain: Number.isFinite(gain) ? Math.max(0, Math.min(1.25, gain)) : 1, muted, solo: Boolean(mix?.solo), iem: mix?.iem === undefined ? true : Boolean(mix.iem) }; }); if (!isMediaOnlySong(song)) {
    for (const kind of ["click", "cue", "pad"]) {
        const index = channels.length;
        channels.push({ id: kind, index, kind, gain: 1, muted: false, solo: false, iem: false });
    }
} return { masterGain: 1, channels: applyBusMix(song, channels, song.gldSavedBusMix) }; }
function unverifiedReadiness() { return { ready: true, status: "Ready with warnings", checks: [{ id: "runtime", label: "Runtime readiness", level: "warning", detail: "Runtime readiness was not supplied by the desktop host" }] }; }
//# sourceMappingURL=performance-session.js.map
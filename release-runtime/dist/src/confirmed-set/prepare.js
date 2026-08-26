import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { CONFIRMED_SET_SCHEMA_VERSION, DEFAULT_SHOW_STATE, validateConfirmedSet } from "./manifest.js";
import { isMediaOnlySong } from "../domain/song.js";
import { writeCachedCombinedWaveformSummary } from "../prep/wav-waveform.js";
import { prepareAudioSource, preparedAudioFilename } from "../prep/audio-source.js";
import { writeCountedCue } from "../prep/cue-sequence.js";
import { measureSongLoudness } from "../audio/song-loudness.js";
export async function confirmSet(input) {
    const totalUnits = Math.max(1, input.songs.reduce((total, song) => total + song.stems.length + 2, 0));
    let completedUnits = 0;
    const report = (label, progress) => input.onProgress?.({ progress: Math.max(0, Math.min(100, Math.round(progress ?? completedUnits / totalUnits * 90))), label });
    report("Preparing isolated set cache", 1);
    assertSafeId(input.setId);
    const finalDirectory = join(input.cacheRoot, input.setId);
    const temporaryDirectory = `${finalDirectory}.preparing-${process.pid}-${Date.now()}`;
    await assertDoesNotExist(finalDirectory);
    await mkdir(temporaryDirectory, { recursive: true });
    let copiedBytes = 0;
    try {
        const songs = [];
        let proPresenterSongPosition = 0;
        for (const [songIndex, inputSong] of input.songs.entries()) {
            report(`Caching ${inputSong.preparedSong.song.title}`);
            const songDirectory = join(temporaryDirectory, "songs", String(songIndex).padStart(3, "0"));
            await mkdir(songDirectory, { recursive: true });
            const cachedStems = [];
            const destinationNames = new Set();
            for (const source of inputSong.stems) {
                const sourcePath = source.sourcePath ?? join(inputSong.sourceFolder, source.relativePath);
                const sourceName = basename(sourcePath);
                const destinationName = extname(sourceName).toLowerCase() === ".m4a" ? preparedAudioFilename(sourceName) : sourceName;
                if (destinationNames.has(destinationName.toLowerCase()))
                    throw new Error(`Prepared stem filename collision: ${destinationName}`);
                destinationNames.add(destinationName.toLowerCase());
                const destinationPath = join(songDirectory, destinationName);
                const before = await stat(sourcePath);
                const sourceHash = await sha256File(sourcePath);
                if (sourceHash.toLowerCase() !== source.sha256.toLowerCase()) {
                    throw new Error(`Hash verification failed for ${source.relativePath}`);
                }
                await prepareAudioSource(sourcePath, destinationPath, input.ffmpegPath);
                copiedBytes += before.size;
                cachedStems.push({ role: source.role, sourcePath: destinationPath, durationSeconds: source.durationSeconds, ...(source.displayName ? { displayName: source.displayName } : {}) });
                completedUnits += 1;
                report(`Caching ${inputSong.preparedSong.song.title} · ${source.role}`);
            }
            const preparationWarnings = [];
            const waveformPath = join(songDirectory, "waveform.json");
            if (!cachedStems.length)
                throw new Error(`No waveform sources available for ${inputSong.preparedSong.song.title}`);
            const waveformSources = cachedStems.map((stem, index) => {
                const source = inputSong.stems[index];
                if (!source)
                    throw new Error(`Missing source fingerprint for ${stem.sourcePath}`);
                return { path: stem.sourcePath, sha256: source.sha256, durationSeconds: stem.durationSeconds };
            });
            try { await writeCachedCombinedWaveformSummary(waveformSources, waveformPath, join(dirname(input.cacheRoot), "waveform-peaks")); } catch (error) {
        preparationWarnings.push(`${inputSong.preparedSong.song.title}: waveform preview unavailable (${String(error)})`);
        await writeFile(waveformPath, JSON.stringify({ schemaVersion: 1, source: "preview-unavailable", sampleRate: 48000, channels: 2, durationSeconds: inputSong.preparedSong.durationSeconds, buckets: [] }));
      }
            completedUnits += 1;
            report(`Building ${inputSong.preparedSong.song.title} waveform`);
            report(`Matching ${inputSong.preparedSong.song.title} loudness`);
            const loudnessNormalization = await measureSongLoudness({ stemPaths: cachedStems.map(stem => stem.sourcePath), ...(inputSong.preparedSong.stemMix ? { stemMix: inputSong.preparedSong.stemMix } : {}), ...(input.ffmpegPath ? { ffmpegPath: input.ffmpegPath } : {}) }).catch(error => { preparationWarnings.push(`${inputSong.preparedSong.song.title}: loudness analysis unavailable (${String(error)})`); return inputSong.preparedSong.loudnessNormalization; });
            const liveAssets = inputSong.liveAssets ? await prepareLiveAssets(inputSong.liveAssets, inputSong.preparedSong, songDirectory, input.ffmpegPath, preparationWarnings) : undefined;
            completedUnits += 1;
            report(`Preparing ${inputSong.preparedSong.song.title} click, cues, and pad`);
            const preparedSong = { ...inputSong.preparedSong, stems: cachedStems, waveformPath, ...(loudnessNormalization ? { loudnessNormalization } : {}), preparationWarnings, ...(liveAssets ? { liveAssets } : {}) };
            const proPresenterPosition = isMediaOnlySong(preparedSong) ? null : ++proPresenterSongPosition;
            songs.push(resolveSetlistPositionMidi(preparedSong, proPresenterPosition));
        }
        const draftManifest = {
            schemaVersion: CONFIRMED_SET_SCHEMA_VERSION,
            id: input.setId,
            name: input.setName,
            confirmedAt: new Date().toISOString(),
            songs,
            ...(input.transitions ? { transitions: input.transitions } : {}),
            show: input.show ?? DEFAULT_SHOW_STATE,
        };
        const draftReport = validateConfirmedSet(draftManifest, { performanceOnly: true });
        report("Validating the complete performance package", 94);
        if (!draftReport.ready) {
            throw new Error(`Readiness validation failed: ${draftReport.issues.map((issue) => issue.message).join("; ")}`);
        }
        await writeFile(join(temporaryDirectory, "confirmed-set.json"), JSON.stringify(draftManifest, null, 2), { encoding: "utf8", flag: "wx" });
        await rename(temporaryDirectory, finalDirectory);
        report("Publishing the confirmed set", 98);
        // Paths are made final only after the directory is atomically published.
        const manifest = replacePathPrefix(draftManifest, temporaryDirectory, finalDirectory);
        const manifestPath = join(finalDirectory, "confirmed-set.json");
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
        report("Confirmed Set ready · opening Performance", 100);
        return { manifestPath, manifest, readiness: validateConfirmedSet(manifest, { performanceOnly: true }), copiedBytes };
    }
    catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
    }
}
/** Note 18 selects the presentation by its one-based ProPresenter song position. Media-only Playback cards do not count. */
export function resolveSetlistPositionMidi(song, proPresenterPosition) {
    if (proPresenterPosition === null)
        return song;
    const position = proPresenterPosition;
    if (!Number.isInteger(position) || position < 1 || position > 127)
        throw new Error("ProPresenter setlist position must be between 1 and 127");
    const rewrite = (events) => events.map((event) => (event.status & 0xf0) === 0x90 && event.data1 === 18 && event.data2 > 0
        ? { ...event, data2: position }
        : event);
    if (song.control)
        return { ...song, control: { ...song.control, proPresenterMidi: rewrite(song.control.proPresenterMidi) } };
    if (song.arrangement)
        return { ...song, arrangement: { ...song.arrangement, proPresenterMidi: rewrite(song.arrangement.proPresenterMidi) } };
    return song;
}
export async function loadConfirmedSet(manifestPath) {
    return JSON.parse(await readFile(manifestPath, "utf8"));
}
async function sha256File(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path))
        hash.update(chunk);
    return hash.digest("hex");
}
async function assertDoesNotExist(path) {
    try {
        await stat(path);
        throw new Error(`Confirmed set cache already exists: ${path}`);
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
}
function assertSafeId(value) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value))
        throw new Error("Set ID contains unsafe path characters");
}
function replacePathPrefix(manifest, from, to) {
    return {
        ...manifest,
        songs: manifest.songs.map((song) => ({
            ...song,
            stems: song.stems.map((stem) => ({ ...stem, sourcePath: join(to, stem.sourcePath.slice(from.length)) })),
            ...(song.waveformPath ? { waveformPath: join(to, song.waveformPath.slice(from.length)) } : {}),
            ...(song.liveAssets ? { liveAssets: {
                    click: { ...song.liveAssets.click, regularPath: join(to, song.liveAssets.click.regularPath.slice(from.length)), accentPath: join(to, song.liveAssets.click.accentPath.slice(from.length)) },
                    cues: song.liveAssets.cues.map((cue) => ({ ...cue, audioPath: join(to, cue.audioPath.slice(from.length)) })),
                    ...(song.liveAssets.cueCountVersion ? { cueCountVersion: song.liveAssets.cueCountVersion } : {}),
                    ...(song.liveAssets.countIn ? { countIn: song.liveAssets.countIn.map((event) => ({ ...event, audioPath: join(to, event.audioPath.slice(from.length)) })) } : {}),
                    repeatCuePath: join(to, song.liveAssets.repeatCuePath.slice(from.length)),
                    pad: { ...song.liveAssets.pad, audioPath: join(to, song.liveAssets.pad.audioPath.slice(from.length)) },
                } } : {}),
        })),
    };
}
async function prepareLiveAssets(sources, song, songDirectory, ffmpegPath, notices = []) {
    const assetDirectory = join(songDirectory, "live-assets");
    await mkdir(assetDirectory, { recursive: true });
    const regularPath = join(assetDirectory, "click-regular.wav"), accentPath = join(assetDirectory, "click-accent.wav");
    await prepareOptionalAudio(sources.click.regularPath, regularPath, ffmpegPath, notices);
    await prepareOptionalAudio(sources.click.accentPath, accentPath, ffmpegPath, notices);
    const cueDirectory = join(assetDirectory, "cues");
    await mkdir(cueDirectory, { recursive: true });
    // Reserve the Repeat command asset first. A song map can also contain a
    // visible cue named "Repeat" that points at this same source file.
    const repeatCuePath = join(cueDirectory, "repeat-command.wav");
    await prepareOptionalAudio(sources.repeatCuePath, repeatCuePath, ffmpegPath, notices);
    const copied = new Map();
    const usedNames = new Set(["repeat-command.wav"]);
    const cues = [];
    for (const cue of sources.cues) {
        let audioPath = copied.get(cue.sourcePath);
        if (!audioPath) {
            const base = safeFilename(cue.label) || "cue";
            let filename = `${base}.wav`;
            let suffix = 2;
            while (usedNames.has(filename.toLowerCase()))
                filename = `${base}-${suffix++}.wav`;
            usedNames.add(filename.toLowerCase());
            audioPath = join(cueDirectory, filename);
            if (song.liveAssets?.cueCountVersion === 2)
                await prepareOptionalAudio(cue.sourcePath, audioPath, ffmpegPath, notices);
            else
                await writeCountedCue({ sourcePath: cue.sourcePath, destinationPath: audioPath, numberDirectory: dirname(sources.repeatCuePath), bpm: song.selectedBpm, meter: song.timeSignature, ...(ffmpegPath ? { ffmpegPath } : {}) }).catch(async error => { notices.push(`${song.song.title}: counted cue unavailable; using its original announcement (${String(error)})`); await prepareOptionalAudio(cue.sourcePath, audioPath, ffmpegPath, notices); });
            copied.set(cue.sourcePath, audioPath);
        }
        cues.push({ ...(cue.position ? { position: cue.position } : {}), atSeconds: cue.atSeconds, label: cue.label, audioPath, targetRegionId: cue.targetRegionId });
    }
    const padPath = join(assetDirectory, `pad-${safeFilename(sources.pad.key)}.wav`);
    await prepareOptionalAudio(sources.pad.sourcePath, padPath, ffmpegPath, notices);
    return { click: { regularPath, accentPath, events: sources.click.events, templateId: sources.click.templateId }, cues, cueCountVersion: 2, repeatCuePath, pad: { key: sources.pad.key, audioPath: padPath } };
}
function safeFilename(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
//# sourceMappingURL=prepare.js.map
async function prepareOptionalAudio(sourcePath, destinationPath, ffmpegPath, notices) {
    try { await prepareAudioSource(sourcePath, destinationPath, ffmpegPath); }
    catch (error) {
        notices.push(`Optional audio unavailable: ${sourcePath || destinationPath}; silent in this confirmed set (${String(error)})`);
        // A short PCM silence keeps the native auxiliary reader valid; no music stem is substituted.
        const dataBytes = 4800 * 2 * 3, wav = Buffer.alloc(44 + dataBytes);
        wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
        wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(288000, 28); wav.writeUInt16LE(6, 32); wav.writeUInt16LE(24, 34);
        wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
        await writeFile(destinationPath, wav);
    }
}

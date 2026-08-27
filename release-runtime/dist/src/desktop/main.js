import { app, BrowserWindow, dialog, ipcMain, Menu, } from "electron";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile, } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, } from "node:path";
import { NativeEngineClient, } from "../live/native-engine-client.js";
import { MapEditorHistory } from "../edit/map-editor.js";
import { currentSongMapPath, loadSongMap, mapExists, saveSongMap, } from "../edit/map-persistence.js";
import { normalizeRegions } from "../edit/song-map.js";
import { createMixerState, DEFAULT_ROUTES, PerformanceSession, } from "../live/performance-session.js";
import { evaluatePerformanceReadiness } from "../live/performance-readiness.js";
import { DEFAULT_SHOW_STATE, } from "../confirmed-set/manifest.js";
import { buildDynamicClickEvents } from "../domain/grid.js";
import { isMediaOnlySong } from "../domain/song.js";
import { importReaperProject } from "../reaper/rpp-import.js";
import { saveArrangementVersion } from "../reaper/arrangement-persistence.js";
import { prepareArrangementCache } from "../reaper/arrangement-cache.js";
import { renderArrangementTracks } from "../reaper/arrangement-renderer.js";
import { confirmArrangement } from "../reaper/arrangement-confirm.js";
import { ArrangementEditorHistory, createArrangementDraft, normalizeStemMix, validateArrangementDraft, } from "../edit/arrangement-editor.js";
import { saveAppArrangement } from "../edit/app-arrangement-save.js";
import { arrangementDraftPath, loadArrangementDraft, saveArrangementDraft, } from "../edit/arrangement-draft-persistence.js";
import { editorStemDisplayLabels, performanceStemDisplayLabels, loadOrBuildEditorWaveforms, projectEditorWaveforms, } from "../edit/editor-workspace.js";
import { evaluateEditorReadiness } from "../edit/editor-readiness.js";
import { arrangementFingerprint, arrangementSourceFingerprint, reconcileArrangementDraftSource, } from "../edit/arrangement-editor.js";
import { productionDefaults } from "../config/settings.js";
import { importMasterCatalog } from "../library/master-spreadsheet.js";
import { scanMasterLibrary } from "../library/library-scanner.js";
import { loadSharedCandidateIndex, sharedCandidateMap, } from "../library/shared-candidate-index.js";
import { loadPlaybackAnalyzerPackage } from "../library/analyzer-package.js";
import { ANALYZER_SONG_MAP_VERSION, hydrateReviewSongLiveAssets, prepareCandidateReview, } from "../library/review-manifest.js";
import { addMediaFile, addPreparedSong, confirmOperatorSet, discoverPreparedLibrary, isMediaSetlistItem, loadOperatorSetlist, movePreparedSong, reorderPreparedSong, removePreparedSong, renameOperatorSetlist, replacePreparedSong, saveOperatorSetlist, setOperatorSetTransition, } from "../prep/operator-workflow.js";
import { exportRehearsalSong, rehearsalExportFilename, } from "../prep/rehearsal-export.js";
import { normalizeSongTransitionSettings, transitionDuration, } from "../live/song-transition.js";
import { runTimedSongTransition } from "../live/timed-song-transition.js";
import { randomBytes } from "node:crypto";
import { PlaybackCommandBus, } from "../control/command-bus.js";
import { RemoteControlServer, } from "../control/remote-server.js";
import { networkInterfaces } from "node:os";
import { FOOT_CONTROLLER_PROFILES, MidiInputRouter, } from "../control/midi-input.js";
import { externalOutputs } from "../control/mixers/gld-exclusive-recall.js";
import { SurfaceGldRecall as GldBusRecall } from "../control/mixers/gld-surface-recall.js";
import { PLAYBACK_RETURNS, busId } from "../control/mixers/gld-bus-mix.js";
import { encodeGldIntent, Gld112SafeClient, } from "../control/mixers/gld112.js";
import { GldMidiFeedback } from "../control/mixers/gld-midi-feedback.js";
import { proPresenterApiSlideEvents, proPresenterCueIndexFromMidiValue, proPresenterDueSlideEvents, } from "../control/propresenter-api-slides.js";
import { parseAudioDeviceList, reconcileAudioDevice, } from "../audio/device-selection.js";
import { classifyStemOutput, DEFAULT_INSTRUMENT_OUTPUTS, PLAYBACK_OUTPUT_PROFILE, } from "../audio/output-layout.js";
import { reconcileAudioRouting } from "../audio/routing-reconcile.js";
import { deriveAudioRouting, migrateGlobalBusRouting, normalizeGlobalBusRouting, } from "../audio/global-bus-routing.js";
import { loadClickSoundSettings, saveClickSoundSettings, validateClickSound, } from "../audio/click-sound-settings.js";
const sourceRoot = resolve(import.meta.dirname, "../../..");
const projectRoot = app.isPackaged ? app.getPath("userData") : sourceRoot;
const codeRoot = app.isPackaged ? app.getAppPath() : sourceRoot;
const assetRoot = app.isPackaged ? process.resourcesPath : sourceRoot;
const runtimeFfmpegPath = app.isPackaged
    ? join(assetRoot, "runtime", "ffmpeg.exe")
    : join(sourceRoot, "vendor", "runtime", "ffmpeg.exe");
process.env.PLAYBACK_FFMPEG_PATH ??= runtimeFfmpegPath;
process.env.PATH = `${dirname(runtimeFfmpegPath)};${process.env.PATH ?? ""}`;
const manifestArgument = process.argv
    .find((value) => value.startsWith("--manifest="))
    ?.slice("--manifest=".length);
const explicitManifestPath = manifestArgument
    ? resolve(manifestArgument)
    : process.env.PLAYBACK_MANIFEST_PATH
        ? resolve(process.env.PLAYBACK_MANIFEST_PATH)
        : null;
app.setAppUserModelId("org.handytech.playbackv3");
let manifestPath = explicitManifestPath ?? "";
const enginePath = app.isPackaged
    ? join(assetRoot, "native", "PlaybackEngineProbe.exe")
    : join(sourceRoot, "native", "build", "PlaybackEngineProbe_artefacts", "Release", "PlaybackEngineProbe.exe");
let engine = new NativeEngineClient();
let window = null;
let statusTimer = null;
let editor = null;
let performance = null;
let pendingImport = null;
let selectedMidiOutput = null;
let selectedAudioDevice = null;
let cachedAudioDevices = [];
let selectedAudioRouting = null;
let selectedStereoRouting = null;
let gldOnNativeFault=()=>{};
let handleGldMidiFeedback=()=>false;
let globalBusRouting = null;
let globalBusRoutingLocked = true;
let selectedMidiInput = null;
let arrangementEditor = null;
let controlBus = null;
let remoteServer = null;
let remoteAddress = null;
let lastControlPublish = 0;
let midiInputRouter = null;
let surfaceMixerMidiEnabled = false;
let libraryActivity = {
    sync: "idle",
    analyzer: "idle",
    startedAt: null,
    finishedAt: null,
    message: "Library has not been scanned in this session.",
    lastScan: null,
};
const SETLIST_EXPORT_DIRECTORY = "D:\\Dropbox\\Worship\\Setlists";
const REHEARSAL_EXPORT_DIRECTORY = "D:\\Dropbox\\Worship\\Rehearsal Exports";
const EMPTY_SONG_ID = "__playback_empty__";
const emptyWaveform = {
    schemaVersion: 1,
    source: "",
    sampleRate: 44100,
    channels: 1,
    durationSeconds: 1,
    buckets: [],
};
const runtimeWaveformCache = new Map();
function emptyStartupManifest() {
    return {
        schemaVersion: 1,
        id: "empty-startup",
        name: "No Confirmed Set",
        confirmedAt: new Date(0).toISOString(),
        songs: [
            {
                song: {
                    id: EMPTY_SONG_ID,
                    title: "No Song Loaded",
                    artist: "",
                    vendor: "",
                    originalKey: "C",
                    originalBpm: 120,
                    originalTimeSignature: { numerator: 4, denominator: 4 },
                },
                selectedKey: "C",
                selectedBpm: 120,
                timeSignature: { numerator: 4, denominator: 4 },
                durationSeconds: 1,
                stems: [],
                regions: [],
                cues: [],
                cacheFingerprint: "empty-startup",
            },
        ],
    };
}
async function preparePackagedRuntime() {
    if (!app.isPackaged)
        return;
    const target = join(projectRoot, ".playback-cache");
    try {
        const active = JSON.parse(await readFile(join(projectRoot, ".playback-data", "active-arrangement.json"), "utf8"));
        await readFile(String(active.manifestPath));
        return;
    }
    catch { }
    await mkdir(projectRoot, { recursive: true });
    try {
        await cp(join(assetRoot, "seed-cache"), target, {
            recursive: true,
            force: false,
            errorOnExist: false,
        });
        await rewritePortableJson(target);
    }
    catch {
        await mkdir(target, { recursive: true });
    }
}
async function rewritePortableJson(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await rewritePortableJson(path);
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json"))
            continue;
        try {
            const parsed = JSON.parse(await readFile(path, "utf8"));
            await writeFile(path, JSON.stringify(relocateCachePaths(parsed), null, 2));
        }
        catch { }
    }
}
function relocateCachePaths(value) {
    if (typeof value === "string") {
        const normalized = value.replaceAll("/", "\\"), marker = "\\.playback-cache\\", index = normalized.toLowerCase().indexOf(marker);
        return index >= 0
            ? join(projectRoot, ".playback-cache", normalized.slice(index + marker.length))
            : value;
    }
    if (Array.isArray(value))
        return value.map(relocateCachePaths);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            relocateCachePaths(item),
        ]));
    return value;
}
async function armNativeSong(songIndex, sourceManifestPath = manifestPath, routing = activeAudioRouting()) {
    if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
    }
    await engine.closeAndWait();
    engine = new NativeEngineClient();
    let lastPerformanceStateSent = 0, lastPerformanceStateSignature = "";
    engine.on("transport", (state) => {
        performance?.updatePosition(state.positionSeconds);
        sendToRenderer("playback:transport", state);
        const now = Date.now();
        const snapshot = performance?.snapshot, signature = snapshot
            ? `${snapshot.songIndex}:${snapshot.playing ? 1 : 0}:${snapshot.currentRegionId ?? ""}:${snapshot.loopRegionId ?? ""}:${snapshot.panicActive ? 1 : 0}:${snapshot.recoveryRegionId ?? ""}:${snapshot.ready ? 1 : 0}:${snapshot.fault ?? ""}`
            : "none";
        if (signature !== lastPerformanceStateSignature ||
            now - lastPerformanceStateSent >= 100) {
            lastPerformanceStateSignature = signature;
            lastPerformanceStateSent = now;
            sendToRenderer("performance:state", snapshot);
        }
        if (now - lastControlPublish >= 100) {
            lastControlPublish = now;
            controlBus?.publishState();
        }
    });

    engine.on("fault", (error) => {
        gldOnNativeFault();
        performance?.reportFault(error.message);
        sendToRenderer("performance:state", performance?.snapshot);
        controlBus?.publishState();
    });
    engine.on("midi-input", (event) => {
        const handledByGld=handleGldMidiFeedback(event);
        if(!handledByGld)void midiInputRouter?.handle(event);
        sendToRenderer("control:midi-input", event);
    });
    engine.on("meters", (meters) => sendToRenderer("mixer:meters", meters));
    let lastHealthSent = 0, lastHealthSignature = "";
    engine.on("health", (health) => {
        const signature = `${health.sampleRate}:${health.blockFrames}:${health.xruns}:${health.deadlineMisses}:${health.deviceError}`, now = Date.now();
        if (signature !== lastHealthSignature || now - lastHealthSent >= 1000) {
            lastHealthSignature = signature;
            lastHealthSent = now;
            sendToRenderer("audio:health", health);
        }
    });
    const ready = await engine.start(enginePath, sourceManifestPath, songIndex, selectedMidiOutput, selectedAudioDevice, selectedMidiInput, routing);
    statusTimer = setInterval(() => engine.requestStatus(), 33);
    return ready;
}
async function createWindow() {
    await preparePackagedRuntime();
    window = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 1100,
        minHeight: 680,
        show: false,
        backgroundColor: "#0a0d12",
        title: "Playback V3",
        autoHideMenuBar: false,
        useContentSize: true,
        webPreferences: {
            preload: join(codeRoot, "desktop-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    installWindowsMenu(window);
    try {
        const settings = JSON.parse(await readFile(join(projectRoot, ".playback-data", "device-settings.json"), "utf8"));
        selectedMidiOutput =
            typeof settings.midiOutputName === "string"
                ? settings.midiOutputName
                : null;
        selectedMidiInput =
            typeof settings.midiInputName === "string"
                ? settings.midiInputName
                : null;
        selectedAudioDevice =
            settings.audioDevice &&
                typeof settings.audioDevice.type === "string" &&
                typeof settings.audioDevice.name === "string"
                ? settings.audioDevice
                : null;
        selectedAudioRouting = settings.audioRouting ?? null;
        selectedStereoRouting = settings.stereoRouting ?? null;
        globalBusRouting = settings.globalBusRouting
            ? normalizeGlobalBusRouting(settings.globalBusRouting)
            : null;
        globalBusRoutingLocked = settings.globalBusRoutingLocked !== false;
    }
    catch { }
    await refreshAudioDeviceCache();
    await saveDeviceSettings();
    const operatorSetlistPath = join(projectRoot, ".playback-data", "draft-setlist.json");
    let operatorSetlist = await loadOperatorSetlist(operatorSetlistPath);
    await pruneRuntimeDataForSetlist(operatorSetlist);
    let emptyStartup = false;
    if (!explicitManifestPath) {
        const activeManifest = await activeConfirmedManifestPath();
        if (activeManifest)
            manifestPath = activeManifest;
        else {
            const candidates = operatorSetlist.items
                .filter((item) => !isMediaSetlistItem(item))
                .map((item) => resolve(item.manifestPath));
            let recovered = null;
            for (const candidate of candidates) {
                if (!candidate || !isPreparedManifestPath(candidate))
                    continue;
                try {
                    const parsed = JSON.parse(await readFile(candidate, "utf8"));
                    if (Array.isArray(parsed?.songs) &&
                        parsed.songs.length &&
                        Array.isArray(parsed.songs[0]?.stems)) {
                        recovered = candidate;
                        break;
                    }
                }
                catch { }
            }
            if (recovered)
                manifestPath = recovered;
            else
                emptyStartup = true;
        }
    }
    let manifest = emptyStartup
        ? emptyStartupManifest()
        : JSON.parse(await readFile(manifestPath, "utf8"));
    const selectedSongPath = join(projectRoot, ".playback-data", "selected-song.json");
    let selectedSongIndex = 0;
    try {
        const selected = JSON.parse(await readFile(selectedSongPath, "utf8"));
        if (Number.isInteger(selected.index) && manifest.songs[selected.index])
            selectedSongIndex = selected.index;
    }
    catch { }
    const selectedStemCount = manifest.songs[selectedSongIndex].stems.length, selectedStemLabels = performanceStemDisplayLabels(manifest.songs[selectedSongIndex]);
    const legacyRouting = migrateLegacyRouting(reconcileAudioRouting(selectedAudioRouting ? normalizeAudioRouting(selectedAudioRouting) : null, defaultAudioRouting(selectedStemCount, selectedStemLabels), selectedStemCount));
    globalBusRouting = migrateGlobalBusRouting(globalBusRouting, legacyRouting, selectedStemLabels);
    selectedAudioRouting = deriveAudioRouting(globalBusRouting, selectedStemLabels);
    selectedStereoRouting = reconcileAudioRouting(selectedStereoRouting ? normalizeAudioRouting(selectedStereoRouting) : null, stereoAudioRouting(selectedStemCount), selectedStemCount);
    validateAudioRouting(selectedAudioRouting, manifest.songs[selectedSongIndex].stems.length);
    await saveDeviceSettings();
    const libraryIndexPath = join(projectRoot, ".playback-data", "library-index.json");
    try {
        const savedIndex = JSON.parse(await readFile(libraryIndexPath, "utf8"));
        libraryActivity = {
            ...libraryActivity,
            sync: "complete",
            analyzer: savedIndex.counts?.["needs-analysis"] > 0 ? "waiting" : "idle",
            finishedAt: savedIndex.scannedAt ?? null,
            message: "Saved library index loaded. Run Update Metadata + Library to check for changes.",
            lastScan: savedIndex,
        };
    }
    catch { }
    const clickSoundSettingsPath = join(projectRoot, ".playback-data", "click-sound-settings.json"), defaultClickSounds = {
        normalPath: join(productionDefaults.clickFolder, "CLICK.wav"),
        accentPath: join(productionDefaults.clickFolder, "CLICK ACCENT.wav"),
    };
    let clickSoundSettings = await loadClickSoundSettings(clickSoundSettingsPath, defaultClickSounds);
    let transitionSettings = await loadTransitionSettings();
    let currentReady = null, nativeArmError = null;
    let armedManifestPath = resolve(manifestPath), armedSongIndex = selectedSongIndex;
    const armSourceSong = async (sourceManifestPath, songIndex, routingOverride) => {
        const targetPath = resolve(sourceManifestPath), routing = routingOverride ?? activeAudioRouting();
        let readyState;
        try {
            if (!engine.isRunning)
                throw new Error("Native engine is not running");
            if (routing)
                await engine.setRouting(routing);
            readyState =
                armedManifestPath === targetPath
                    ? await engine.selectSong(songIndex)
                    : await engine.selectManifest(targetPath, songIndex);
        }
        catch (error) {
            console.warn("Warm song activation failed; using verified cold restart", error);
            readyState = await armNativeSong(songIndex, targetPath, routing);
        }
        currentReady = readyState;
        nativeArmError = null;
        armedManifestPath = targetPath;
        armedSongIndex = songIndex;
        return readyState;
    };
    const ensureSourceSongArmed = async (sourceManifestPath, songIndex) => armedManifestPath === resolve(sourceManifestPath) &&
        armedSongIndex === songIndex &&
        currentReady
        ? currentReady
        : armSourceSong(sourceManifestPath, songIndex);
    const ready = currentReady ?? {
        deviceOpenMs: 0,
        armMs: 0,
        stems: 0,
        nextReady: false,
        nextIndex: -1,
        outputChannels: 0,
        routingReady: false,
        iemReady: false,
        stereoFallback: false,
        midiEvents: 0,
        midiEnabled: false,
    };
    const mapRoot = join(projectRoot, ".playback-data");
    let editorContext;
    const editorContexts = new Map(), editorManifestSignatures = new Map();
    const originalSongLabels = async (preparedSong, sourceManifestPath) => {
        const normalized = resolve(sourceManifestPath).replaceAll("/", "\\"), arrangementsMarker = "\\arrangements\\", arrangementsAt = normalized.toLowerCase().indexOf(arrangementsMarker);
        if (arrangementsAt >= 0) {
            const songRoot = normalized.slice(0, arrangementsAt);
            try {
                const analyzer = await loadPlaybackAnalyzerPackage(songRoot), originalStems = analyzer?.audioFiles
                    .filter((file) => typeof file.playbackBus === "string" && file.playbackBus.trim())
                    .map((file) => ({
                    role: file.playbackBus,
                    sourcePath: resolve(songRoot, file.path),
                    durationSeconds: preparedSong.durationSeconds,
                    displayName: basename(file.path).replace(/\.[^.]+$/, ""),
                }));
                if (originalStems?.length)
                    return { ...preparedSong, stems: originalStems };
            }
            catch (error) {
                console.warn("Could not read original WAV labels from playback-song.json", error);
            }
        }
        const original = (await preparedChoices()).find((choice) => choice.songId === preparedSong.song.id &&
            choice.arrangement === "Original Song");
        if (original)
            try {
                const originalManifest = JSON.parse(await readFile(original.manifestPath, "utf8"));
                const song = originalManifest.songs[original.songIndex];
                if (song)
                    return song;
            }
            catch { }
        for (const path of await localReviewManifestPaths()) {
            try {
                const review = JSON.parse(await readFile(path, "utf8"));
                const song = review.songs.find((item) => item.song.id === preparedSong.song.id && !item.arrangement);
                if (song)
                    return song;
            }
            catch { }
        }
        return undefined;
    };
    const loadEditorContext = async (sourceManifestPath, songIndex, activate = true) => {
        const contextKey = `${resolve(sourceManifestPath)}:${songIndex}`, cached = editorContexts.get(contextKey);
        if (cached) {
            if (activate) {
                editorContext = cached;
                editor = cached.editorHistory;
                arrangementEditor = cached.arrangementHistory;
            }
            return true;
        }
        const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8")), preparedSong = sourceManifest.songs[songIndex];
        if (!preparedSong)
            throw new Error("Editor source song is unavailable");
        const currentSourceFingerprint = arrangementSourceFingerprint(preparedSong);
        const arrangementSourceId = preparedSong.arrangement?.id ?? "original-song";
        const liveCues = preparedSong.liveAssets?.cues?.length
            ? preparedSong.liveAssets.cues
            : preparedSong.cues.map((cue) => ({
                label: cue.phrase,
                ...(cue.position ? { position: cue.position } : {}),
                atSeconds: cue.atSeconds,
                targetRegionId: cue.targetRegionId,
                audioPath: "",
            }));
        const editableMap = {
            schemaVersion: 1,
            songId: preparedSong.song.id,
            bpm: preparedSong.selectedBpm,
            timeSignature: preparedSong.timeSignature,
            durationSeconds: preparedSong.durationSeconds,
            reviewState: "draft",
            revision: 0,
            source: {
                kind: "analyzer",
                path: "playback-song.json",
                importedAt: new Date().toISOString(),
                sourceFingerprint: currentSourceFingerprint,
                sourceArrangementId: arrangementSourceId,
            },
            regions: normalizeRegions(preparedSong.regions),
            cues: liveCues.map((cue, index) => ({
                id: `cue-${String(index + 1).padStart(4, "0")}`,
                phrase: cue.label,
                ...(cue.position ? { position: cue.position } : {}),
                atSeconds: cue.atSeconds,
                targetRegionId: cue.targetRegionId,
                enabled: true,
                audioPath: cue.audioPath,
                sourceLabel: cue.label,
            })),
        }, savedMapPath = currentSongMapPath(mapRoot, editableMap.songId), baseArrangementDraft = createArrangementDraft(preparedSong), loadedMap = (await mapExists(savedMapPath))
            ? await loadSongMap(savedMapPath)
            : null, initialMap = loadedMap && loadedMap.source.sourceFingerprint === currentSourceFingerprint && loadedMap.source.sourceArrangementId === arrangementSourceId
            ? loadedMap
            : editableMap, draftFile = arrangementDraftPath(mapRoot, preparedSong.song.id, arrangementSourceId), restoredDraftValue = await loadArrangementDraft(draftFile, preparedSong.song.id, {
            sourceFingerprint: currentSourceFingerprint,
            sourceArrangementId: arrangementSourceId,
        }), restoredDraft = restoredDraftValue
            ? reconcileArrangementDraftSource(restoredDraftValue, baseArrangementDraft)
            : null, draftSource = restoredDraft ?? baseArrangementDraft, savedDraft = {
            ...draftSource,
            stemMix: normalizeStemMix(draftSource.stemMix ?? preparedSong.stemMix, preparedSong.stems.length),
        }, stemDisplayLabels = editorStemDisplayLabels(preparedSong, await originalSongLabels(preparedSong, sourceManifestPath)), waveformCachePath = join(projectRoot, ".playback-cache", "editor-waveforms", `${safeCacheName(preparedSong.cacheFingerprint)}.json`), editorHistory = new MapEditorHistory(initialMap), arrangementHistory = new ArrangementEditorHistory(savedDraft), context = {
            sourceManifestPath: resolve(sourceManifestPath),
            songIndex,
            preparedSong,
            baseArrangementDraft,
            arrangementSourceId,
            draftFile,
            savedDraft,
            stemDisplayLabels,
            sourceWaveforms: loadOrBuildEditorWaveforms(preparedSong, waveformCachePath, 2400, "ffmpeg", stemDisplayLabels),
            editorHistory,
            arrangementHistory,
            mixerChannels: savedDraft.stemMix,
        };
        editorContexts.set(contextKey, context);
        if (activate) {
            editorContext = context;
            editor = editorHistory;
            arrangementEditor = arrangementHistory;
        }
        return false;
    };
    const workspaceState = async () => {
        const context = editorContext, draft = arrangementEditor.draft, waveforms = projectEditorWaveforms(await context.sourceWaveforms, draft), padFile = `Pad_${padKey(draft.selectedKey)}.wav`, readiness = await evaluateEditorReadiness({
            draft,
            source: context.preparedSong,
            cacheRoot: join(projectRoot, ".playback-cache"),
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            cueDirectory: productionDefaults.cueFolder,
            padPath: join(productionDefaults.padFolder, padFile),
            routingReady: currentReady?.routingReady === true,
            midiOutputName: selectedMidiOutput,
            ffmpegPath: runtimeFfmpegPath,
        });
        context.mixerChannels = normalizeStemMix(context.mixerChannels ?? draft.stemMix ?? context.preparedSong.stemMix, context.preparedSong.stems.length);
        return {
            draft: { ...draft, stemMix: context.mixerChannels },
            waveforms,
            stemLabels: context.stemDisplayLabels,
            mixer: { channels: context.mixerChannels },
            readiness,
            dirty: arrangementFingerprint({ ...draft, stemMix: context.mixerChannels }) !==
                arrangementFingerprint(context.savedDraft),
            canUndo: arrangementEditor.canUndo,
            canRedo: arrangementEditor.canRedo,
            source: {
                kind: context.preparedSong.arrangement?.sourceType ?? "original-song",
                id: context.arrangementSourceId,
                name: context.preparedSong.arrangement?.name ?? "Original Song",
                hash: context.preparedSong.arrangement?.sourceSha256 ??
                    context.preparedSong.cacheFingerprint,
            },
            originalFacts: context.preparedSong.song,
        };
    };
    const quickWorkspaceState = async () => {
        const context = editorContext, draft = arrangementEditor.draft, emptyBuckets = Array.from({ length: 2400 }, () => ({ min: 0, max: 0 })), placeholder = {
            schemaVersion: 1,
            sourceDurationSeconds: context.preparedSong.durationSeconds,
            bucketCount: 2400,
            stems: context.preparedSong.stems.map((stem, index) => ({
                id: `stem-${String(index + 1).padStart(2, "0")}`,
                role: context.stemDisplayLabels[index] ?? stem.role,
                sourcePath: stem.sourcePath,
                durationSeconds: stem.durationSeconds,
                buckets: emptyBuckets,
            })),
            summary: emptyBuckets,
        }, waveforms = projectEditorWaveforms(placeholder, draft), padFile = `Pad_${padKey(draft.selectedKey)}.wav`, readiness = await evaluateEditorReadiness({
            draft,
            source: context.preparedSong,
            cacheRoot: join(projectRoot, ".playback-cache"),
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            cueDirectory: productionDefaults.cueFolder,
            padPath: join(productionDefaults.padFolder, padFile),
            routingReady: currentReady?.routingReady === true,
            midiOutputName: selectedMidiOutput,
            ffmpegPath: runtimeFfmpegPath,
        });
        context.mixerChannels = normalizeStemMix(context.mixerChannels ?? draft.stemMix ?? context.preparedSong.stemMix, context.preparedSong.stems.length);
        return {
            draft: { ...draft, stemMix: context.mixerChannels },
            waveforms,
            stemLabels: context.stemDisplayLabels,
            mixer: { channels: context.mixerChannels },
            readiness,
            dirty: arrangementFingerprint({ ...draft, stemMix: context.mixerChannels }) !==
                arrangementFingerprint(context.savedDraft),
            canUndo: arrangementEditor.canUndo,
            canRedo: arrangementEditor.canRedo,
            source: {
                kind: context.preparedSong.arrangement?.sourceType ?? "original-song",
                id: context.arrangementSourceId,
                name: context.preparedSong.arrangement?.name ?? "Original Song",
                hash: context.preparedSong.arrangement?.sourceSha256 ??
                    context.preparedSong.cacheFingerprint,
            },
            originalFacts: context.preparedSong.song,
        };
    };
    const readinessFor = (songIndex, native = currentReady, error = nativeArmError) => evaluatePerformanceReadiness({
        manifest,
        manifestPath,
        songIndex,
        native,
        midiOutputName: selectedMidiOutput,
        nativeError: error,
    });
    const loadRuntimeWaveform = async (activeSong) => {
        if (activeSong.song.id === EMPTY_SONG_ID || !activeSong.waveformPath)
            return emptyWaveform;
        try {
            const info = await stat(activeSong.waveformPath), cached = runtimeWaveformCache.get(activeSong.waveformPath);
            if (cached &&
                cached.mtimeMs === info.mtimeMs &&
                cached.size === info.size)
                return cached.payload;
            const payload = JSON.parse(await readFile(activeSong.waveformPath, "utf8"));
            runtimeWaveformCache.set(activeSong.waveformPath, {
                mtimeMs: info.mtimeMs,
                size: info.size,
                payload,
            });
            return payload;
        }
        catch {
            return emptyWaveform;
        }
    };
    const performanceSongPayload = async (songIndex) => {
        const activeSong = manifest.songs[songIndex];
        if (!activeSong)
            throw new Error("Song is outside the confirmed set");
        return {
            index: songIndex,
            song: activeSong,
            waveform: await loadRuntimeWaveform(activeSong),
            stemLabels: performanceStemDisplayLabels(activeSong),
        };
    };
    let controlSettings = await loadOrCreateControlSettings();
    let publishGld = () => {};
    const gldRecall = new GldBusRecall({
        root: join(projectRoot, ".playback-data"),
        defaults: {transport:"midi", midiOutputName:controlSettings.gld.midiOutputName ?? "", midiChannel:controlSettings.gld.midiChannel,
            host:controlSettings.gld.host || "192.168.5.126", port:51325, mapping:{...PLAYBACK_RETURNS}},
        sendMidi:sendMidiBytes, testMidi:testMidiOutput, isEnabled:()=>surfaceMixerMidiEnabled,
        isStopped:()=>!performance?.snapshot.playing && !performance?.snapshot.channels.pad,
        stopAudio:()=>{try{performance?.stop();controlBus?.publishState();}catch{try{engine.stop();}catch{}}},
        resolveOutputs:mapping=>externalOutputs(mapping,activeAudioRouting()??{}),
        setExternalOutputs:outputs=>engine.setExternalOutputs(outputs),
        onSurfaceState:enabled=>{
            surfaceMixerMidiEnabled=enabled;
            performance?.syncSurfaceMixerState(enabled);
            if(performance)sendToRenderer("performance:state",performance.snapshot);
            controlBus?.publishState();publishGld();
        },
    });
    await gldRecall.load();
    const gldInputs=await listMidiInputs(),gldInputName=gldRecall.config.transport==="midi"&&gldInputs.includes(gldRecall.config.midiOutputName)?gldRecall.config.midiOutputName:"";
    if(gldInputName&&selectedMidiInput!==gldInputName){selectedMidiInput=gldInputName;await saveDeviceSettings();}
    let applyingGldFeedback=false;
    const gldFeedback=new GldMidiFeedback({midiChannel:gldRecall.config.midiChannel,midiInputName:gldInputName,mapping:gldRecall.config.mapping,onFeedback:feedback=>{
        if(!gldRecall.armed||!gldRecall.surfaceEnabled||!performance)return;
        const state=performance.snapshot,song=manifest.songs[state.songIndex];if(!song)return;
        const targets=state.mixer.channels.filter(channel=>busId(song,channel)===feedback.bus);
        applyingGldFeedback=true;
        try {
            for(const channel of targets) {
                const patch=feedback.type==="fader"?{gain:feedback.gain}:{muted:feedback.muted};
                if(feedback.type==="fader"&&Math.abs(channel.gain-feedback.gain)<1e-9||feedback.type==="mute"&&channel.muted===feedback.muted)continue;
                performance.setMixerChannel(channel.index,patch);
            }
            gldRecall.status=`Surface Mixer ON: GLD input ${feedback.input} ${feedback.type} received`;
            sendToRenderer("performance:state",performance.snapshot);controlBus?.publishState();publishGld();
        } catch(error) {console.warn("GLD feedback was ignored; playback continues",error);}
        finally {applyingGldFeedback=false;}
    }});
    handleGldMidiFeedback=event=>{const channel=(Number(event?.status)&0x0f)+1;if(channel!==gldRecall.config.midiChannel)return false;gldFeedback.handle(event);return true;};
    const gldState=()=>({...gldRecall.state(),feedback:gldFeedback.state()});
    gldOnNativeFault=()=>gldRecall.nativeFault();
    publishGld = () => sendToRenderer("gld-bus:state",gldState());
    const recallGldSong = async song => { try{await gldRecall.recall(song);}catch(error){gldRecall.disarm(error.message);}publishGld(); };
    const currentGldSong = () => {
        const state=performance?.snapshot, song=manifest.songs[state?.songIndex];
        if(!song || song.song.id===EMPTY_SONG_ID || isMediaOnlySong(song)) throw new Error("Load a song in Performance mode first");
        return {song,state};
    };
    ipcMain.handle("gld-bus:get",async()=>({...gldState(),midiOutputs:await listMidiOutputs(),midiInputs:await listMidiInputs()}));
    ipcMain.handle("gld-bus:configure",async(_event,value)=>{await gldRecall.configure(value);
        const inputs=await listMidiInputs(),input=gldRecall.config.transport==="midi"&&inputs.includes(gldRecall.config.midiOutputName)?gldRecall.config.midiOutputName:"";
        if(gldRecall.config.transport==="midi"&&!input)throw Error("The selected GLD MIDI device has no matching input for two-way control");
        gldFeedback.configure({midiChannel:gldRecall.config.midiChannel,midiInputName:input,mapping:gldRecall.config.mapping});
        if(input&&selectedMidiInput!==input){selectedMidiInput=input;await saveDeviceSettings();if(performance){currentReady=await armNativeSong(performance.snapshot.songIndex);performance.setReadiness(await readinessFor(performance.snapshot.songIndex,currentReady,null));}}
        await gldRecall.restoreNativeOwnership();publishGld();return gldState();});
    ipcMain.handle("gld-bus:connection-test",async()=>gldRecall.transportTest());
    ipcMain.handle("gld-bus:test",async(_event,value)=>gldRecall.testBus(value));
    ipcMain.handle("gld-bus:confirm",(_event,id)=>gldRecall.acknowledge(id));
    ipcMain.handle("gld-bus:arm",async()=>{const result=await controlBus.dispatch({type:"midi.surface",enabled:true},"ui");if(!result.ok)throw Error(result.error);return gldRecall.state();});
    ipcMain.handle("gld-bus:disarm",async()=>{const result=await controlBus.dispatch({type:"midi.surface",enabled:false},"ui");if(!result.ok)throw Error(result.error);return gldRecall.state();});
    ipcMain.handle("gld-bus:preview",()=>{const {song,state}=currentGldSong();return gldRecall.preview(song,state.mixer);});
    ipcMain.handle("gld-bus:save",async()=>{const {song,state}=currentGldSong();const result=await gldRecall.save(song,state.mixer);publishGld();return result;});
    ipcMain.handle("gld-bus:save-all",async()=>{
        const entries=manifest.songs.filter(song=>song.song.id!==EMPTY_SONG_ID&&!isMediaOnlySong(song)).map(song=>({song,mixer:createMixerState(song)}));
        const activeState=performance?.snapshot,activeSong=manifest.songs[activeState?.songIndex];
        const recallSong=activeSong&&activeSong.song.id!==EMPTY_SONG_ID&&!isMediaOnlySong(activeSong)?activeSong:null;
        const result=await gldRecall.saveAll(entries,recallSong);publishGld();return result;
    });
    for(const song of manifest.songs) gldRecall.prepare(song);
    let activeProPresenterSetlist = null;
    const proPresenterApiSlides = new ProPresenterApiSlideScheduler(() => ({
        settings: controlSettings.proPresenterApi,
        songs: manifest.songs,
        performance: performance?.snapshot ?? null,
        syncedSetlist: activeProPresenterSetlist,
    }));
    const applyPreparedSongMixer = async (song) => {
        gldRecall.prepare(song);
        for (const channel of createMixerState(song).channels)
            engine.setMixerChannel(channel.index, channel.gain, channel.muted, channel.solo, channel.iem);
        await gldRecall.restoreNativeOwnership();
        await gldRecall.resumeSurface(song,createMixerState(song));
        publishGld();
    };
    const canArmCurrentSong = () => !emptyStartup &&
        manifest.songs[performance.snapshot.songIndex]?.song.id !== EMPTY_SONG_ID;
    const audioStateWithoutArm = () => ({
        selectedDevice: selectedAudioDevice,
        routing: activeAudioRouting(),
        routingReady: currentReady?.routingReady === true,
        iemReady: currentReady?.iemReady === true,
        outputChannels: selectedAudioDevice?.outputChannels ??
            selectedAudioDevice?.maxOutputChannels ??
            currentReady?.outputChannels ??
            0,
        stereoFallback: Number(selectedAudioDevice?.outputChannels ??
            selectedAudioDevice?.maxOutputChannels ??
            0) === 2,
    });
    const selectPerformanceSong = async (index) => {
        gldRecall.prepare(manifest.songs[index]);
        const slidesMidiEnabled = performance.snapshot.slidesMidiEnabled;
        selectedAudioRouting = deriveAudioRouting(globalBusRouting, performanceStemDisplayLabels(manifest.songs[index]));
        const selected = await armSourceSong(manifestPath, index);
        if (!slidesMidiEnabled)
            engine.slidesMidiOff();
        currentReady = {
            ...selected,
            midiEnabled: slidesMidiEnabled && selected.midiEnabled !== false,
        };
        nativeArmError = null;
        armedManifestPath = resolve(manifestPath);
        armedSongIndex = index;
        await applyPreparedSongMixer(manifest.songs[index]);
        void primeProPresenterApiSong(controlSettings.proPresenterApi, manifest.songs, index, activeProPresenterSetlist);
        await saveDeviceSettings();
        await writeFile(selectedSongPath, JSON.stringify({ index, selectedAt: new Date().toISOString() }, null, 2));
        await recallGldSong(manifest.songs[index]);
        return readinessFor(index, currentReady, null);
    };
    const beginPerformanceTransition = async (plan) => {
        const index = plan.toSongIndex, slidesMidiEnabled = performance.snapshot.slidesMidiEnabled;
        selectedAudioRouting = deriveAudioRouting(globalBusRouting, performanceStemDisplayLabels(manifest.songs[index]));
        await engine.setRouting(selectedAudioRouting);
        gldRecall.assertPlayable();
        await gldRecall.recall(manifest.songs[index]);
        await gldRecall.restoreNativeOwnership();
        publishGld();
        try {
            const selected = await engine.beginSongTransition(index, plan.type, plan.durationSeconds, plan.continuePad);
            if (!slidesMidiEnabled)
                engine.slidesMidiOff();
            currentReady = {
                ...selected,
                midiEnabled: slidesMidiEnabled && selected.midiEnabled !== false,
            };
            nativeArmError = null;
            armedManifestPath = resolve(manifestPath);
            armedSongIndex = index;
            await applyPreparedSongMixer(manifest.songs[index]);
            void primeProPresenterApiSong(controlSettings.proPresenterApi, manifest.songs, index, activeProPresenterSetlist);
            await saveDeviceSettings();
            await writeFile(selectedSongPath, JSON.stringify({ index, selectedAt: new Date().toISOString() }, null, 2));

            return {
                readiness: await readinessFor(index, currentReady, null),
                elapsedSeconds: selected.elapsedSeconds,
            };
        }
        catch (error) {
            console.warn("Native A/B transition failed; using boundary handoff fallback", error);
            const readiness = await runTimedSongTransition(plan, {
                wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
                stop: () => engine.stop(),
                selectSong: selectPerformanceSong,
                setPad: (enabled) => (enabled ? engine.padOn() : engine.padOff()),
                play: () => {gldRecall.assertPlayable();engine.play();},
            });
            return { readiness, elapsedSeconds: 0 };
        }
    };
    const effects = {
        play: () => {gldRecall.assertPlayable();engine.play();},
        pause: () => engine.pause(),
        stop: () => engine.stop(),
        seek: (seconds) => engine.seek(seconds),
        panic: () => engine.panic(),
        announceRecovery: (regionId, atSeconds, repeatAtSeconds) => engine.announceRecovery(regionId, atSeconds, repeatAtSeconds),
        cancelTransition: () => engine.cancelTransition(),
        recover: () => engine.recover(),
        setBus: (bus, enabled) => {
            if(enabled)gldRecall.assertPlayable();
            if (bus === "music")
                enabled ? engine.musicOn() : engine.musicOff();
            else if (bus === "click")
                enabled ? engine.clickOn() : engine.clickOff();
            else if (bus === "cue")
                enabled ? engine.cueOn() : engine.cueOff();
            else
                enabled ? engine.padOn() : engine.padOff();
        },
        setBusGain: (bus, gain) => engine.setBusGain(bus, gain),
        setMixerChannel: (channel) => {
            const state=performance.snapshot,song=manifest.songs[state.songIndex];
            if(channel.gain > 1.25 && (!gldRecall.enabled() || !gldRecall.ownershipReady || !gldRecall.config.mapping[busId(song,channel)]))
                throw Error("Levels above the local limit require a mapped GLD return with GLD-only audio levels enabled");
            engine.setMixerChannel(channel.index, channel.gain, channel.muted, channel.solo, channel.iem);
            const previous=state.mixer.channels[channel.index];
            if(!applyingGldFeedback && gldRecall.config.mapping[busId(song,channel)] && (previous?.gain!==channel.gain || previous?.muted!==channel.muted)) {
                const mixer={...state.mixer,channels:state.mixer.channels.map(c=>c.index===channel.index?channel:c)};
                void gldRecall.live(song,mixer).then(publishGld).catch(error=>{gldRecall.disarm(error.message);publishGld();});
            }
        },
        setMasterGain: (gain) => engine.setMasterGain(gain),
        setSlidesMidiEnabled: (enabled) => enabled ? engine.slidesMidiOn() : engine.slidesMidiOff(),
        setSurfaceMixerMidiEnabled: async (enabled) => {
            const current=enabled?currentGldSong():{};
            if(enabled&&gldRecall.config.transport==="midi"&&!gldFeedback.state().enabled)throw Error("GLD two-way MIDI input is unavailable");
            try {await gldRecall.setSurfaceEnabled(enabled,current.song,current.state?.mixer);}
            finally {publishGld();}
        },
        selectSong: selectPerformanceSong,
        beginTimedSongTransition: beginPerformanceTransition,
    };
    const initialReadiness = await readinessFor(selectedSongIndex);
    performance = new PerformanceSession(manifest, effects, manifest.show?.routing ?? DEFAULT_ROUTES, initialReadiness, manifest.show?.mixer, selectedSongIndex);
    controlBus = new PlaybackCommandBus(performance, manifest.name);
    controlBus.onState((state) => sendToRenderer("control:state", state));
    if (!emptyStartup)
        void armSourceSong(manifestPath, selectedSongIndex)
            .then(async (readyState) => {
            currentReady = readyState;
            nativeArmError = null;
            await applyPreparedSongMixer(manifest.songs[selectedSongIndex]);
            performance.setReadiness(await readinessFor(selectedSongIndex, readyState, null));
            sendToRenderer("performance:state", performance.snapshot);
            controlBus?.publishState();
        })
            .catch(async (error) => {
            nativeArmError = error instanceof Error ? error.message : String(error);
            performance.setReadiness(await readinessFor(selectedSongIndex, null, nativeArmError));
            sendToRenderer("performance:state", performance.snapshot);
            controlBus?.publishState();
        });
    midiInputRouter = new MidiInputRouter(controlBus, FOOT_CONTROLLER_PROFILES[controlSettings.footControllerProfile]);
    remoteServer = new RemoteControlServer(controlBus, {
        token: controlSettings.token,
        host: controlSettings.lanEnabled ? "0.0.0.0" : "127.0.0.1",
        httpPort: controlSettings.httpPort,
        oscPort: controlSettings.oscPort,
        enableOsc: controlSettings.oscEnabled,
        oscTokenRequired: controlSettings.lanEnabled,
    });
    try {
        remoteAddress = await remoteServer.start();
    }
    catch (error) {
        console.error("Remote control adapter unavailable", error);
        remoteAddress = null;
    }
    if (currentReady && manifest.show)
        for (const [bus, gain] of Object.entries(manifest.show.mixer))
            engine.setBusGain(bus, gain);
    if (nativeArmError)
        performance.reportFault(nativeArmError);
    const bootstrapPayload = async () => {
        const activeSongIndex = performance.snapshot.songIndex, activeSong = manifest.songs[activeSongIndex], activeWaveform = emptyStartup
            ? emptyWaveform
            : await loadRuntimeWaveform(activeSong), labels = performanceStemDisplayLabels(activeSong);
        return {
            ready: currentReady ?? ready,
            manifest,
            waveform: activeWaveform,
            stemLabels: labels,
            activeSongIndex,
            performance: performance.snapshot,
            selectedManifestPath: manifestPath,
            arrangements: emptyStartup
                ? []
                : await listPreparedArrangements(manifest),
            midi: {
                outputs: await listMidiOutputs(),
                selectedOutput: selectedMidiOutput,
                enabled: selectedMidiOutput !== null,
            },
            audio: {
                devices: cachedAudioDevices,
                selectedDevice: selectedAudioDevice,
                routing: activeAudioRouting(),
                globalBusRouting,
                globalBusRoutingLocked,
                routingLabels: labels,
                routingReady: (currentReady ?? ready).routingReady === true,
                iemReady: (currentReady ?? ready).iemReady === true,
                outputChannels: (currentReady ?? ready).outputChannels ?? 0,
                stereoFallback: (currentReady ?? ready).stereoFallback === true,
            },
        };
    };
    const loadConfirmedPerformancePackage = async (nextManifestPath, nextManifest, nextSongIndex = 0) => {
        sendToRenderer("prep:confirm-status", {
            progress: 88,
            label: "Loading confirmed set into Performance without restarting...",
        });
        manifestPath = resolve(nextManifestPath);
        manifest = nextManifest;
        for(const song of manifest.songs) gldRecall.prepare(song);
        gldRecall.disarm("Surface Mixer OFF: set changed; use Surface Mixer ON to control the new set");
        publishGld();
        emptyStartup = false;
        selectedSongIndex =
            Number.isInteger(nextSongIndex) && manifest.songs[nextSongIndex]
                ? nextSongIndex
                : 0;
        const labels = performanceStemDisplayLabels(manifest.songs[selectedSongIndex]);
        globalBusRouting = migrateGlobalBusRouting(globalBusRouting, selectedAudioRouting, labels);
        selectedAudioRouting = deriveAudioRouting(globalBusRouting, labels);
        selectedStereoRouting = reconcileAudioRouting(selectedStereoRouting ? normalizeAudioRouting(selectedStereoRouting) : null, stereoAudioRouting(manifest.songs[selectedSongIndex].stems.length), manifest.songs[selectedSongIndex].stems.length);
        await saveDeviceSettings();
        currentReady = null;
        nativeArmError = null;
        performance = new PerformanceSession(manifest, effects, manifest.show?.routing ?? DEFAULT_ROUTES, await readinessFor(selectedSongIndex, null, null), manifest.show?.mixer, selectedSongIndex);
        controlBus = new PlaybackCommandBus(performance, manifest.name);
        controlBus.onState((state) => sendToRenderer("control:state", state));
        midiInputRouter = new MidiInputRouter(controlBus, FOOT_CONTROLLER_PROFILES[controlSettings.footControllerProfile]);
        if (remoteServer)
            await remoteServer.close().catch(() => undefined);
        remoteServer = new RemoteControlServer(controlBus, {
            token: controlSettings.token,
            host: controlSettings.lanEnabled ? "0.0.0.0" : "127.0.0.1",
            httpPort: controlSettings.httpPort,
            oscPort: controlSettings.oscPort,
            enableOsc: controlSettings.oscEnabled,
            oscTokenRequired: controlSettings.lanEnabled,
        });
        try {
            remoteAddress = await remoteServer.start();
        }
        catch (error) {
            console.error("Remote control adapter unavailable", error);
            remoteAddress = null;
        }
        try {
            currentReady = await armSourceSong(manifestPath, selectedSongIndex);
            await applyPreparedSongMixer(manifest.songs[selectedSongIndex]);
            void primeProPresenterApiSong(controlSettings.proPresenterApi, manifest.songs, selectedSongIndex, activeProPresenterSetlist);
            if (manifest.show) for (const [bus, gain] of Object.entries(manifest.show.mixer)) engine.setBusGain(bus, gain);
        } catch (error) {
            currentReady = null;
            nativeArmError = error instanceof Error ? error.message : String(error);
            console.warn("Set confirmed; audio engine needs attention", error);
        }
        performance.setReadiness(await readinessFor(selectedSongIndex, currentReady, nativeArmError));
        sendToRenderer("performance:state", performance.snapshot);
        controlBus.publishState();
        sendToRenderer("prep:confirm-status", {
            progress: 100,
            label: "Performance package loaded.",
        });
        return bootstrapPayload();
    };
    ipcMain.handle("playback:bootstrap", bootstrapPayload);
    const repairLegacyReviewCues = async (choice) => {
        const source = JSON.parse(await readFile(choice.manifestPath, "utf8")), song = source.songs[choice.songIndex], review = source.review, catalogId = review?.catalogId;
        if (!catalogId || !song)
            return choice;
        const currentMap = Number(review.songMapVersion) === ANALYZER_SONG_MAP_VERSION, currentCues = Number(song.liveAssets?.cueCountVersion) >= 2 &&
            (song.liveAssets?.cues?.length ?? 0) > 0;
        if (currentMap && currentCues)
            return choice;
        const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath), master = catalog.songs.find((item) => item.catalogId === catalogId);
        if (!master)
            throw new Error(`${choice.title} cannot repair its song map because it is missing from the master catalog`);
        const repaired = await prepareCandidateReview({
            catalogId,
            master,
            sharedMetadataRoot: productionDefaults.sharedMetadataRoot,
            libraryRoot: productionDefaults.libraryRoot,
            cacheRoot: join(projectRoot, ".playback-cache", "library-review"),
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            cueFolder: productionDefaults.cueFolder,
            padFolder: productionDefaults.padFolder,
            ffmpegPath: runtimeFfmpegPath,
        }), next = (await discoverPreparedLibrary([repaired.manifestPath]))[choice.songIndex];
        if (!next?.manifestPath)
            throw new Error(`${choice.title} song-map repair did not produce a prepared song`);
        return next;
    };
    const repairPreparedChoices = async (choices) => Promise.all(choices.map((choice) => repairLegacyReviewCues(choice).catch((error) => {
        console.warn(`Could not repair prepared review cues for ${choice.title}`, error);
        return choice;
    })));
    const repairPreparedChoicesStrict = async (choices, onProgress) => {
        const repaired = [];
        for (const [index, choice] of choices.entries()) {
            onProgress?.({
                progress: Math.round(3 + (index / Math.max(choices.length, 1)) * 17),
                label: `Checking cue audio for ${choice.title}`,
            });
            repaired.push(await repairLegacyReviewCues(choice).catch(error => { console.warn(`Cue repair skipped for ${choice.title}; confirmation will continue`, error); return choice; }));
        }
        return repaired;
    };
    const preparedChoices = async () => repairPreparedChoices(await discoverPreparedLibrary(await allPreparedManifestPaths(operatorSetlist)));
    const prepResponse = async (extra = {}) => {
        const prepared = await ensureSetlistOriginalVersions(await preparedChoices(), operatorSetlist, clickSoundSettings, runtimeFfmpegPath);
        try {
            const relinked = relinkImportedSetlist(operatorSetlist, prepared);
            if (JSON.stringify(relinked.items) !== JSON.stringify(operatorSetlist.items)) {
                operatorSetlist = relinked;
                await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
            }
        }
        catch { }
        return {
            ...extra,
            setlist: operatorSetlist,
            prepared,
            versionRegistry: preparedVersionRegistry(prepared),
        };
    };
    ipcMain.handle("prep:get", async () => prepResponse());
    ipcMain.handle("prep:status", async () => ({
        ...libraryActivity,
        libraryRoot: productionDefaults.libraryRoot,
        masterWorkbookPath: productionDefaults.masterWorkbookPath,
    }));
    ipcMain.handle("prep:update", async () => {
        libraryActivity = {
            ...libraryActivity,
            sync: "running",
            analyzer: "scanning",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            message: "Reading the master workbook, Analyzer metadata, and song folders…",
        };
        sendToRenderer("prep:status", libraryActivity);
        try {
            const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath), shared = sharedCandidateMap(await loadSharedCandidateIndex(productionDefaults.sharedMetadataRoot)), scan = await scanMasterLibrary(catalog.songs, shared), setSongIds = new Set(operatorSetlist.items.map((item) => String(item.songId)));
            let updated = 0, unchanged = 0;
            const failures = [];
            const reviewSongs = scan.songs.filter((record) => record.readiness === "needs-review" &&
                setSongIds.has(String(record.master.catalogId)));
            for (const [index, record] of reviewSongs.entries()) {
                libraryActivity = {
                    ...libraryActivity,
                    message: `Updating ${record.master.title} (${index + 1}/${reviewSongs.length})…`,
                };
                sendToRenderer("prep:status", libraryActivity);
                try {
                    const result = await prepareCandidateReview({
                        catalogId: record.master.catalogId,
                        master: record.master,
                        sharedMetadataRoot: productionDefaults.sharedMetadataRoot,
                        libraryRoot: productionDefaults.libraryRoot,
                        cacheRoot: join(projectRoot, ".playback-cache", "library-review"),
                        clickRegularPath: clickSoundSettings.normalPath,
                        clickAccentPath: clickSoundSettings.accentPath,
                        cueFolder: productionDefaults.cueFolder,
                        padFolder: productionDefaults.padFolder,
                        ffmpegPath: runtimeFfmpegPath,
                    });
                    result.updated ? (updated += 1) : (unchanged += 1);
                }
                catch (error) {
                    failures.push({
                        songId: record.master.catalogId,
                        title: record.master.title,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            // Loaded workspaces retain song maps in memory. Clearing only this in-memory
            // layer makes the next song selection read the newly prepared metadata while
            // leaving saved setlists and arrangements untouched.
            editorContexts.clear();
            await pruneRuntimeDataForSetlist(operatorSetlist);
            const indexSnapshot = {
                counts: scan.counts,
                scannedAt: scan.scannedAt,
                updated,
                unchanged,
                failures,
                songs: scan.songs.map((record) => ({
                    songId: record.master.catalogId,
                    title: record.master.title,
                    artist: record.master.artist,
                    vendor: record.master.vendor,
                    key: record.master.key ??
                        shared.get(record.master.catalogId)?.estimatedKey ??
                        null,
                    bpm: record.master.bpm,
                    readiness: record.readiness,
                    issues: record.issues,
                })),
            };
            await mkdir(dirname(libraryIndexPath), { recursive: true });
            await writeFile(libraryIndexPath, JSON.stringify(indexSnapshot, null, 2));
            const result = await prepResponse(indexSnapshot);
            libraryActivity = {
                ...libraryActivity,
                sync: "complete",
                analyzer: result.counts["needs-analysis"] > 0 ? "waiting" : "idle",
                finishedAt: new Date().toISOString(),
                message: failures.length
                    ? `Library updated; ${failures.length} song(s) need attention.`
                    : `Library updated; ${updated} changed song(s) rebuilt and ${unchanged} unchanged.`,
                lastScan: result,
            };
            sendToRenderer("prep:status", libraryActivity);
            return result;
        }
        catch (error) {
            libraryActivity = {
                ...libraryActivity,
                sync: "fault",
                analyzer: "idle",
                finishedAt: new Date().toISOString(),
                message: error instanceof Error ? error.message : String(error),
            };
            sendToRenderer("prep:status", libraryActivity);
            throw error;
        }
    });
    ipcMain.handle("prep:review", async (_event, catalogId) => {
        const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath), master = catalog.songs.find((song) => song.catalogId === catalogId);
        if (!master)
            throw new Error("Song is not present in the master catalog");
        const review = await prepareCandidateReview({
            catalogId,
            master,
            sharedMetadataRoot: productionDefaults.sharedMetadataRoot,
            libraryRoot: productionDefaults.libraryRoot,
            cacheRoot: join(projectRoot, ".playback-cache", "library-review"),
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            cueFolder: productionDefaults.cueFolder,
            padFolder: productionDefaults.padFolder,
            ffmpegPath: runtimeFfmpegPath,
        }), reviewChoices = await discoverPreparedLibrary([review.manifestPath]), choice = reviewChoices.find((item) => item.arrangement === "Original Song") ??
            reviewChoices[0];
        if (!choice)
            throw new Error("Prepared review song could not be loaded");
        operatorSetlist = addPreparedSong(operatorSetlist, choice);
        await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
        await pruneRuntimeDataForSetlist(operatorSetlist);
        return prepResponse({
            addedItemId: operatorSetlist.items.at(-1)?.itemId,
            manifestPath: review.manifestPath,
        });
    });
    ipcMain.handle("prep:command", async (_event, command) => {
        if (command.action === "add") {
            const choice = (await preparedChoices()).find((item) => item.id === command.choiceId);
            if (!choice)
                throw new Error("Prepared song version is no longer available");
            const index = Number.isInteger(command.index) && command.index >= 0
                ? Number(command.index)
                : operatorSetlist.items.length;
            operatorSetlist = addPreparedSong(operatorSetlist, choice, index);
        }
        else if (command.action === "add-media") {
            let sourcePath = typeof command.sourcePath === "string" ? command.sourcePath : "";
            if (!sourcePath) {
                const chosen = await dialog.showOpenDialog(window, {
                    title: "Add WAV Media",
                    properties: ["openFile"],
                    filters: [{ name: "WAV audio", extensions: ["wav"] }],
                });
                if (chosen.canceled || !chosen.filePaths[0])
                    return prepResponse({ cancelled: true });
                sourcePath = chosen.filePaths[0];
            }
            const index = Number.isInteger(command.index) && command.index >= 0
                ? Number(command.index)
                : operatorSetlist.items.length;
            operatorSetlist = addMediaFile(operatorSetlist, sourcePath, index);
        }
        else if (command.action === "replace") {
            const choice = (await preparedChoices()).find((item) => item.id === command.choiceId);
            if (!choice)
                throw new Error("Prepared song version is no longer available");
            operatorSetlist = replacePreparedSong(operatorSetlist, command.itemId, choice);
        }
        else if (command.action === "remove")
            operatorSetlist = removePreparedSong(operatorSetlist, command.itemId);
        else if (command.action === "move")
            operatorSetlist = movePreparedSong(operatorSetlist, command.itemId, command.direction);
        else if (command.action === "reorder")
            operatorSetlist = reorderPreparedSong(operatorSetlist, command.itemId, command.beforeItemId ?? null);
        else if (command.action === "transition")
            operatorSetlist = setOperatorSetTransition(operatorSetlist, command.itemId, command.type, command.continuePad !== false);
        else if (command.action === "rename")
            operatorSetlist = renameOperatorSetlist(operatorSetlist, command.name);
        else if (command.action === "clear")
            operatorSetlist = {
                ...operatorSetlist,
                items: [],
                updatedAt: new Date().toISOString(),
            };
        else
            throw new Error("Unknown setlist command");
        await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
        activeProPresenterSetlist = null;
        editorContexts.clear();
        await pruneRuntimeDataForSetlist(operatorSetlist);
        return prepResponse();
    });
    ipcMain.handle("prep:send-propresenter", async () => {
        activeProPresenterSetlist = await syncProPresenterApiDraftSetlist(controlSettings.proPresenterApi, operatorSetlist);
        if (!activeProPresenterSetlist)
            throw new Error("ProPresenter setlist was not sent. Check that API is enabled, the set contains songs, and the HTTP API port matches Enable Network in ProPresenter.");
        return {
            playlistId: activeProPresenterSetlist.playlistId,
            songs: activeProPresenterSetlist.songIndexes.size,
            placeholders: activeProPresenterSetlist.placeholders,
        };
    });
    ipcMain.handle("prep:export-setlist", async () => {
        const exportPath = await exportOperatorSetlist(operatorSetlist);
        return { path: exportPath, setlist: operatorSetlist };
    });
    ipcMain.handle("prep:import-setlist", async () => {
        const chosen = await dialog.showOpenDialog(window, {
            title: "Import Playback Setlist",
            defaultPath: SETLIST_EXPORT_DIRECTORY,
            properties: ["openFile"],
            filters: [{ name: "Playback setlists", extensions: ["json"] }],
        });
        if (chosen.canceled || !chosen.filePaths[0])
            return prepResponse({ cancelled: true });
        const imported = parseExportedSetlist(JSON.parse(await readFile(chosen.filePaths[0], "utf8")));
        const prepared = await ensureSetlistOriginalVersions(await discoverPreparedLibrary(await allPreparedManifestPaths(imported)), imported, clickSoundSettings, runtimeFfmpegPath);
        operatorSetlist = relinkImportedSetlist(imported, prepared);
        await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
        activeProPresenterSetlist = null;
        editorContexts.clear();
        editorContext = null;
        editor = null;
        arrangementEditor = null;
        await pruneRuntimeDataForSetlist(operatorSetlist);
        return prepResponse({ importedPath: chosen.filePaths[0] });
    });
    ipcMain.handle("prep:load-item", async (_event, itemId) => {
        if(gldRecall.armed){gldRecall.disarm("Surface Mixer OFF: editor opened; use Surface Mixer ON in Performance");publishGld();}
        const started = Date.now(), report = (progress, label) => sendToRenderer("editor:load-status", { itemId, progress, label }), item = operatorSetlist.items.find((candidate) => candidate.itemId === itemId);
        if (!item)
            throw new Error("Set song is no longer available");
        if (isMediaSetlistItem(item))
            throw new Error("WAV media items do not open in the arrangement editor");
        const choice = await repairLegacyReviewCues(item);
        const repairedItem = {
            ...item,
            ...choice,
            itemId: item.itemId,
            ...(item.transitionToNext
                ? { transitionToNext: item.transitionToNext }
                : {}),
            ...(item.stemMix ? { stemMix: item.stemMix } : {}),
        };
        if (JSON.stringify(repairedItem) !== JSON.stringify(item)) {
            operatorSetlist = {
                ...operatorSetlist,
                items: operatorSetlist.items.map((candidate) => candidate.itemId === itemId ? repairedItem : candidate),
                updatedAt: new Date().toISOString(),
            };
            await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
        }
        report(20, choice.arrangement === "Original Song"
            ? "Loading Original Song"
            : "Loading selected arrangement");
        await hydrateReviewSongLiveAssets({
            manifestPath: choice.manifestPath,
            songIndex: choice.songIndex,
            cueFolder: productionDefaults.cueFolder,
            ffmpegPath: runtimeFfmpegPath,
        });
        const resolvedChoicePath = resolve(choice.manifestPath), contextKey = `${resolvedChoicePath}:${choice.songIndex}`, manifestStat = await stat(resolvedChoicePath), manifestSignature = `${manifestStat.size}:${manifestStat.mtimeMs}`;
        if (editorManifestSignatures.get(contextKey) !== manifestSignature)
            editorContexts.delete(contextKey);
        editorManifestSignatures.set(contextKey, manifestSignature);
        const alreadyLoaded = await loadEditorContext(choice.manifestPath, choice.songIndex), loadContext = editorContext;
        report(alreadyLoaded ? 70 : 40, alreadyLoaded
            ? "Restoring cached workspace"
            : "Opening editor while peaks load");
        const sourceManifest = JSON.parse(await readFile(choice.manifestPath, "utf8")), sourceSong = sourceManifest.songs[choice.songIndex];
        if (!sourceSong)
            throw new Error("Selected editor song is missing");
        const editorRouting = deriveAudioRouting(globalBusRouting, performanceStemDisplayLabels(sourceSong)), readyState = await armSourceSong(choice.manifestPath, choice.songIndex, editorRouting), workspace = await quickWorkspaceState();
        void loadContext.sourceWaveforms
            .then((bundle) => {
            if (editorContext !== loadContext)
                return;
            sendToRenderer("editor:waveforms-ready", {
                itemId,
                waveforms: projectEditorWaveforms(bundle, arrangementEditor.draft),
            });
        })
            .catch((error) => console.warn("Background editor waveform build failed", error));
        report(100, "Ready to edit");
        return {
            itemId,
            manifestPath: choice.manifestPath,
            workspace,
            ready: readyState,
            loadMs: Date.now() - started,
            cached: alreadyLoaded,
        };
    });
    ipcMain.handle("transitions:get", () => transitionSettings);
    ipcMain.handle("transitions:set", async (_event, value) => {
        transitionSettings = normalizeSongTransitionSettings(value);
        await saveTransitionSettings(transitionSettings);
        return transitionSettings;
    });
    ipcMain.handle("prep:confirm", async (_event, options) => {
        const prepared = await ensureSetlistOriginalVersions(await repairPreparedChoicesStrict(await discoverPreparedLibrary(await allPreparedManifestPaths(operatorSetlist)), (status) => sendToRenderer("prep:confirm-status", status)), operatorSetlist, clickSoundSettings, runtimeFfmpegPath);
        operatorSetlist = relinkImportedSetlist(operatorSetlist, prepared);
        await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
        const result = await confirmOperatorSet({
            setlist: operatorSetlist,
            cacheRoot: join(projectRoot, ".playback-cache", "confirmed-sets"),
            transitionSettings,
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            onProgress: (status) => sendToRenderer("prep:confirm-status", status),
            ...(manifest.show ? { show: manifest.show } : {}),
        });
        await mkdir(join(projectRoot, ".playback-data"), { recursive: true });
        await writeFile(join(projectRoot, ".playback-data", "active-arrangement.json"), JSON.stringify({
            manifestPath: result.manifestPath,
            selectedAt: new Date().toISOString(),
        }, null, 2));
        if (Number.isInteger(options?.selectedIndex) &&
            result.manifest.songs[options.selectedIndex])
            await writeFile(selectedSongPath, JSON.stringify({
                index: options.selectedIndex,
                selectedAt: new Date().toISOString(),
            }, null, 2));
        const bootstrap = await loadConfirmedPerformancePackage(result.manifestPath, result.manifest, Number.isInteger(options?.selectedIndex) ? options.selectedIndex : 0);
        return {
            manifestPath: result.manifestPath,
            songs: result.manifest.songs.length,
            readiness: result.readiness,
            bootstrap,
        };
    });
    ipcMain.handle("midi:set-output", async (_event, name) => {
        const outputs = await listMidiOutputs();
        if (name !== null && !outputs.includes(name))
            throw new Error("MIDI output is no longer available");
        selectedMidiOutput = name;
        await saveDeviceSettings();
        currentReady = await armNativeSong(performance.snapshot.songIndex);
        if (!performance.snapshot.slidesMidiEnabled) {
            engine.slidesMidiOff();
            currentReady = { ...currentReady, midiEnabled: false };
        }
        await applyPreparedSongMixer(manifest.songs[performance.snapshot.songIndex]);
        nativeArmError = null;
        const readiness = await readinessFor(performance.snapshot.songIndex);
        performance.setReadiness(readiness);
        sendToRenderer("performance:state", performance.snapshot);
        return {
            selectedOutput: name,
            enabled: name !== null,
            ready: currentReady,
            readiness,
        };
    });
    ipcMain.handle("audio:set-device", async (_event, device) => {
        const devices = await refreshAudioDeviceCache();
        if (device &&
            !devices.some((x) => x.type === device.type && x.name === device.name))
            throw new Error("Audio device is no longer available");
        selectedAudioDevice = device;
        await saveDeviceSettings();
        if (!canArmCurrentSong())
            return audioStateWithoutArm();
        currentReady = await armNativeSong(performance.snapshot.songIndex);
        await applyPreparedSongMixer(manifest.songs[performance.snapshot.songIndex]);
        nativeArmError = null;
        const readiness = await readinessFor(performance.snapshot.songIndex);
        performance.setReadiness(readiness);
        if (readiness.ready && performance.snapshot.fault) performance.clearFault();
        sendToRenderer("performance:state", performance.snapshot);
        return {
            selectedDevice: device,
            routing: activeAudioRouting(),
            routingReady: currentReady.routingReady === true,
            iemReady: currentReady.iemReady === true,
            outputChannels: currentReady.outputChannels ?? 0,
            stereoFallback: currentReady.stereoFallback === true,
            readiness,
        };
    });
    ipcMain.handle("audio:set-routing", async (_event, routing) => {
        const normalized = normalizeAudioRouting(routing);
        validateAudioRouting(normalized, manifest.songs[performance.snapshot.songIndex].stems.length);
        if (isTwoChannelDevice())
            selectedStereoRouting = normalized;
        else
            selectedAudioRouting = normalized;
        await saveDeviceSettings();
        if (!canArmCurrentSong())
            return {
                routing: activeAudioRouting(),
                routingReady: false,
                iemReady: false,
                outputChannels: selectedAudioDevice?.outputChannels ?? 0,
                readiness: performance.snapshot.readiness,
            };
        currentReady = await armNativeSong(performance.snapshot.songIndex);
        await applyPreparedSongMixer(manifest.songs[performance.snapshot.songIndex]);
        nativeArmError = null;
        const readiness = await readinessFor(performance.snapshot.songIndex);
        performance.setReadiness(readiness);
        sendToRenderer("performance:state", performance.snapshot);
        return {
            routing: activeAudioRouting(),
            routingReady: currentReady.routingReady === true,
            iemReady: currentReady.iemReady === true,
            outputChannels: currentReady.outputChannels ?? 0,
            readiness,
        };
    });
    ipcMain.handle("audio:set-global-bus-routing", async (_event, value) => {
        if (globalBusRoutingLocked)
            throw new Error("The global output matrix is locked. Unlock it before making routing changes.");
        globalBusRouting = normalizeGlobalBusRouting(value);
        const index = performance.snapshot.songIndex;
        selectedAudioRouting = deriveAudioRouting(globalBusRouting, performanceStemDisplayLabels(manifest.songs[index]));
        await saveDeviceSettings();
        if (!canArmCurrentSong())
            return {
                globalBusRouting,
                routing: selectedAudioRouting,
                routingReady: false,
                iemReady: false,
                outputChannels: selectedAudioDevice?.outputChannels ?? 0,
                readiness: performance.snapshot.readiness,
            };
        currentReady = await armNativeSong(index, manifestPath, selectedAudioRouting);
        await applyPreparedSongMixer(manifest.songs[index]);
        nativeArmError = null;
        const readiness = await readinessFor(index, currentReady);
        performance.setReadiness(readiness);
        return {
            globalBusRouting,
            routing: selectedAudioRouting,
            routingReady: currentReady.routingReady === true,
            iemReady: currentReady.iemReady === true,
            outputChannels: currentReady.outputChannels ?? 0,
            readiness,
        };
    });
    ipcMain.handle("audio:set-global-bus-routing-lock", async (_event, locked) => {
        globalBusRoutingLocked = locked !== false;
        await saveDeviceSettings();
        return { globalBusRouting, globalBusRoutingLocked, routing: selectedAudioRouting };
    });
    ipcMain.handle("audio:refresh", async () => {
        const devices = await refreshAudioDeviceCache();
        let fellBack = false;
        if (selectedAudioDevice) {
            const activeDevice = selectedAudioDevice;
            if (!devices.some((device) => sameAudioDevice(device, activeDevice))) {
                selectedAudioDevice = null;
                fellBack = true;
                await saveDeviceSettings();
                if (canArmCurrentSong()) {
                    currentReady = await armNativeSong(performance.snapshot.songIndex);
                    await applyPreparedSongMixer(manifest.songs[performance.snapshot.songIndex]);
                    nativeArmError = null;
                    const readiness = await readinessFor(performance.snapshot.songIndex);
                    performance.setReadiness(readiness);
                    sendToRenderer("performance:state", performance.snapshot);
                }
            }
        }
        return {
            devices,
            selectedDevice: selectedAudioDevice,
            fellBack,
            routingReady: currentReady?.routingReady === true,
            iemReady: currentReady?.iemReady === true,
            outputChannels: selectedAudioDevice?.outputChannels ??
                currentReady?.outputChannels ??
                0,
            stereoFallback: Number(selectedAudioDevice?.outputChannels ??
                currentReady?.outputChannels ??
                0) === 2 || currentReady?.stereoFallback === true,
        };
    });
    ipcMain.handle("click-sounds:get", () => clickSoundSettings);
    ipcMain.handle("click-sounds:choose", async (_event, kind) => {
        if (kind !== "normal" && kind !== "accent")
            throw new Error("Unknown click sound");
        const result = await dialog.showOpenDialog(window, {
            title: kind === "accent"
                ? "Choose Accent Click Sound"
                : "Choose Normal Click Sound",
            properties: ["openFile"],
            filters: [{ name: "WAV audio", extensions: ["wav"] }],
        });
        if (result.canceled || !result.filePaths[0])
            return clickSoundSettings;
        const selectedPath = result.filePaths[0];
        await validateClickSound(selectedPath);
        clickSoundSettings = {
            ...clickSoundSettings,
            [kind === "normal" ? "normalPath" : "accentPath"]: selectedPath,
            updatedAt: new Date().toISOString(),
        };
        await saveClickSoundSettings(clickSoundSettingsPath, clickSoundSettings);
        return clickSoundSettings;
    });
    ipcMain.handle("click-sounds:reset", async () => {
        clickSoundSettings = {
            schemaVersion: 1,
            ...defaultClickSounds,
            updatedAt: new Date().toISOString(),
        };
        await saveClickSoundSettings(clickSoundSettingsPath, clickSoundSettings);
        return clickSoundSettings;
    });
    ipcMain.handle("click-sounds:preview", async (_event, kind) => {
        const path = kind === "accent"
            ? clickSoundSettings.accentPath
            : clickSoundSettings.normalPath;
        await validateClickSound(path);
        const bytes = await readFile(path);
        return `data:audio/wav;base64,${bytes.toString("base64")}`;
    });
    ipcMain.handle("reaper:preview", async () => {
        const chosen = await dialog.showOpenDialog(window, {
            title: "Import Reaper Arrangement",
            properties: ["openFile"],
            filters: [{ name: "Reaper projects", extensions: ["rpp"] }],
        });
        if (chosen.canceled || !chosen.filePaths[0])
            return null;
        pendingImport = await importReaperProject(chosen.filePaths[0], editorContext.preparedSong.song.id, editorContext.preparedSong);
        return pendingImport;
    });
    ipcMain.handle("reaper:commit", async (_event, action) => {
        if (action === "cancel") {
            pendingImport = null;
            return { cancelled: true };
        }
        if (!pendingImport)
            throw new Error("No Reaper import is awaiting confirmation");
        const arrangement = pendingImport.arrangement;
        if (String(arrangement.songId) !==
            String(editorContext.preparedSong.song.id))
            throw new Error("The selected song changed after the Reaper preview. Preview the import again for the current song.");
        if (!arrangement.selectedKey)
            throw new Error("The Reaper arrangement key could not be determined. Include the key in the RPP file or folder name before importing.");
        const prepared = await prepareArrangementCache(arrangement, join(projectRoot, ".playback-cache", "arrangements"));
        const arrangementDirectory = dirname(prepared.manifestPath);
        const stems = await renderArrangementTracks(prepared.arrangement, join(arrangementDirectory, "rendered-stems"), runtimeFfmpegPath);
        const selectedPadKey = padKey(arrangement.selectedKey);
        const confirmed = await confirmArrangement({
            arrangement: prepared.arrangement,
            stems,
            originalSong: editorContext.preparedSong.song,
            outputDirectory: join(arrangementDirectory, "performance"),
            cueDirectory: productionDefaults.cueFolder,
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            padPath: join(productionDefaults.padFolder, `Pad_${selectedPadKey}.wav`),
            ffmpegPath: runtimeFfmpegPath,
        });
        const savedPath = await saveArrangementVersion(join(projectRoot, ".playback-metadata"), arrangement);
        if (action === "replace") {
            await mkdir(join(projectRoot, ".playback-data"), { recursive: true });
            await writeFile(join(projectRoot, ".playback-data", "active-arrangement.json"), JSON.stringify({
                songId: arrangement.songId,
                arrangementId: arrangement.id,
                manifestPath: confirmed.manifestPath,
                selectedAt: new Date().toISOString(),
            }, null, 2));
        }
        pendingImport = null;
        return {
            savedPath,
            preparedManifestPath: confirmed.manifestPath,
            runtimeReady: true,
            action,
        };
    });
    ipcMain.handle("performance:get", () => performance.snapshot);
    ipcMain.handle("performance:export-song", async () => {
        const songIndex = performance?.snapshot.songIndex ?? selectedSongIndex;
        const activeSong = manifest.songs[songIndex];
        if (!activeSong || activeSong.song.id === EMPTY_SONG_ID)
            throw new Error("Select a confirmed song before exporting rehearsal audio");
        await mkdir(REHEARSAL_EXPORT_DIRECTORY, { recursive: true });
        const chosen = await dialog.showSaveDialog(window, {
            title: "Export Rehearsal Song",
            defaultPath: join(REHEARSAL_EXPORT_DIRECTORY, rehearsalExportFilename(activeSong, songIndex)),
            filters: [{ name: "WAV audio", extensions: ["wav"] }],
        });
        if (chosen.canceled || !chosen.filePath)
            return { cancelled: true };
        return exportRehearsalSong({
            song: activeSong,
            setName: manifest.name,
            songIndex,
            destinationPath: chosen.filePath,
            ffmpegPath: runtimeFfmpegPath,
        });
    });
    ipcMain.handle("set:get-song", async (_event, index) => performanceSongPayload(index));
    ipcMain.handle("set:select-song", async (_event, index) => {
        if (!Number.isInteger(index) || !manifest.songs[index])
            throw new Error("Song is outside the confirmed set");
        const result = await controlBus.dispatch({ type: "song.select", index }, "ui");
        if (!result.ok)
            throw new Error(result.error);
        return { ...(await performanceSongPayload(index)), state: result.state };
    });
    ipcMain.handle("performance:command", async (_event, value) => {
        if (value.action === "clear-fault") {
            currentReady = await armNativeSong(performance.snapshot.songIndex);
            await applyPreparedSongMixer(manifest.songs[performance.snapshot.songIndex]);
            nativeArmError = null;
            performance.setReadiness(await readinessFor(performance.snapshot.songIndex));
            performance.clearFault();
            controlBus.publishState();
            return performance.snapshot;
        }
        if (value.action === "transition") {
            const fromSongIndex = Number(value.fromSongIndex), outgoing = manifest.songs[fromSongIndex], incoming = manifest.songs[fromSongIndex + 1];
            if (!outgoing || !incoming)
                throw new Error("Transition must connect two loaded songs");
            const last = outgoing.regions.at(-1), first = incoming.regions[0], type = value.type, durationSeconds = transitionDuration(type, last ? last.endSeconds - last.startSeconds : 5, first ? first.endSeconds - first.startSeconds : 5, transitionSettings), plan = {
                fromSongIndex,
                toSongIndex: fromSongIndex + 1,
                type,
                durationSeconds,
                continuePad: value.continuePad !== false,
            };
            performance.setTransitionPlan(plan);
            const temporary = `${manifestPath}.${process.pid}.transition.tmp`;
            await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
            await rename(temporary, manifestPath);
            controlBus.publishState();
            return { ...performance.snapshot, transitionPlan: plan };
        }
        const result = await controlBus.dispatch(toPlaybackCommand(value), "ui");
        if (!result.ok)
            throw new Error(result.error);
        return result.state;
    });
    ipcMain.handle("control:get", async () => ({
        address: remoteAddress,
        token: controlSettings.token,
        lanEnabled: controlSettings.lanEnabled,
        oscEnabled: controlSettings.oscEnabled,
        urls: controlUrls(controlSettings, remoteAddress),
        state: controlBus.state(),
        midiInput: {
            devices: await listMidiInputs(),
            selected: selectedMidiInput,
            profile: controlSettings.footControllerProfile,
            enabled: currentReady?.midiInputEnabled === true,
        },
        gld: {
            ...controlSettings.gld,
            devices: await listMidiOutputs(),
            writesLocked: true,
        },
        proPresenterApi: controlSettings.proPresenterApi,
    }));
    ipcMain.handle("control:command", async (_event, command) => {
        const result = await controlBus.dispatch(command, "ui");
        if (!result.ok)
            throw new Error(result.error);
        return result;
    });
    ipcMain.handle("control:set-settings", async (_event, next) => {
        const updated = {
            ...controlSettings,
            lanEnabled: next.lanEnabled ?? controlSettings.lanEnabled,
            oscEnabled: next.oscEnabled ?? controlSettings.oscEnabled,
            proPresenterApi: next.proPresenterApi
                ? normalizeProPresenterApiSettings({ ...controlSettings.proPresenterApi, ...next.proPresenterApi })
                : controlSettings.proPresenterApi,
            updatedAt: new Date().toISOString(),
        };
        await writeControlSettings(updated);
        await remoteServer?.close();
        controlSettings = updated;
        remoteServer = new RemoteControlServer(controlBus, {
            token: controlSettings.token,
            host: controlSettings.lanEnabled ? "0.0.0.0" : "127.0.0.1",
            httpPort: controlSettings.httpPort,
            oscPort: controlSettings.oscPort,
            enableOsc: controlSettings.oscEnabled,
            oscTokenRequired: controlSettings.lanEnabled,
        });
        try {
            remoteAddress = await remoteServer.start();
        }
        catch (error) {
            console.error("Remote control adapter unavailable", error);
            remoteAddress = null;
        }
        return {
            ...updated,
            address: remoteAddress,
            urls: controlUrls(updated, remoteAddress),
        };
    });
    ipcMain.handle("control:set-midi-input", async (_event, next) => {
        const devices = await listMidiInputs();
        if (next.name !== null && !devices.includes(next.name))
            throw new Error("MIDI input is no longer available");
        if(gldRecall.config.transport==="midi"&&gldRecall.enabled()&&next.name!==gldFeedback.midiInputName)
            throw new Error("GLD two-way control reserves the MIDISPORT Uno input; turn off GLD-only levels before choosing another MIDI input");
        if (!(next.profile in FOOT_CONTROLLER_PROFILES))
            throw new Error("Unknown foot controller profile");
        selectedMidiInput = next.name;
        controlSettings.footControllerProfile = next.profile;
        await Promise.all([
            saveDeviceSettings(),
            writeControlSettings({
                ...controlSettings,
                updatedAt: new Date().toISOString(),
            }),
        ]);
        midiInputRouter = new MidiInputRouter(controlBus, FOOT_CONTROLLER_PROFILES[next.profile]);
        currentReady = await armNativeSong(performance.snapshot.songIndex);
        await applyPreparedSongMixer(manifest.songs[performance.snapshot.songIndex]);
        nativeArmError = null;
        performance.setReadiness(await readinessFor(performance.snapshot.songIndex, currentReady, null));
        return {
            selected: selectedMidiInput,
            profile: next.profile,
            enabled: currentReady.midiInputEnabled === true,
        };
    });
    ipcMain.handle("control:gld-preview", (_event, value) => new Gld112SafeClient({
        model: "GLD-112",
        host: "preview-only",
        port: 51325,
        midiChannel: value.midiChannel,
    }).preview(value.intent));
    ipcMain.handle("control:gld-test", async (_event, value) => {
        if (!Number.isInteger(value.midiChannel) ||
            value.midiChannel < 1 ||
            value.midiChannel > 16)
            throw new Error("GLD MIDI channel must be between 1 and 16");
        const outputs = await listMidiOutputs();
        if (!value.midiOutputName || !outputs.includes(value.midiOutputName))
            throw new Error("GLD MIDI output is not available");
        await testMidiOutput(value.midiOutputName);
        controlSettings.gld = {
            ...controlSettings.gld,
            midiOutputName: value.midiOutputName,
            midiChannel: value.midiChannel,
        };
        await writeControlSettings({
            ...controlSettings,
            updatedAt: new Date().toISOString(),
        });
        return {
            status: "connection-tested",
            selected: value.midiOutputName,
            midiChannel: value.midiChannel,
            writesLocked: true,
        };
    });
    ipcMain.handle("control:gld-send", async (_event, intent) => {
        if (!surfaceMixerMidiEnabled)
            throw new Error("Surface Mixer MIDI is off");
        if (!controlSettings.gld.writesEnabled)
            throw new Error("GLD writes are locked until the physical test/learn acceptance is approved");
        if (!controlSettings.gld.midiOutputName)
            throw new Error("GLD MIDI output is disabled");
        const preview = encodeGldIntent(intent, controlSettings.gld.midiChannel);
        await sendMidiBytes(controlSettings.gld.midiOutputName, preview.bytes);
        return {
            ...preview,
            output: controlSettings.gld.midiOutputName,
            midiChannel: controlSettings.gld.midiChannel,
        };
    });
    ipcMain.handle("editor:get", () => editor.map);
    ipcMain.handle("editor:command", (_event, command) => editor.execute(command));
    ipcMain.handle("editor:mixer-channel", async (_event, value) => {
        const index = Number(value?.index), gain = Number(value?.gain);
        if (!Number.isInteger(index) ||
            index < 0 ||
            index >= editorContext.preparedSong.stems.length)
            throw new Error("Editor mixer channel is outside the armed song");
        if (!Number.isFinite(gain) || gain < 0 || gain > 1.25)
            throw new Error("Editor mixer gain must be between 0 and 125%");
        const channels = [
            ...normalizeStemMix(editorContext.mixerChannels ??
                arrangementEditor.draft.stemMix ??
                editorContext.preparedSong.stemMix, editorContext.preparedSong.stems.length),
        ], current = channels[index], next = {
            ...current,
            index,
            gain,
            muted: Boolean(value.muted),
            solo: Boolean(value.solo),
            iem: current.iem,
        };
        channels[index] = next;
        editorContext.mixerChannels = channels;
        arrangementEditor.replace({
            ...arrangementEditor.draft,
            stemMix: channels,
            revision: arrangementEditor.draft.revision + 1,
        });
        operatorSetlist = {
            ...operatorSetlist,
            items: operatorSetlist.items.map((item) => !isMediaSetlistItem(item) &&
                resolve(item.manifestPath) === editorContext.sourceManifestPath &&
                item.songIndex === editorContext.songIndex
                ? { ...item, stemMix: channels }
                : item),
            updatedAt: new Date().toISOString(),
        };
        await saveOperatorSetlist(operatorSetlistPath, operatorSetlist);
        engine.setMixerChannel(index, next.gain, next.muted, next.solo, next.iem);
        return next;
    });
    ipcMain.handle("editor:undo", () => editor.undo());
    ipcMain.handle("editor:redo", () => editor.redo());
    ipcMain.handle("editor:save", async () => saveSongMap(mapRoot, editor.map));
    ipcMain.handle("editor:approve", async () => {
        const map = editor.execute({ type: "approve-map" });
        const saved = await saveSongMap(mapRoot, map);
        return { map, saved };
    });
    ipcMain.handle("editor:audition-cue", async (_event, cueId) => {
        const cue = editor.map.cues.find((item) => item.id === cueId);
        if (!cue)
            throw new Error("Cue not found");
        const bytes = await readFile(cue.audioPath);
        return `data:audio/wav;base64,${bytes.toString("base64")}`;
    });
    ipcMain.handle("arrange:get", () => arrangementEditor.draft);
    ipcMain.handle("arrange:workspace", workspaceState);
    const syncEngineCueTimes = (draft) => {
        for (const cue of draft.cues)
            engine.setCueTime(cue.targetRegionId, cue.atSeconds);
    };
    const syncEngineClickTemplate = async (draft) => {
        const source = editorContext.preparedSong;
        if (!source.liveAssets)
            return;
        const templateId = draft.clickTemplateId, previewSong = {
            ...source,
            liveAssets: {
                ...source.liveAssets,
                click: {
                    ...source.liveAssets.click,
                    templateId,
                    events: buildDynamicClickEvents(draft.selectedBpm, draft.timeSignature, source.durationSeconds, templateId),
                },
            },
        }, previewPath = join(projectRoot, ".playback-cache", "editor-preview", `${safeCacheName(String(source.song.id))}-click.json`);
        await mkdir(dirname(previewPath), { recursive: true });
        const temporary = `${previewPath}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({
            schemaVersion: 1,
            id: `editor-click-${source.song.id}`,
            name: `Editor Click - ${source.song.title}`,
            confirmedAt: new Date().toISOString(),
            songs: [previewSong],
            show: manifest.show ?? DEFAULT_SHOW_STATE,
        }, null, 2));
        await rename(temporary, previewPath);
        currentReady = await engine.selectManifest(previewPath, 0);
        syncEngineCueTimes(draft);
    };
    ipcMain.handle("arrange:command", async (_event, command) => {
        const previousTemplate = arrangementEditor.draft.clickTemplateId, draft = arrangementEditor.execute(command);
        if (draft.clickTemplateId !== previousTemplate)
            await syncEngineClickTemplate(draft);
        else
            syncEngineCueTimes(draft);
        return draft;
    });
    ipcMain.handle("arrange:undo", async () => {
        const previousTemplate = arrangementEditor.draft.clickTemplateId, draft = arrangementEditor.undo();
        if (draft.clickTemplateId !== previousTemplate)
            await syncEngineClickTemplate(draft);
        else
            syncEngineCueTimes(draft);
        return draft;
    });
    ipcMain.handle("arrange:redo", async () => {
        const previousTemplate = arrangementEditor.draft.clickTemplateId, draft = arrangementEditor.redo();
        if (draft.clickTemplateId !== previousTemplate)
            await syncEngineClickTemplate(draft);
        else
            syncEngineCueTimes(draft);
        return draft;
    });
    ipcMain.handle("arrange:save-draft", async () => {
        await saveArrangementDraft(editorContext.draftFile, arrangementEditor.draft);
        editorContext.savedDraft = arrangementEditor.draft;
        return workspaceState();
    });
    ipcMain.handle("arrange:revert", async () => {
        const restored = await loadArrangementDraft(editorContext.draftFile, editorContext.preparedSong.song.id);
        editorContext.savedDraft = restored
            ? reconcileArrangementDraftSource(restored, editorContext.baseArrangementDraft)
            : editorContext.baseArrangementDraft;
        arrangementEditor.replace(editorContext.savedDraft);
        syncEngineCueTimes(arrangementEditor.draft);
        return workspaceState();
    });
    ipcMain.handle("arrange:audition-cue", async (_event, cueId) => {
        const cue = arrangementEditor.draft.cues.find((item) => item.id === cueId);
        if (!cue)
            throw new Error("Cue not found");
        return cuePreviewData(cue.phrase, editorContext.preparedSong);
    });
    ipcMain.handle("arrange:save", async () => {
        const issues = validateArrangementDraft(arrangementEditor.draft);
        if (issues.length)
            throw new Error(`Arrangement is not ready: ${issues.join("; ")}`);
        const sourceSongFolder = await (async () => {
            try {
                const sourceManifest = JSON.parse(await readFile(editorContext.sourceManifestPath, "utf8"));
                if (typeof sourceManifest.review?.sourceFolder === "string")
                    return sourceManifest.review.sourceFolder;
                const catalogId = String(sourceManifest.review?.catalogId ??
                    editorContext.preparedSong.song.id), catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath);
                return (catalog.songs.find((song) => String(song.catalogId) === catalogId)
                    ?.folderPath ?? null);
            }
            catch {
                return null;
            }
        })();
        const result = await saveAppArrangement({
            draft: arrangementEditor.draft,
            source: editorContext.preparedSong,
            metadataRoot: join(projectRoot, ".playback-metadata"),
            cacheRoot: join(projectRoot, ".playback-cache"),
            sourceSongFolder,
            stemDisplayLabels: editorContext.stemDisplayLabels,
            clickRegularPath: clickSoundSettings.normalPath,
            clickAccentPath: clickSoundSettings.accentPath,
            ffmpegPath: runtimeFfmpegPath,
        });
        await saveArrangementDraft(editorContext.draftFile, arrangementEditor.draft);
        editorContext.savedDraft = arrangementEditor.draft;
        return result;
    });
    ipcMain.on("playback:command", (_event, command, value) => {
        if (!engine.isRunning)
            return;
        try {
            if(gldRecall.enabled() && ["play","pad_on"].includes(command))throw Error("Disable GLD-only levels while stopped before editor audition");
            if (command === "play")
                engine.play();
            else if (command === "pause")
                engine.pause();
            else if (command === "stop")
                engine.stop();
            else if (command === "seek" && typeof value === "number")
                engine.seek(value);
            else if (command === "pad_on")
                engine.padOn();
            else if (command === "pad_off")
                engine.padOff();
        }
        catch (error) {
            console.error("Playback command ignored because the audio engine is unavailable", error);
        }
    });
    await window.loadFile(join(codeRoot, "ui-dist", "index.html"));
    window.maximize();
    window.show();
    window.focus();
    if (process.env.PLAYBACK_E2E_SONG_SWITCH) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),cards=()=>[...document.querySelectorAll('#performanceSetSongs .set-song-card')];for(let i=0;i<300&&cards().length<2;i++)await wait(50);const original=cards().findIndex(card=>card.classList.contains('active')),target=original===0?1:0,beforeTitle=document.querySelector('#performanceSongTitle').textContent,marker='renderer-'+Math.random();window.__songSwitchMarker=marker;if(target<0||!cards()[target])throw Error('Confirmed set requires two songs for switch test');cards()[target].click();for(let i=0;i<100&&!cards()[target]?.classList.contains('active');i++)await wait(50);const switched={active:cards().findIndex(card=>card.classList.contains('active')),title:document.querySelector('#performanceSongTitle').textContent,regions:document.querySelectorAll('#regions .region').length,mixer:document.querySelectorAll('#mixerChannels .daw-channel').length,marker:window.__songSwitchMarker,waveWidth:document.querySelector('#wave').width};cards()[original].click();for(let i=0;i<100&&!cards()[original]?.classList.contains('active');i++)await wait(50);return{original,target,beforeTitle,...switched,restored:cards().findIndex(card=>card.classList.contains('active')),sameRenderer:window.__songSwitchMarker===marker};})()`);
        console.log(`SONG_SWITCH_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_CONTROL) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<200&&typeof document.querySelector('#remoteControl')?.onclick!=='function';i++)await new Promise(r=>setTimeout(r,50));document.querySelector('#remoteControl').click();for(let i=0;i<50&&!document.querySelector('#remoteSettings').open;i++)await new Promise(r=>setTimeout(r,50));document.querySelector('#previewGld').click();await new Promise(r=>setTimeout(r,50));const control=await window.playback.control.get(),base=new URL(control.urls[0]).origin,response=await fetch(base+'/api/command',{method:'POST',headers:{Authorization:'Bearer '+control.token,'Content-Type':'application/json'},body:JSON.stringify({type:'transport.stop'})}),command=await response.json();return{dialog:document.querySelector('#remoteSettings').open,status:document.querySelector('#remoteStatus').textContent,urlHasToken:document.querySelector('#remoteUrl').value.includes('token='),httpRemoteTab:[...document.querySelectorAll('[data-settings-tab]')].some(node=>node.textContent.includes('HTTP REMOTE')),httpQr:document.querySelector('#httpQrCanvas').width,address:control.address,lanEnabled:control.lanEnabled,oscEnabled:control.oscEnabled,regions:control.state.songs[0].regions.length,commandOk:command.ok,playing:command.state.playing,midiInputs:document.querySelector('#midiInputDevice').options.length-1,midiProfile:document.querySelector('#footControllerProfile').value,gldWritesLocked:control.gld.writesLocked,gldPreview:document.querySelector('#gldHex').textContent};})()`);
        console.log(`CONTROL_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_PREP) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();const update=await window.playback.prep.update();for(let i=0;i<100&&!document.querySelector('.add-song-card');i++)await wait(100);document.querySelector('.add-song-card').click();for(let i=0;i<300&&document.querySelectorAll('#songLibraryResults .library-choice').length<134;i++)await wait(100);const prep=await window.playback.prep.get();return{visible:!document.querySelector('#editorWorkspace').hidden,prepared:prep.prepared.length,catalog:document.querySelectorAll('#songLibraryResults .library-choice').length,summary:update.counts.ready+' ready · '+(update.counts['needs-review']??0)+' ready for review',setName:prep.setlist.name,confirmDisabled:prep.setlist.items.length===0};})()`);
        console.log(`PREP_WORKFLOW_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_SAVE_DIALOG) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();for(let i=0;i<100&&(document.querySelector('#draftState').textContent==='LOADING'||document.querySelector('#editorWorkspace').classList.contains('empty-selection'));i++)await wait(100);document.querySelector('#saveArrangementTop').click();for(let i=0;i<100&&!document.querySelector('#arrangementNameDialog').open;i++)await wait(50);const dialog=document.querySelector('#arrangementNameDialog'),workspace=await window.playback.arrange.workspace();return{open:dialog.open,name:document.querySelector('#newArrangementName').value,expected:workspace.originalFacts.title+' - '+workspace.draft.selectedKey+' - '+workspace.draft.selectedBpm+' BPM',createButton:!!document.querySelector('#editorCreateArrangement'),saveDisabled:document.querySelector('#saveArrangementTop').disabled};})()`);
        console.log(`ARRANGEMENT_SAVE_DIALOG_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_DRAFT_SAVE) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{await window.playback.arrange.command({type:'set-name',name:'Persistent Editor Draft Validation'});const saved=await window.playback.arrange.saveDraft();return{name:saved.draft.name,dirty:saved.dirty,revision:saved.draft.revision};})()`);
        console.log(`EDITOR_DRAFT_SAVE_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_DRAFT_RESTORE) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{const restored=await window.playback.arrange.workspace();return{name:restored.draft.name,dirty:restored.dirty,revision:restored.draft.revision,source:restored.source.name,readiness:restored.readiness.status};})()`);
        console.log(`EDITOR_DRAFT_RESTORE_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_EDITOR_SAVE) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{await window.playback.arrange.command({type:'set-name',name:'Cornerstone Editor Workspace Validation'});const before=await window.playback.arrange.workspace(),saved=await window.playback.arrange.save();return{beforeReadiness:before.readiness.status,name:saved.arrangement.name,id:saved.id,manifestPath:saved.manifestPath,regions:saved.arrangement.regions.length,key:saved.arrangement.selectedKey,bpm:saved.arrangement.selectedBpm};})()`);
        console.log(`EDITOR_RENDER_SAVE_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_EDITOR_LABELS) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();for(let i=0;i<100&&document.querySelector('#draftState').textContent==='LOADING';i++)await wait(100);document.querySelector('#stemsView').click();await wait(100);return{source:document.querySelector('#editorSource').textContent,labels:[...document.querySelectorAll('#stemLabelItems label')].map(label=>label.textContent),rows:document.querySelectorAll('.stem-row').length};})()`);
        console.log(`EDITOR_LABELS_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_EDITOR_MIXER) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();for(let i=0;i<100&&document.querySelector('#draftState').textContent==='LOADING';i++)await wait(100);document.querySelector('#stemsView').click();await wait(100);const strip=document.querySelector('#stemLabelItems .stem-console'),mute=strip.querySelector('[data-stem-switch="muted"]'),solo=strip.querySelector('[data-stem-switch="solo"]'),fader=strip.querySelector('[data-stem-fader]');mute.click();await wait(80);solo.click();await wait(80);fader.value='.42';fader.dispatchEvent(new Event('input',{bubbles:true}));await wait(150);const state=await window.playback.arrange.workspace(),channel=state.mixer.channels[0];return{rows:document.querySelectorAll('#stemLabelItems .stem-console').length,gain:channel.gain,muted:channel.muted,solo:channel.solo,muteActive:mute.classList.contains('active'),soloActive:solo.classList.contains('active')};})()`);
        console.log(`EDITOR_MIXER_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_EDITOR_RESIZE) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();for(let i=0;i<100&&document.querySelector('#draftState').textContent==='LOADING';i++)await wait(100);document.querySelector('#stemsView').click();await wait(100);const initialTimeline=document.querySelector('#editorTimeline').getBoundingClientRect(),initialRow=document.querySelector('.stem-row').getBoundingClientRect();document.querySelector('#widthUp').click();document.querySelector('#widthUp').click();document.querySelector('#heightUp').click();await wait(100);const timeline=document.querySelector('#editorTimeline').getBoundingClientRect(),row=document.querySelector('.stem-row').getBoundingClientRect(),label=document.querySelector('#stemLabelItems label').getBoundingClientRect(),canvas=document.querySelector('.stem-row canvas').getBoundingClientRect(),playhead=document.querySelector('#editorPlayhead').getBoundingClientRect(),controls=document.querySelector('#expandedSizeControls'),controlRect=controls.getBoundingClientRect();return{zoom:Number(document.querySelector('#editorZoom').value),initialWidth:initialTimeline.width,width:timeline.width,initialHeight:initialRow.height,height:row.height,labelHeight:label.height,canvasLeft:canvas.left,timelineLeft:timeline.left,playheadLeft:playhead.left,leftDelta:Math.abs(canvas.left-timeline.left),playheadDelta:Math.abs(playhead.left-timeline.left),controlsHidden:controls.hidden,controlsDisplay:getComputedStyle(controls).display,controlsRect:{left:controlRect.left,top:controlRect.top,width:controlRect.width,height:controlRect.height}};})()`);
        console.log(`EDITOR_RESIZE_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_EDITOR_ALIGNMENT) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();for(let i=0;i<100&&document.querySelector('#draftState').textContent==='LOADING';i++)await wait(100);document.querySelector('#stemsView').click();await wait(100);const timeline=document.querySelector('#editorTimeline').getBoundingClientRect(),canvas=document.querySelector('.stem-row canvas').getBoundingClientRect(),ruler=document.querySelector('#editorRuler').getBoundingClientRect(),playhead=document.querySelector('#editorPlayhead').getBoundingClientRect(),gutter=document.querySelector('#stemLabelGutter').getBoundingClientRect();return{stems:document.querySelectorAll('.stem-row').length,timelineLeft:timeline.left,canvasLeft:canvas.left,rulerLeft:ruler.left,playheadLeft:playhead.left,gutterRight:gutter.right,leftDelta:Math.abs(timeline.left-canvas.left),widthDelta:Math.abs(timeline.width-canvas.width),playheadDeltaAtZero:Math.abs(timeline.left-playhead.left)};})()`);
        console.log(`EDITOR_ALIGNMENT_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_MIXER) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));const first=document.querySelector('.daw-channel[data-mixer-index="0"]'),mute=first.querySelector('[data-mixer-switch="muted"]'),solo=first.querySelector('[data-mixer-switch="solo"]'),iem=first.querySelector('[data-mixer-switch="iem"]'),fader=first.querySelector('[data-mixer-fader]');mute.click();await wait(80);solo.click();await wait(80);iem.click();await wait(80);fader.value='.64';fader.dispatchEvent(new Event('input',{bubbles:true}));await wait(120);document.querySelector('#play').click();await wait(900);const state=await window.playback.performance.get();return{channels:document.querySelectorAll('.daw-channel:not(.master)').length,master:!!document.querySelector('.daw-channel.master'),labels:[...document.querySelectorAll('.daw-channel:not(.master) .channel-head strong')].map(x=>x.textContent),gain:state.mixer.channels[0].gain,muted:state.mixer.channels[0].muted,solo:state.mixer.channels[0].solo,iem:state.mixer.channels[0].iem,meterHeights:[...document.querySelectorAll('.meter-fill')].map(x=>x.style.height),iemStatus:document.querySelector('#mixerIemStatus').textContent};})()`);
        console.log(`MIXER_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_E2E_EDIT) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#editMode').click();for(let i=0;i<100&&document.querySelector('#draftState').textContent==='LOADING';i++)await wait(100);document.querySelector('#stemsView').click();await wait(100);const selector=document.querySelector('#arrangementSelect'),before=await window.playback.arrange.get(),target=before.sections[1],mid=(target.startSeconds+target.endSeconds)/2;await window.playback.arrange.command({type:'split-section',atSeconds:mid,newSectionId:'e2e-split'});await window.playback.arrange.command({type:'rename-section',sectionId:'e2e-split',name:'E2E Chorus'});await window.playback.arrange.command({type:'duplicate-section',sectionId:'e2e-split',newSectionId:'e2e-duplicate'});await window.playback.arrange.command({type:'move-section',sectionId:'e2e-duplicate',toIndex:0});await window.playback.arrange.command({type:'delete-section',sectionId:target.id});await window.playback.arrange.command({type:'set-key-tempo',key:'D',bpm:80});const after=await window.playback.arrange.workspace();await window.playback.arrange.undo();const undone=await window.playback.arrange.get();await window.playback.arrange.redo();const redone=await window.playback.arrange.get();return{editVisible:!document.querySelector('#editorWorkspace').hidden,modeLabel:document.querySelector('#modeLabel').textContent,selectedArrangement:selector.selectedOptions[0].textContent,arrangementOptions:[...selector.options].map(option=>option.textContent),summaryCanvas:!!document.querySelector('#summaryWaveform canvas'),expandedVisible:!document.querySelector('#stemWaveforms').hidden,stemRows:document.querySelectorAll('.stem-row').length,regionListRows:document.querySelectorAll('.region-list-item').length,source:document.querySelector('#editorSource').textContent,version:document.querySelector('#editorVersion').textContent,beforeSections:before.sections.length,afterSections:after.draft.sections.length,firstSection:after.draft.sections[0].id,editedName:after.draft.sections.find(x=>x.id==='e2e-split').name,key:after.draft.selectedKey,bpm:after.draft.selectedBpm,cueIntegrity:after.draft.cues.every(c=>after.draft.sections.find(s=>s.id===c.targetRegionId)?.name===c.phrase),midiEvents:after.draft.midi.length,readiness:after.readiness.status,checks:after.readiness.checks.length,dirty:after.dirty,undoRevision:undone.revision,redoRevision:redone.revision};})()`);
        console.log(`EDITOR_WORKSPACE_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_DEMO_PANIC) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
        void window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#play').click();await wait(3000);document.querySelector('#panic').click();await wait(2500);document.querySelector('.region:nth-child(3)').click();})()`);
    }
    if (process.env.PLAYBACK_E2E) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
        const result = await window.webContents.executeJavaScript(`(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms??120));const click=async selector=>{document.querySelector(selector).click();await wait();};const arrangement=document.querySelector('.arrangement-tools select').selectedOptions[0].textContent,arrangementOptions=[...document.querySelector('.arrangement-tools select').options].map(x=>x.textContent),importAvailable=!document.querySelector('.arrangement-tools button').disabled,initial=document.querySelector('#currentSection').textContent;await click('#nextSection');window.playback.command('seek',25.5);await wait(180);const next=document.querySelector('#currentSection').textContent;await click('#play');await wait(250);const beforePanic=document.querySelector('#clock').textContent;await click('#panic');await wait(350);const duringPanic=document.querySelector('#clock').textContent,panicVisible=!document.querySelector('#panicState').hidden,state=await window.playback.performance.get(),clickAlive=state.channels.click,padAlive=state.channels.pad;await click('.region:nth-child(3)');const recoveryArmed=document.querySelector('#panicState span').textContent;await wait(2200);const recovered=document.querySelector('#panicState').hidden,recoverySection=document.querySelector('#currentSection').textContent;return{ready:document.querySelector('#ready').textContent,arrangement,arrangementOptions,importAvailable,initial,next,beforePanic,duringPanic,panicVisible,clickAlive,padAlive,recoveryArmed,recovered,recoverySection};})()`);
        console.log(`PERFORMANCE_E2E ${JSON.stringify(result)}`);
        app.quit();
        return;
    }
    if (process.env.PLAYBACK_SCREENSHOT) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
        if (process.env.PLAYBACK_SCREENSHOT_MODE === "performance")
            await window.webContents.executeJavaScript("document.querySelector('#performanceMode').click()");
        if (process.env.PLAYBACK_SCREENSHOT_MODE === "edit")
            await window.webContents.executeJavaScript("(async()=>{document.querySelector('#editMode').click();for(let i=0;i<100&&document.querySelector('#draftState').textContent==='LOADING';i++)await new Promise(r=>setTimeout(r,100));})()");
        if (process.env.PLAYBACK_SCREENSHOT_MODE === "prep")
            await window.webContents.executeJavaScript("(async()=>{document.querySelector('#prepMode').click();for(let i=0;i<100&&!document.querySelectorAll('#preparedLibrary article').length;i++)await new Promise(r=>setTimeout(r,100));})()");
        if (process.env.PLAYBACK_SCREENSHOT_MODE === "remote")
            await window.webContents.executeJavaScript("document.querySelector('#remoteControl').click()");
        if (process.env.PLAYBACK_SCREENSHOT_MODE === "mixer")
            await window.webContents.executeJavaScript("(async()=>{window.playback.command('seek',20);await new Promise(r=>setTimeout(r,100));document.querySelector('#play').click();await new Promise(r=>setTimeout(r,900));})()");
        if (process.env.PLAYBACK_SCREENSHOT_VIEW === "stems")
            await window.webContents.executeJavaScript("document.querySelector('#stemsView').click()");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        const image = await window.webContents.capturePage();
        const screenshotPath = resolve(projectRoot, process.env.PLAYBACK_SCREENSHOT);
        await mkdir(resolve(screenshotPath, ".."), { recursive: true });
        await writeFile(screenshotPath, image.toPNG());
        app.quit();
    }
}
app
    .whenReady()
    .then(createWindow)
    .catch((error) => {
    console.error(error);
    app.quit();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
    if (statusTimer)
        clearInterval(statusTimer);
    engine.close();
    void remoteServer?.close();
});
function installWindowsMenu(target) {
    const rendererAction = (action) => () => {
        if (!target.isDestroyed() && !target.webContents.isDestroyed())
            target.webContents.send("windows:menu", action);
    };
    const template = [
        {
            label: "File",
            submenu: [
                {
                    label: "Settings",
                    accelerator: "CmdOrCtrl+,",
                    click: rendererAction("settings"),
                },
                { label: "Import Setlist", click: rendererAction("import-setlist") },
                { label: "Export Setlist", click: rendererAction("export-setlist") },
                { type: "separator" },
                {
                    label: "Import Reaper Arrangement",
                    accelerator: "CmdOrCtrl+I",
                    click: rendererAction("import-reaper"),
                },
                { type: "separator" },
                {
                    label: "Exit Playback V3",
                    accelerator: "Alt+F4",
                    click: () => app.quit(),
                },
            ],
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "selectAll" },
            ],
        },
        {
            label: "Playback",
            submenu: [
                {
                    label: "Play",
                    accelerator: "CmdOrCtrl+Enter",
                    click: rendererAction("play"),
                },
                { label: "Pause", click: rendererAction("pause") },
                {
                    label: "Stop",
                    accelerator: "CmdOrCtrl+.",
                    click: rendererAction("stop"),
                },
                { type: "separator" },
                {
                    label: "Performance Mode",
                    accelerator: "F5",
                    click: rendererAction("performance-mode"),
                },
                {
                    label: "Edit Mode",
                    accelerator: "F6",
                    click: rendererAction("edit-mode"),
                },
                { type: "separator" },
                { label: "Panic", accelerator: "F12", click: rendererAction("panic") },
            ],
        },
        {
            label: "View",
            submenu: [
                {
                    label: "Maximize / Restore",
                    click: () => target.isMaximized() ? target.unmaximize() : target.maximize(),
                },
                {
                    label: "Full Screen",
                    accelerator: "F11",
                    click: () => target.setFullScreen(!target.isFullScreen()),
                },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
            ],
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "About Playback V3",
                    click: () => void dialog.showMessageBox(target, {
                        type: "info",
                        title: "About Playback V3",
                        message: "Playback V3",
                        detail: `Version ${app.getVersion()}\nProduction playback, arrangement editing, and live control for Windows.`,
                        buttons: ["OK"],
                    }),
                },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    target.setMenuBarVisibility(true);
}
async function refreshAudioDeviceCache() {
    const devices = await listAudioDevices();
    if (!devices.length)
        return cachedAudioDevices;
    cachedAudioDevices = devices;
    selectedAudioDevice = reconcileAudioDevice(selectedAudioDevice, devices);
    return devices;
}
async function listMidiOutputs() {
    try {
        const stdout = await execFileText(enginePath, ["--list-midi"], 3000);
        return stdout
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean);
    }
    catch (error) {
        console.error("MIDI output scan failed", error);
        return [];
    }
}
async function listAudioDevices() {
    try {
        return parseAudioDeviceList(await execFileText(enginePath, ["--list-audio-devices"], 10000));
    }
    catch (error) {
        console.error("Audio device scan failed", error);
        return cachedAudioDevices;
    }
}
function sameAudioDevice(left, right) {
    return left.type === right.type && left.name === right.name;
}
async function listMidiInputs() {
    try {
        const stdout = await execFileText(enginePath, ["--list-midi-inputs"], 3000);
        return stdout
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean);
    }
    catch (error) {
        console.error("MIDI input scan failed", error);
        return [];
    }
}
async function saveDeviceSettings() {
    await mkdir(join(projectRoot, ".playback-data"), { recursive: true });
    await writeFile(join(projectRoot, ".playback-data", "device-settings.json"), JSON.stringify({
        midiOutputName: selectedMidiOutput,
        midiInputName: selectedMidiInput,
        audioDevice: selectedAudioDevice,
        globalBusRoutingProfile: PLAYBACK_OUTPUT_PROFILE,
        globalBusRouting,
        globalBusRoutingLocked,
        audioRouting: selectedAudioRouting,
        stereoRouting: selectedStereoRouting,
        updatedAt: new Date().toISOString(),
    }, null, 2));
}
async function loadTransitionSettings() {
    try {
        return normalizeSongTransitionSettings(JSON.parse(await readFile(join(projectRoot, ".playback-data", "transition-settings.json"), "utf8")));
    }
    catch {
        return normalizeSongTransitionSettings(null);
    }
}
async function saveTransitionSettings(settings) {
    await mkdir(join(projectRoot, ".playback-data"), { recursive: true });
    await writeFile(join(projectRoot, ".playback-data", "transition-settings.json"), JSON.stringify({ ...settings, updatedAt: new Date().toISOString() }, null, 2));
}
function defaultAudioRouting(stemCount, stemLabels = []) {
    return {
        stems: Array.from({ length: stemCount }, (_, index) => DEFAULT_INSTRUMENT_OUTPUTS[classifyStemOutput(stemLabels[index] ?? "")] ?? 12),
        stemChannels: Array.from({ length: stemCount }, () => 1),
        click: 1,
        clickChannels: 1,
        cue: 2,
        cueChannels: 1,
        pad: 4,
        padChannels: 1,
        iem: 3,
        iemChannels: 1,
    };
}
function stereoAudioRouting(stemCount) {
    return {
        stems: Array.from({ length: stemCount }, () => 1),
        stemChannels: Array.from({ length: stemCount }, () => 2),
        click: 1,
        clickChannels: 2,
        cue: 1,
        cueChannels: 2,
        pad: 1,
        padChannels: 2,
        iem: 0,
        iemChannels: 1,
    };
}
function normalizeAudioRouting(value) {
    return {
        stems: [...(value.stems ?? [])],
        stemChannels: [...(value.stemChannels ?? (value.stems ?? []).map(() => 1))],
        click: Number(value.click ?? 1),
        clickChannels: value.clickChannels === 2 ? 2 : 1,
        cue: Number(value.cue ?? 2),
        cueChannels: value.cueChannels === 2 ? 2 : 1,
        pad: Number(value.pad ?? 12),
        padChannels: value.padChannels === 2 ? 2 : 1,
        iem: Number(value.iem ?? 3),
        iemChannels: 1,
    };
}
function migrateLegacyRouting(routing) {
    return {
        ...routing,
        stems: routing.stems.map((output) => output === 7
            ? 7
            : output === 8
                ? 7
                : output === 9
                    ? 8
                    : output === 10
                        ? 9
                        : output === 11
                            ? 9
                            : output === 12
                                ? 10
                                : output === 13
                                    ? 11
                                    : output),
        stemChannels: routing.stemChannels.map(() => 1),
        click: routing.click === 19 ? 1 : routing.click,
        clickChannels: 1,
        cue: routing.cue === 20 ? 2 : routing.cue,
        cueChannels: 1,
        pad: routing.pad === 21 || routing.pad === 15 || routing.pad === 14
            ? 12
            : routing.pad,
        padChannels: 1,
        iem: routing.iem === 31 ? 3 : routing.iem,
        iemChannels: 1,
    };
}
function isTwoChannelDevice() {
    return (Number(selectedAudioDevice?.outputChannels ??
        selectedAudioDevice?.maxOutputChannels ??
        0) === 2);
}
function activeAudioRouting() {
    return ((isTwoChannelDevice() ? selectedStereoRouting : selectedAudioRouting) ??
        undefined);
}
function validateAudioRouting(routing, stemCount) {
    if (!routing ||
        !Array.isArray(routing.stems) ||
        routing.stems.length !== stemCount ||
        !Array.isArray(routing.stemChannels) ||
        routing.stemChannels.length !== stemCount)
        throw new Error("Routing must include every prepared stem");
    const validate = (label, start, width) => {
        if (!Number.isInteger(start) ||
            start < 0 ||
            start > 32 ||
            (width !== 1 && width !== 2) ||
            (start > 0 && start + width - 1 > 32))
            throw new Error(`${label} must be unassigned or routed within outputs 1-32`);
    };
    routing.stems.forEach((output, index) => validate(`Stem ${index + 1}`, output, routing.stemChannels[index]));
    validate("Click", routing.click, routing.clickChannels);
    validate("Cues", routing.cue, routing.cueChannels);
    validate("Pad", routing.pad, routing.padChannels);
    validate("IEM", routing.iem, routing.iemChannels);
}
function testMidiOutput(name) {
    return new Promise((resolveTest, reject) => execFile(enginePath, ["--test-midi-output", name], { windowsHide: true }, (error) => (error ? reject(error) : resolveTest())));
}
function sendMidiBytes(name, bytes) {
    return new Promise((resolveSend, reject) => execFile(enginePath, [
        "--send-midi-output",
        name,
        ...bytes.map((value) => value.toString(16).padStart(2, "0")),
    ], { windowsHide: true }, (error) => (error ? reject(error) : resolveSend())));
}
class ProPresenterApiSlideScheduler {
    state;
    fired = new Set();
    timer;
    lastSongIndex = null;
    lastPositionSeconds = 0;
    inFlight = false;
    cachedSong = null;
    cachedEvents = [];
    constructor(state) {
        this.state = state;
        this.timer = setInterval(() => void this.tick(), 75);
        this.timer.unref?.();
    }
    stop() {
        clearInterval(this.timer);
    }
    async tick() {
        if (this.inFlight)
            return;
        const state = this.state(), snapshot = state.performance;
        if (!snapshot?.playing ||
            !snapshot.slidesMidiEnabled ||
            !state.settings.enabled ||
            !state.syncedSetlist)
            return;
        const song = state.songs[snapshot.songIndex];
        if (!song || isMediaOnlySong(song))
            return;
        let searchFromSeconds = this.lastPositionSeconds, jumped = false;
        if (this.lastSongIndex !== snapshot.songIndex) {
            this.fired.clear();
            this.lastSongIndex = snapshot.songIndex;
            searchFromSeconds = Math.max(0, snapshot.positionSeconds - 0.2);
        }
        else if (snapshot.positionSeconds < this.lastPositionSeconds - 0.25) {
            this.fired.clear();
            searchFromSeconds = Math.max(0, snapshot.positionSeconds - 0.2);
        }
        else if (snapshot.positionSeconds > this.lastPositionSeconds + 1.5) {
            jumped = true;
            searchFromSeconds = Math.max(0, snapshot.positionSeconds - 0.2);
        }
        const events = this.slideEventsFor(song);
        this.lastPositionSeconds = snapshot.positionSeconds;
        if (!events.length)
            return;
        const searchToSeconds = snapshot.positionSeconds + (jumped ? 0.35 : 0.25), dueEvents = proPresenterDueSlideEvents(events, {
            fromSeconds: searchFromSeconds,
            toSeconds: searchToSeconds,
            firedKeys: this.fired,
        });
        if (!dueEvents.length)
            return;
        this.inFlight = true;
        try {
            for (const due of dueEvents) {
                this.fired.add(due.key);
                await triggerProPresenterApiSlide(state.settings, state.songs, snapshot.songIndex, due.event, state.syncedSetlist);
            }
        }
        finally {
            this.inFlight = false;
        }
    }
    slideEventsFor(song) {
        if (this.cachedSong !== song) {
            this.cachedSong = song;
            this.cachedEvents = proPresenterApiSlideEvents(song);
        }
        return this.cachedEvents;
    }
}
async function triggerProPresenterApiSlide(settings, songs, songIndex, event, syncedSetlist) {
    const playlistId = settings.playlistId ?? syncedSetlist.playlistId, apiIndex = syncedSetlist.songIndexes.get(songIndex) ??
        (settings.playlistId ? proPresenterApiSongIndex(songs, songIndex) : null);
    if (!playlistId || apiIndex === null)
        return;
    const cueIndex = proPresenterCueIndexFromMidiValue(event.data2), path = `/v1/playlist/${encodeURIComponent(playlistId)}/${apiIndex}/${cueIndex}/trigger`;
    try {
        await proPresenterTrigger(proPresenterApiBase(settings), path);
    }
    catch (error) {
        console.warn(`ProPresenter API slide trigger failed for song ${songIndex + 1}, slide ${event.data2}`, error);
    }
}
async function proPresenterTrigger(base, path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
        const response = await fetch(`${base}${path}`, {
            method: "GET",
            signal: controller.signal,
        });
        if (!response.ok)
            throw new Error(`${path} returned HTTP ${response.status}`);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function primeProPresenterApiSong(settings, songs, songIndex, syncedSetlist) {
    if (!settings.enabled)
        return;
    const playlistId = settings.playlistId ?? syncedSetlist?.playlistId ?? null;
    if (!playlistId)
        return;
    const apiIndex = syncedSetlist?.songIndexes.get(songIndex) ??
        (settings.playlistId ? proPresenterApiSongIndex(songs, songIndex) : null);
    if (apiIndex === null)
        return;
    const host = settings.host.trim() || DEFAULT_PROPRESENTER_API.host;
    const base = `http://${host}:${settings.port}`;
    const path = `/v1/playlist/${encodeURIComponent(playlistId)}/${apiIndex}/trigger`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetch(`${base}${path}`, { method: "GET", signal: controller.signal });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
    }
    catch (error) {
        console.warn(`ProPresenter API selection failed for song ${songIndex + 1}`, error);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function syncProPresenterApiSetlist(settings, manifest) {
    return syncProPresenterApiItems(settings, manifest.name, manifest.songs.map((song, index) => ({
        title: song.song.title,
        sourceIndex: index,
        mediaOnly: isMediaOnlySong(song),
    })));
}
async function syncProPresenterApiDraftSetlist(settings, setlist) {
    return syncProPresenterApiItems(settings, setlist.name, setlist.items.map((item, index) => ({
        title: item.title,
        sourceIndex: index,
        mediaOnly: isMediaSetlistItem(item),
    })), true);
}
async function syncProPresenterApiItems(settings, setName, sourceItems, reportErrors = false) {
    if (!settings.enabled)
        return null;
    try {
        const base = proPresenterApiBase(settings);
        const songs = sourceItems.filter((item) => !item.mediaOnly);
        if (!songs.length)
            return null;
        const library = await proPresenterLibraryPresentations(base);
        const used = new Set();
        const items = [];
        const songIndexes = new Map();
        let placeholders = 0;
        for (const song of songs) {
            const presentation = matchProPresenterPresentation(song.title, library, used);
            songIndexes.set(song.sourceIndex, items.length);
            if (!presentation) {
                placeholders += 1;
                items.push(proPresenterMissingSongPlaceholder(song.title, items.length));
                continue;
            }
            used.add(presentation.uuid);
            items.push({
                id: {
                    index: items.length,
                    name: presentation.name,
                    uuid: presentation.uuid,
                },
                type: "presentation",
                target_uuid: presentation.uuid,
                destination: "presentation",
                is_hidden: false,
                is_pco: false,
            });
        }
        const playlistId = settings.playlistId ??
            (await findOrCreateProPresenterPlaylist(base, settings.playlistName || setName));
        await proPresenterFetch(base, `/v1/playlist/${encodeURIComponent(playlistId)}`, {
            method: "PUT",
            body: JSON.stringify(items),
        });
        await proPresenterFetch(base, `/v1/playlist/${encodeURIComponent(playlistId)}/focus`);
        return { playlistId, songIndexes, placeholders };
    }
    catch (error) {
        console.warn("ProPresenter API setlist sync failed", error);
        if (reportErrors) throw error;
        return null;
    }
}
function proPresenterApiSongIndex(songs, songIndex) {
    if (!songs[songIndex] || isMediaOnlySong(songs[songIndex]))
        return null;
    let index = 0;
    for (let current = 0; current < songIndex; current++) {
        if (!isMediaOnlySong(songs[current]))
            index += 1;
    }
    return index;
}
function proPresenterMissingSongPlaceholder(title, index) {
    return {
        id: {
            index,
            name: `MISSING: ${title}`,
            uuid: null,
        },
        type: "header",
        target_uuid: null,
        destination: "presentation",
        header_color: {
            red: 0.95,
            green: 0.64,
            blue: 0.1,
            alpha: 1,
        },
        is_hidden: false,
        is_pco: false,
    };
}
function proPresenterApiBase(settings) {
    const host = settings.host.trim() || DEFAULT_PROPRESENTER_API.host;
    return `http://${host}:${settings.port}`;
}
async function proPresenterFetch(base, path, init = {}) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const response = await fetch(`${base}${path}`, {
            ...init,
            headers,
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.text()).trim().slice(0, 500);
            throw new Error(`${path} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        }
        if (response.status === 204)
            return undefined;
        return (await response.json());
    }
    finally {
        clearTimeout(timeout);
    }
}
async function proPresenterLibraryPresentations(base) {
    const libraries = await proPresenterFetch(base, "/v1/libraries");
    const presentations = [];
    for (const library of libraries) {
        const id = library.id?.uuid ||
            library.uuid ||
            library.id?.name ||
            library.name ||
            String(library.id?.index ?? library.index ?? "");
        if (!id)
            continue;
        const data = await proPresenterFetch(base, `/v1/library/${encodeURIComponent(id)}`);
        for (const item of data.items ?? [])
            if (item.uuid && item.name)
                presentations.push(item);
    }
    return presentations;
}
async function findOrCreateProPresenterPlaylist(base, name) {
    const playlists = flattenProPresenterPlaylists(await proPresenterFetch(base, "/v1/playlists"));
    const expectedName = normalizeProPresenterPlaylistName(name);
    const existing = playlists.find((playlist) => proPresenterPlaylistKind(playlist) === "playlist" &&
        normalizeProPresenterPlaylistName(playlist.id?.name ?? "") === expectedName);
    if (existing?.id)
        return existing.id.uuid || existing.id.name || String(existing.id.index);
    const created = await proPresenterFetch(base, "/v1/playlists", {
        method: "POST",
        body: JSON.stringify({ name, type: "playlist" }),
    });
    if (!created.id)
        throw new Error("ProPresenter did not return a playlist id");
    return created.id.uuid || created.id.name || String(created.id.index);
}
function normalizeProPresenterPlaylistName(value) {
    return value.trim().toLowerCase();
}
function flattenProPresenterPlaylists(items) {
    return items.flatMap((item) => [
        item,
        ...flattenProPresenterPlaylists(item.playlists ?? item.children ?? []),
    ]);
}
function proPresenterPlaylistKind(item) {
    return item.type ?? item.field_type ?? "";
}
function matchProPresenterPresentation(title, presentations, used) {
    const expectedTitles = proPresenterTitleCandidates(title);
    const available = presentations
        .filter((item) => !used.has(item.uuid))
        .map((item) => ({ item, title: normalizeProPresenterTitle(item.name) }));
    return (available.find(({ title: libraryTitle }) => expectedTitles.some((expected) => libraryTitle === expected))?.item ??
        available.find(({ title: libraryTitle }) => expectedTitles.some((expected) => expected.length >= 5 &&
            libraryTitle.length >= 5 &&
            (libraryTitle.includes(expected) || expected.includes(libraryTitle))))?.item ??
        null);
}
function proPresenterTitleCandidates(value) {
    const pieces = [
        value,
        value.split(/\s+-\s+|\s+–\s+|\s+—\s+/)[0] ?? value,
        value.replace(/\b(feat|featuring|ft)\.?\b.*$/i, ""),
    ];
    return [...new Set(pieces.map(normalizeProPresenterTitle).filter(Boolean))];
}
function normalizeProPresenterTitle(value) {
    return value
        .toLowerCase()
        .replace(/\([^)]*\)/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
function execFileText(file, args, timeoutMs) {
    return new Promise((resolveText, reject) => {
        const child = execFile(file, args, { windowsHide: true }, (error, stdout) => {
            clearTimeout(timer);
            error ? reject(error) : resolveText(stdout);
        });
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`${args.join(" ")} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
}
const DEFAULT_PROPRESENTER_API = {
    enabled: true,
    host: "127.0.0.1",
    port: 1025,
    playlistName: "Worship",
    playlistId: null,
};
async function loadOrCreateControlSettings() {
    const path = join(projectRoot, ".playback-data", "control-settings.json");
    try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (typeof value.token === "string" && value.token.length >= 16)
            return {
                token: value.token,
                httpPort: Number.isInteger(value.httpPort) ? value.httpPort : 38191,
                oscPort: Number.isInteger(value.oscPort) ? value.oscPort : 38192,
                lanEnabled: value.lanEnabled === true,
                oscEnabled: value.oscEnabled !== false,
                footControllerProfile: value.footControllerProfile === "basic-notes"
                    ? "basic-notes"
                    : "disabled",
                proPresenterApi: normalizeProPresenterApiSettings(value.proPresenterApi),
                gld: {
                    host: typeof value.gld?.host === "string" ? value.gld.host : "",
                    port: 51325,
                    midiChannel: Number.isInteger(value.gld?.midiChannel)
                        ? value.gld.midiChannel
                        : 1,
                    midiOutputName: typeof value.gld?.midiOutputName === "string"
                        ? value.gld.midiOutputName
                        : null,
                    writesEnabled: false,
                },
                updatedAt: typeof value.updatedAt === "string"
                    ? value.updatedAt
                    : new Date().toISOString(),
            };
    }
    catch { }
    const settings = {
        token: randomBytes(24).toString("base64url"),
        httpPort: 38191,
        oscPort: 38192,
        lanEnabled: false,
        oscEnabled: true,
        footControllerProfile: "disabled",
        proPresenterApi: DEFAULT_PROPRESENTER_API,
        gld: {
            host: "",
            port: 51325,
            midiChannel: 1,
            midiOutputName: null,
            writesEnabled: false,
        },
        updatedAt: new Date().toISOString(),
    };
    await writeControlSettings(settings);
    return settings;
}
function normalizeProPresenterApiSettings(value) {
    return {
        enabled: value?.enabled !== false,
        host: typeof value?.host === "string" && value.host.trim() ? value.host.trim() : DEFAULT_PROPRESENTER_API.host,
        port: Number.isInteger(value?.port) && value.port > 0 ? value.port : DEFAULT_PROPRESENTER_API.port,
        playlistName: typeof value?.playlistName === "string" && value.playlistName.trim()
            ? value.playlistName.trim()
            : DEFAULT_PROPRESENTER_API.playlistName,
        playlistId: typeof value?.playlistId === "string" && value.playlistId.trim() ? value.playlistId.trim() : null,
    };
}
async function writeControlSettings(settings) {
    await mkdir(join(projectRoot, ".playback-data"), { recursive: true });
    await writeFile(join(projectRoot, ".playback-data", "control-settings.json"), JSON.stringify(settings, null, 2));
}
function controlUrls(settings, address) {
    if (!address)
        return [];
    const hosts = settings.lanEnabled
        ? Object.values(networkInterfaces()).flatMap((items) => (items ?? [])
            .filter((item) => item.family === "IPv4" && !item.internal)
            .map((item) => item.address))
        : ["127.0.0.1"];
    return [...new Set(hosts)].map((host) => `http://${host}:${address.httpPort}/?token=${encodeURIComponent(settings.token)}`);
}
function toPlaybackCommand(value) {
    if (value.action === "play")
        return { type: "transport.play" };
    if (value.action === "pause")
        return { type: "transport.pause" };
    if (value.action === "stop")
        return { type: "transport.stop" };
    if (value.action === "panic")
        return { type: "panic.enter" };
    if (value.action === "recover")
        return { type: "panic.recover", regionId: value.regionId };
    if (value.action === "jump")
        return { type: "section.jump", regionId: value.regionId };
    if (value.action === "next-section")
        return { type: "section.next" };
    if (value.action === "previous-section")
        return { type: "section.previous" };
    if (value.action === "loop")
        return {
            type: "section.loop",
            regionId: value.regionId ?? performance.snapshot.currentRegionId ?? "",
        };
    if (value.action === "repeat-once")
        return {
            type: "section.repeat-once",
            regionId: value.regionId ?? performance.snapshot.currentRegionId ?? "",
        };
    if (value.action === "cue-next")
        return { type: "song.cue-next" };
    if (value.action === "bus")
        return { type: "bus.set", bus: value.bus, enabled: value.enabled };
    if (value.action === "gain")
        return { type: "bus.gain", bus: value.bus, gain: value.gain };
    if (value.action === "mixer-channel")
        return {
            type: "mixer.channel",
            index: value.index,
            gain: value.gain,
            muted: value.muted,
            solo: value.solo,
            iem: value.iem,
        };
    if (value.action === "mixer-master")
        return { type: "mixer.master", gain: value.gain };
    if (value.action === "slides-midi")
        return { type: "midi.slides", enabled: value.enabled };
    if (value.action === "surface-midi")
        return { type: "midi.surface", enabled: value.enabled };
    if (value.action === "song")
        return { type: "song.select", index: value.index };
    throw new Error("Unknown performance command");
}
async function listPreparedArrangements(active) {
    const result = [{ name: "Original Song", path: manifestPath }];
    for (const path of [
        ...(await localArrangementManifestPaths()),
        ...(await sourceArrangementManifestPaths()),
        ...(await sharedArrangementManifestPaths()),
    ]) {
        try {
            const prepared = JSON.parse(await readFile(path, "utf8"));
            if (prepared.songs?.[0]?.song?.id === active.songs[0]?.song.id)
                result.push({
                    name: prepared.songs?.[0]?.arrangement?.name ??
                        prepared.name ??
                        basename(dirname(dirname(path))),
                    path,
                });
        }
        catch { }
    }
    return result.filter((item, index, array) => array.findIndex((other) => other.path === item.path) === index);
}
async function allPreparedManifestPaths(setlist) {
    return [
        ...new Set([
            ...(setlist?.items ?? [])
                .filter((item) => !isMediaSetlistItem(item))
                .map((item) => resolve(item.manifestPath)),
            ...(await localArrangementManifestPaths()),
            ...(await sourceArrangementManifestPaths()),
            ...(await sharedArrangementManifestPaths()),
        ].filter(isPreparedManifestPath)),
    ];
}
async function ensureSetlistOriginalVersions(prepared, setlist, clickSoundSettings, ffmpegPath) {
    const setSongIds = [
        ...new Set(setlist.items
            .filter((item) => !isMediaSetlistItem(item))
            .map((item) => String(item.songId))),
    ];
    if (!setSongIds.length)
        return prepared;
    const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath).catch(error => { console.warn("Catalog unavailable; using prepared set songs", error); return { songs: [] }; }), next = [...prepared];
    const choiceKey = (choice) => [
        choice.songId,
        choice.arrangement,
        choice.key,
        choice.bpm,
        resolve(choice.manifestPath),
        choice.songIndex,
    ].join("\u0000");
    const seen = new Set(next.map(choiceKey));
    for (const songId of setSongIds) {
        const master = catalog.songs.find((song) => String(song.catalogId) === songId);
        if (!master)
            continue;
        try {
            const review = await prepareCandidateReview({
                catalogId: master.catalogId,
                master,
                sharedMetadataRoot: productionDefaults.sharedMetadataRoot,
                libraryRoot: productionDefaults.libraryRoot,
                cacheRoot: join(projectRoot, ".playback-cache", "library-review"),
                clickRegularPath: clickSoundSettings.normalPath,
                clickAccentPath: clickSoundSettings.accentPath,
                cueFolder: productionDefaults.cueFolder,
                padFolder: productionDefaults.padFolder,
                ffmpegPath,
            });
            for (const choice of await discoverPreparedLibrary([
                review.manifestPath,
            ])) {
                const key = choiceKey(choice);
                if (seen.has(key))
                    continue;
                next.push(choice);
                seen.add(key);
            }
        }
        catch (error) {
            console.warn(`Setlist versions unavailable for ${master.title}`, error);
        }
    }
    return next;
}
function preparedVersionRegistry(prepared) {
    const grouped = {};
    for (const choice of prepared) {
        const songId = String(choice.songId), displayIdentity = `${choice.arrangement}\u0000${choice.key}\u0000${choice.bpm}`;
        grouped[songId] ??= [];
        const existingIndex = grouped[songId].findIndex((existing) => `${existing.arrangement}\u0000${existing.key}\u0000${existing.bpm}` ===
            displayIdentity);
        if (existingIndex < 0)
            grouped[songId].push(choice);
        else if (preparedVersionSourcePriority(choice) <
            preparedVersionSourcePriority(grouped[songId][existingIndex]))
            grouped[songId][existingIndex] = choice;
    }
    for (const versions of Object.values(grouped))
        versions.sort((a, b) => (a.arrangement === "Original Song" ? 0 : 1) -
            (b.arrangement === "Original Song" ? 0 : 1) ||
            a.arrangement.localeCompare(b.arrangement) ||
            a.key.localeCompare(b.key) ||
            a.bpm - b.bpm ||
            a.manifestPath.localeCompare(b.manifestPath) ||
            a.songIndex - b.songIndex);
    return grouped;
}
function preparedVersionSourcePriority(choice) {
    const path = resolve(choice.manifestPath), libraryRoot = resolve(productionDefaults.libraryRoot), sharedRoot = resolve(productionDefaults.sharedMetadataRoot), cacheRoot = resolve(projectRoot, ".playback-cache");
    const libraryRel = relative(libraryRoot, path), sharedRel = relative(sharedRoot, path), cacheRel = relative(cacheRoot, path);
    if (choice.arrangement === "Original Song")
        return 0;
    if (libraryRel !== "" &&
        !libraryRel.startsWith("..") &&
        !isAbsolute(libraryRel))
        return 1;
    if (sharedRel !== "" && !sharedRel.startsWith("..") && !isAbsolute(sharedRel))
        return 2;
    if (cacheRel !== "" && !cacheRel.startsWith("..") && !isAbsolute(cacheRel))
        return 3;
    return 4;
}
async function exportOperatorSetlist(setlist) {
    if (!setlist.items.length)
        throw new Error("Add at least one song before exporting the setlist");
    await mkdir(SETLIST_EXPORT_DIRECTORY, { recursive: true });
    const date = new Date(), stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
    const path = join(SETLIST_EXPORT_DIRECTORY, `${safeSetlistFilename(setlist.name)}-${stamp}.playback-setlist.json`);
    const payload = {
        schema: "playback-v3-setlist-export/v1",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        setlist,
    };
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return path;
}
function parseExportedSetlist(value) {
    const setlist = value?.schema === "playback-v3-setlist-export/v1" ? value.setlist : value;
    if (setlist?.schemaVersion !== 1 ||
        !Array.isArray(setlist.items) ||
        typeof setlist.name !== "string")
        throw new Error("That file is not a Playback V3 setlist export");
    return setlist;
}
function relinkImportedSetlist(imported, prepared) {
    const items = imported.items.map((item) => {
        if (isMediaSetlistItem(item))
            return item;
        const match = prepared.find((choice) => String(choice.songId) === String(item.songId) &&
            choice.arrangement === item.arrangement) ??
            prepared.find((choice) => choice.title === item.title &&
                choice.arrangement === item.arrangement) ??
            prepared.find((choice) => String(choice.songId) === String(item.songId) &&
                choice.arrangement === "Original Song") ??
            prepared.find((choice) => choice.title === item.title &&
                choice.arrangement === "Original Song");
        if (!match)
            throw new Error(`${item.title} - ${item.arrangement} is not prepared on this computer. Update Metadata + Library or import that arrangement first.`);
        return {
            ...match,
            itemId: item.itemId,
            ...(item.transitionToNext
                ? { transitionToNext: item.transitionToNext }
                : {}),
            ...(item.stemMix ? { stemMix: item.stemMix } : {}),
        };
    });
    return {
        schemaVersion: 1,
        id: imported.id,
        name: imported.name,
        items,
        updatedAt: new Date().toISOString(),
    };
}
function safeSetlistFilename(value) {
    return ((value.trim() || "Sunday Set")
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
        .replace(/\s+/g, " ")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "Sunday Set");
}
async function pruneRuntimeDataForSetlist(setlist) {
    const cacheRoot = resolve(projectRoot, ".playback-cache"), dataRoot = resolve(projectRoot, ".playback-data"), allowedManifests = new Set(setlist.items
        .filter((item) => !isMediaSetlistItem(item))
        .map((item) => resolve(item.manifestPath).toLowerCase()));
    await mkdir(cacheRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    const activeManifest = await activeConfirmedManifestPath();
    if (activeManifest)
        allowedManifests.add(resolve(activeManifest).toLowerCase());
    await pruneEditorWaveforms(setlist);
    await rm(join(cacheRoot, "editor-preview"), { recursive: true, force: true });
    if (!setlist.items.length) {
        await rm(join(dataRoot, "selected-song.json"), { force: true });
        await rm(join(dataRoot, "active-arrangement.json"), { force: true });
    }
    await pruneManifestDirectory(join(cacheRoot, "library-review"), "confirmed-set.json", allowedManifests);
    await pruneManifestDirectory(join(cacheRoot, "arrangements"), join("performance", "confirmed-set.json"), allowedManifests);
    await pruneManifestDirectory(join(cacheRoot, "confirmed-sets"), "confirmed-set.json", allowedManifests);
}
async function activeConfirmedManifestPath() {
    try {
        const active = JSON.parse(await readFile(join(projectRoot, ".playback-data", "active-arrangement.json"), "utf8"));
        const activePath = resolve(String(active.manifestPath ?? ""));
        const parsed = JSON.parse(await readFile(activePath, "utf8"));
        if (parsed?.schemaVersion === 1 &&
            Array.isArray(parsed.songs) &&
            parsed.songs.length)
            return activePath;
    }
    catch { }
    return null;
}
async function pruneEditorWaveforms(setlist) {
    const root = join(projectRoot, ".playback-cache", "editor-waveforms"), allowed = new Set();
    for (const item of setlist.items) {
        if (isMediaSetlistItem(item))
            continue;
        try {
            const manifest = JSON.parse(await readFile(item.manifestPath, "utf8")), song = manifest.songs[item.songIndex];
            if (song?.cacheFingerprint)
                allowed.add(`${safeCacheName(song.cacheFingerprint)}.json`.toLowerCase());
        }
        catch { }
    }
    try {
        for (const entry of await readdir(root, { withFileTypes: true })) {
            if (!entry.isFile() || allowed.has(entry.name.toLowerCase()))
                continue;
            await rm(join(root, entry.name), { force: true });
        }
    }
    catch { }
}
async function localArrangementManifestPaths() {
    const root = join(projectRoot, ".playback-cache", "arrangements"), result = [];
    try {
        for (const entry of await readdir(root, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const path = join(root, entry.name, "performance", "confirmed-set.json");
            try {
                await readFile(path);
                result.push(path);
            }
            catch { }
        }
    }
    catch { }
    return result;
}
async function localReviewManifestPaths() {
    const result = [];
    await collectReviewManifests(join(projectRoot, ".playback-cache", "library-review"), result);
    return result;
}
async function sourceArrangementManifestPaths() {
    const result = [];
    try {
        const catalog = await importMasterCatalog(productionDefaults.masterWorkbookPath);
        for (const song of catalog.songs)
            await collectArrangementManifests(join(song.folderPath, "Arrangements"), result);
    }
    catch { }
    return result;
}
async function collectReviewManifests(root, result) {
    let entries = [];
    try {
        entries = await readdir(root, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory())
            await collectReviewManifests(path, result);
        else if (entry.isFile() &&
            entry.name.toLowerCase() === "confirmed-set.json")
            result.push(path);
    }
}
async function collectArrangementManifests(root, result) {
    let entries = [];
    try {
        entries = await readdir(root, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory())
            await collectArrangementManifests(path, result);
        else if (entry.isFile() &&
            entry.name.toLowerCase() === "confirmed-set.json" &&
            path.toLowerCase().includes("\\performance\\"))
            result.push(path);
    }
}
async function pruneManifestDirectory(root, suffix, allowedManifests) {
    const resolvedRoot = resolve(root), cacheRoot = resolve(projectRoot, ".playback-cache"), rel = relative(cacheRoot, resolvedRoot);
    if (rel.startsWith("..") || isAbsolute(rel))
        return;
    try {
        for (const entry of await readdir(resolvedRoot, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const directory = join(resolvedRoot, entry.name), manifest = resolve(directory, suffix);
            if (allowedManifests.has(manifest.toLowerCase()))
                continue;
            await rm(directory, { recursive: true, force: true });
        }
    }
    catch { }
}
function sendToRenderer(channel, payload) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed())
        return;
    window.webContents.send(channel, payload);
}
function safeCacheName(value) {
    const normalized = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "song";
    return normalized.length <= 72
        ? normalized
        : `${normalized.slice(0, 32)}-${normalized.slice(-32)}`;
}
async function sharedArrangementManifestPaths() {
    const root = join(productionDefaults.sharedMetadataRoot, "app-arrangements"), result = [];
    async function walk(directory) {
        let entries = [];
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory())
                await walk(path);
            else if (entry.isFile() &&
                entry.name.toLowerCase() === "confirmed-set.json" &&
                path.toLowerCase().includes("\\performance\\"))
                result.push(path);
        }
    }
    await walk(root);
    return result;
}
function isPreparedManifestPath(path) {
    const resolved = resolve(path), cacheRoot = resolve(projectRoot, ".playback-cache"), sharedRoot = resolve(productionDefaults.sharedMetadataRoot), libraryRoot = resolve(productionDefaults.libraryRoot), cacheRel = relative(cacheRoot, resolved), sharedRel = relative(sharedRoot, resolved), libraryRel = relative(libraryRoot, resolved), insideCache = cacheRel !== "" && !cacheRel.startsWith("..") && !isAbsolute(cacheRel), insideShared = sharedRel !== "" && !sharedRel.startsWith("..") && !isAbsolute(sharedRel), insideLibrary = libraryRel !== "" &&
        !libraryRel.startsWith("..") &&
        !isAbsolute(libraryRel) &&
        resolved.toLowerCase().includes("\\arrangements\\");
    return ((insideCache || insideShared || insideLibrary) &&
        resolved.toLowerCase().endsWith("confirmed-set.json"));
}
function padKey(key) {
    const aliases = {
        "C#": "Db",
        "D#": "Eb",
        "F#": "Gb",
        "G#": "Ab",
        "A#": "Bb",
    }, tonalCenter = key.replace(/m$/i, "");
    return aliases[tonalCenter] ?? tonalCenter;
}
async function cuePreviewData(label, song) {
    const spokenLabel = normalizeCueFileLabel(label)
        .replace(/\s+\d+$/, "")
        .trim(), existing = song.liveAssets?.cues?.find((cue) => normalizeCueFileLabel(cue.label)
        .replace(/\s+\d+$/, "")
        .trim() === spokenLabel || cue.label === label)?.audioPath;
    if (existing)
        return `data:audio/wav;base64,${(await readFile(existing)).toString("base64")}`;
    const aliases = {
        START: "CountIn.wav",
        "A CAPELLA": "ACAPPELLA.wav",
        ACAPELLA: "ACAPPELLA.wav",
    }, names = [
        aliases[spokenLabel.toUpperCase()] ?? `${spokenLabel.toUpperCase()}.wav`,
        `${spokenLabel.toUpperCase().replace(/\s+/g, "")}.wav`,
    ];
    for (const name of names) {
        const path = join(productionDefaults.cueFolder, name);
        try {
            return `data:audio/wav;base64,${(await readFile(path)).toString("base64")}`;
        }
        catch { }
    }
    throw new Error(`No cue audio for ${label}`);
}
function normalizeCueFileLabel(label) {
    return label
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z])([0-9])$/, "$1 $2")
        .replace(/^Turn\s*Arround/i, "Turn Around")
        .replace(/^Turnaround/i, "Turn Around")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ");
}
//# sourceMappingURL=main.js.map

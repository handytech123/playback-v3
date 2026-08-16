import "./style.css";
import "./mode.css";
import { buildZeroBasedGrid, positionToGridBeats, secondsToMusicalPosition } from "../domain/grid.js";
import { keyboardAction } from "../live/performance-session.js";
import { snapEditorPosition, type EditorSnapMode } from "../edit/editor-snap.js";
import type { SongTransitionType } from "../live/song-transition.js";
import { PLAYBACK_OUTPUTS } from "../audio/output-layout.js";
import QRCode from "qrcode";
import { createOscConnectionUri } from "../control/osc-profile.js";
import { compatibleClickTemplates } from "../domain/click-templates.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
<main>
  <nav>
    <div class="modes"><button id="prepMode" hidden>PREP / SETLIST</button><button id="editMode">EDIT / ARRANGE</button><button id="performanceMode" class="active">PERFORMANCE</button></div>
    <div class="arrangement-tools"><button id="slidesMidi" class="slides-midi-toggle">PRO-PRESENTER OFF</button><button id="surfaceMidi" class="surface-midi-toggle">SURFACE MIXER OFF</button><button id="remoteControl" class="settings-menu-button" title="Playback settings">⚙ SETTINGS</button></div>
    <div class="setlist" hidden><button id="previousSong">‹</button><span>SET 01</span><strong>Loading…</strong><small>Original Song</small><button id="nextSong">›</button></div>
  </nav>
  <header class="app-heading"><div><span id="modeLabel" class="eyebrow">PERFORMANCE MODE · CONFIRMED SET</span><h1 id="title">Loading…</h1><p id="facts"></p></div><section class="transport"><div class="transport-buttons"><button id="stop" aria-label="Stop">■</button><button id="play" class="primary" aria-label="Play">▶</button><button id="pause" aria-label="Pause">Ⅱ</button><button id="pad">PAD</button><button id="panic" class="panic">PANIC</button></div><div class="transport-clock"><span>ELAPSED / REMAINING</span><strong id="clock">0:00.000 / -0:00.000</strong><small id="position">1.1</small></div></section><button id="ready" class="ready">ARMING</button></header>
  <section id="prepWorkspace" class="prep-workspace" hidden>
    <div class="prep-toolbar"><div><span class="eyebrow">LIBRARY / PREPARATION LANE</span><h2>Build The Confirmed Set</h2><p>Choose prepared versions, order the set, then freeze one isolated performance package. Library maintenance is in Settings.</p></div></div>
    <div class="prep-summary" id="librarySummary"><span>Use Settings → Library / Analysis to update metadata and library content.</span></div>
    <div class="prep-columns">
      <section class="prep-panel"><header><div><h2>Prepared Songs</h2><small>Only performance-ready versions can enter the set.</small></div></header><div id="preparedLibrary" class="prepared-library"></div></section>
      <section class="prep-panel set-builder"><header><label>Set Name<input id="setlistName" value="Sunday Set"></label><button id="clearSetlist">CLEAR</button></header><div id="setlistItems" class="setlist-items"></div><footer><span id="setlistStatus">Draft saves automatically.</span><button id="confirmSet" class="primary">CONFIRM SET + LOAD</button></footer></section>
    </div>
    <section class="prep-panel catalog-panel"><header><div><h2>Master Library</h2><small>Spreadsheet facts remain authoritative. Rows needing analysis cannot enter Performance.</small></div><input id="libraryFilter" placeholder="Filter title, artist, vendor…"></header><div id="catalogRows" class="catalog-rows"><p>Run Scan Master Library to inspect all catalog songs.</p></div></section>
  </section>
  <section id="performanceWorkspace" class="workspace performance-workspace">
    <section class="performance-set-deck" aria-label="Confirmed set"><div class="set-deck-label"><span>CONFIRMED SET</span><strong id="performanceSetName">Sunday Set</strong></div><div id="performanceSetSongs" class="performance-set-songs"></div></section>
    <section class="performance-now-deck">
      <article class="performance-now-song"><span>NOW PLAYING</span><strong id="performanceSongTitle">Loading…</strong><small id="performanceArrangement">Original Song</small></article>
      <article class="performance-now-section"><span>CURRENT SECTION</span><strong id="currentSection">—</strong><small id="upNextSection">NEXT · —</small></article>
      <article id="performanceActionCard" class="performance-action-card"><span>LIVE ACTION</span><strong id="performanceAction">FOLLOW TIMELINE</strong><small id="performanceActionDetail">No transition is armed</small></article>
    </section>
    <div class="timeline" id="performanceTimeline"><div id="ruler" class="ruler"></div><div id="currentRegionShade" class="performance-current-region-shade"></div><canvas id="wave"></canvas><canvas id="waveProgress" class="wave-progress"></canvas><div id="performanceBoundaryLines" class="performance-boundary-lines"></div><div id="cueMarkers" class="cue-markers"></div><div id="regions" class="regions"></div><div id="playhead" class="playhead"></div></div>
  </section>
  <section id="editorWorkspace" class="editor-workspace" hidden>
    <section class="editor-set-deck set-card-deck" aria-label="Songs in confirmed set"><div class="set-deck-label"><span>EDIT SET</span><strong id="editorSetName">Sunday Set</strong></div><div id="editorSetSongs" class="performance-set-songs"></div></section>
    <section class="editor-setlist-toolbar"><label>SET NAME<input id="editorSetlistName" value="Sunday Set"></label><span id="editorSetlistStatus">Loading draft set…</span><button id="editorImportSetlist">IMPORT SET</button><button id="editorExportSetlist">EXPORT SET</button><button id="editorClearSetlist" class="danger">CLEAR SET</button></section><div id="confirmSetProgress" class="confirm-set-progress" hidden><div><strong>CONFIRMING SET</strong><span id="confirmSetProgressLabel">Preparing isolated performance cache…</span><b id="confirmSetProgressPercent">0%</b></div><progress id="confirmSetProgressBar" max="100" value="0"></progress></div><div id="editorLoadStatus" class="editor-load-status" hidden><i><b id="editorLoadPercent">0%</b></i><span><strong>LOADING SONG</strong><small id="editorLoadLabel">Preparing editor…</small></span><progress id="editorLoadProgress" max="100" value="0"></progress></div>
    <section id="editorSongVersions" class="editor-song-versions" hidden><div><span>SELECTED SONG</span><strong id="selectedSetSong">—</strong></div><label>ARRANGEMENT<select id="editorArrangementVersion" hidden></select><div class="version-menu"><button id="editorArrangementVersionButton" type="button">Select arrangement</button><div id="editorArrangementVersionMenu" class="version-menu-options" hidden></div></div></label></section>
    <section id="editorEmptySelection" class="editor-empty-selection" hidden><strong>NO SONG LOADED</strong><span>Select + ADD SONG to load an Original Song or arrangement into this set card.</span></section>
    <div class="editor-topbar">
      <div class="editor-info-row">
      <div><span class="eyebrow">ARRANGEMENT NAME</span><strong id="editorSelectedArrangementName">Loading…</strong><small id="editorVersion" hidden></small><span id="editorSource" hidden></span></div>
      <label class="editor-top-field">KEY<select id="arrangementKey"><option>C</option><option>Db</option><option>D</option><option>Eb</option><option>E</option><option>F</option><option>Gb</option><option>G</option><option>Ab</option><option>A</option><option>Bb</option><option>B</option><option>Cm</option><option>Dbm</option><option>Dm</option><option>Ebm</option><option>Em</option><option>Fm</option><option>Gbm</option><option>Gm</option><option>Abm</option><option>Am</option><option>Bbm</option><option>Bm</option></select></label>
      <label class="editor-top-field">BPM<input id="arrangementBpm" type="number" min="1" step=".01"></label>
      <label class="editor-top-field">CLICK TEMPLATE<select id="arrangementClickTemplate"></select></label>
      <span class="editor-top-fact"><small>ORIGINAL</small><strong id="originalFacts"></strong></span>
      <span class="editor-top-fact"><small>TIME / DURATION</small><strong id="arrangementDuration"></strong></span>
      <span id="draftState" class="draft-state">LOADING</span>
      <button id="saveArrangementTop" class="save-arrangement-top">SAVE ARRANGEMENT</button>
      </div>
      <div class="editor-view-row">
        <div class="view-toggle"><button id="summaryView" class="active">SUMMARY</button><button id="stemsView">EXPANDED STEMS</button></div>
        <label class="zoom-control">ZOOM <input id="editorZoom" type="range" min="1" max="12" step=".5" value="1"><output id="editorZoomValue">1x</output></label>
        <div id="editorSnap" class="transport-snap" hidden><span>SNAP</span><button data-snap="beat">BEAT</button><button data-snap="measure">MEASURE</button></div>
      </div>
    </div>
    <div class="editor-grid">
      <aside class="region-browser"><button id="toggleRegionBrowser" class="panel-collapse-toggle" title="Show or hide Arrangement Order">ORDER</button><header><div><h2>ARRANGEMENT ORDER</h2><small>DRAG REGIONS TO REORDER</small></div><button id="newRegion">+ FROM SELECTION</button></header><div id="regionList"></div></aside>
      <section class="editor-stage">
        <div class="editor-timeline-shell"><div id="stemLabelGutter" class="stem-label-gutter" hidden><div id="stemLabelItems"></div></div><div id="editorTimelineScroll" class="editor-timeline-scroll"><div id="editorTimeline" class="editor-timeline">
          <div id="editorGridLines" class="editor-grid-lines"></div><div id="editorBoundaryLines" class="editor-boundary-lines"></div><div id="editorRuler" class="editor-ruler"></div><div id="editorCueLane" class="marker-lane cue-lane"><span>CUES</span></div><div id="editorMidiLane" class="marker-lane midi-lane"><span>SLIDES</span></div><div id="editorRegionLane" class="editor-region-lane"></div>
          <div id="summaryWaveform" class="summary-waveform"><canvas></canvas></div><div id="stemWaveforms" class="stem-waveforms" hidden></div>
          <div id="editorSelection" class="editor-selection" hidden></div><div id="editorPlayhead" class="playhead"></div>
        </div></div></div>
        <div id="summaryStemMixer" class="summary-stem-mixer"></div>
        <div class="editor-selection-readout"><strong id="playheadLocation">1.1</strong><span id="selectionLocation">Drag in the waveform to create a grid-aligned selection.</span></div><div id="expandedSizeControls" class="editor-corner-controls" hidden><span class="width-adjust"><b>WIDTH</b><button id="widthDown" title="Decrease timeline width">−</button><button id="widthUp" title="Increase timeline width">+</button></span><span class="height-adjust"><b>HEIGHT</b><button id="heightDown" title="Decrease stem height">−</button><button id="heightUp" title="Increase stem height">+</button></span></div>
      </section>
      <aside class="editor-inspector"><button id="toggleEditorInspector" class="panel-collapse-toggle" title="Show or hide Selected Region">REGION</button>
        <section><h2>Selected Region</h2><label>Name<input id="sectionName"></label><div class="field-pair grid-position-fields"><label>Start · Measure.Beat<input id="sectionStart" inputmode="decimal" placeholder="1.1"></label><label>End · Measure.Beat<input id="sectionEnd" inputmode="decimal" placeholder="2.1"></label></div><p id="sectionSource"></p><div class="button-grid"><button id="selectPrevious">SELECT ←</button><button id="selectNext">SELECT →</button><button id="moveEarlier">MOVE ←</button><button id="moveLater">MOVE →</button><button id="duplicateRegion">DUPLICATE</button><button id="splitRegion">SPLIT AT PLAYHEAD</button><button id="deleteRegion" class="danger">REMOVE + CLOSE GAP</button><button id="auditionRegion">AUDITION SOURCE</button><button id="loopAudition">LOOP SOURCE</button><button id="auditionBoundary">AUDITION BOUNDARY</button><button id="trimStart">TRIM START HERE</button><button id="trimEnd">TRIM END HERE</button></div></section>
        <section><h2>Destination Cue</h2><label class="check"><input id="cueEnabled" type="checkbox"> Enabled</label><label>Destination<select id="cueTarget"></select></label><label>Cue At · Measure.Beat<input id="cuePosition" inputmode="decimal" placeholder="1.1"></label><button id="auditionArrangementCue">AUDITION CUE</button><p id="cueDetail"></p></section>
        <section><h2>Slides MIDI</h2><div id="midiEvents" class="midi-events"></div></section>
        <section><h2>Readiness</h2><div id="readinessSummary"></div><div id="readinessChecks"></div></section>
        <section class="editor-actions"><div class="button-grid"><button id="arrangementUndo">UNDO</button><button id="arrangementRedo">REDO</button><button id="saveDraft">SAVE DRAFT</button><button id="revertDraft">REVERT</button></div><button id="saveArrangement" class="save-arrangement">SAVE ARRANGEMENT VERSION</button><p id="editorStatus">Original Song remains unchanged.</p></section>
      </aside>
    </div>
  </section>
  <section id="liveControls">
    <div class="live-section"><button id="previousSection">← PREVIOUS</button><button id="repeatOnce">REPEAT ONCE</button><button id="loopSection">LOOP</button><button id="nextSection">NEXT →</button><button id="cueNextSong">CUE NEXT SONG</button></div>
    <p id="jumpState" hidden><strong>JUMP ARMED</strong><span></span></p><p id="panicState" hidden><strong>MUSICAL RECOVERY</strong><span></span></p><p id="liveFault" hidden><span></span><button id="clearFault">CLEAR FAULT</button></p>
  </section>
  <section id="performanceMixer" class="daw-mixer" aria-label="Live mixer"><div id="mixerResizeHandle" class="mixer-resize-handle" title="Drag to resize mixer"></div><header><div><span>LIVE MIXER</span><strong id="mixerIemStatus">IEM SEND CHECKING</strong></div><button id="mixerCollapse" aria-expanded="true">COLLAPSE</button></header><div id="mixerChannels" class="mixer-channels"></div></section>
</main>
<dialog id="reaperImport"><h2>Reaper Arrangement Import</h2><div id="importStatus" class="import-status idle"><strong>WAITING</strong><span>Choose a Reaper project to preview.</span><progress max="100" value="0"></progress></div><div id="importSummary"></div><div id="importDifferences"></div><p id="importWarning"></p><footer><button data-action="cancel">CANCEL</button><button data-action="replace">REPLACE SELECTED ARRANGEMENT</button><button data-action="new" class="primary">IMPORT AS NEW VERSION</button></footer></dialog>
<dialog id="arrangementNameDialog" class="arrangement-name-dialog"><form method="dialog"><span class="eyebrow">SAVE ARRANGEMENT</span><h2>Verify Arrangement Name</h2><p>This saves your current edits as a new non-destructive arrangement and adds it to the arrangement list.</p><div id="saveArrangementStatus" class="import-status idle"><strong>WAITING</strong><span>Verify the name, then save the arrangement.</span><progress max="100" value="0"></progress></div><label>Arrangement Name<input id="newArrangementName" autocomplete="off"></label><footer><button value="cancel">CANCEL</button><button id="confirmNewArrangement" value="default" class="primary">SAVE ARRANGEMENT</button></footer></form></dialog>
<dialog id="performanceReadiness"><header><div><span class="eyebrow">PRODUCTION PERFORMANCE READINESS</span><h2 id="performanceReadinessTitle">Checking…</h2></div><button id="closePerformanceReadiness">CLOSE</button></header><div id="performanceReadinessChecks"></div></dialog>
<dialog id="songLibraryPicker" class="song-library-picker"><header><div><span class="eyebrow">ORIGINAL SONGS</span><h2>Master Song Library</h2></div><button id="closeSongLibrary">CLOSE</button></header><div class="song-library-filters"><label>SEARCH BY NAME<input id="songLibrarySearch" type="search" placeholder="Song title or artist…"></label><label>SPEED<select id="songLibrarySpeed"><option value="all">All tempos</option><option value="slow">Slow · 80 BPM or less</option><option value="medium">Medium · 81–110 BPM</option><option value="fast">Fast · 111 BPM or more</option></select></label></div><div id="songLibraryResults" class="song-library-results"></div></dialog>
<dialog id="remoteSettings" class="settings-window"><header><div><span class="eyebrow">PLAYBACK V3</span><h2>Settings</h2><p id="settingsStatus">Configure the production system without crowding the performance surface.</p></div><button id="closeRemoteSettings">CLOSE</button></header><nav class="settings-tabs" aria-label="Settings sections"><button class="active" data-settings-tab="audio">AUDIO</button><button data-settings-tab="import">LIBRARY / ANALYSIS</button><button data-settings-tab="control">HTTP REMOTE / OSC</button><button data-settings-tab="transitions">TRANSITIONS</button><button data-settings-tab="midi">MIDI</button><button data-settings-tab="system">SYSTEM CHECK</button></nav><div class="settings-pages">
  <section class="settings-page active" data-settings-page="audio"><div class="settings-section-heading"><span>AUDIO ENGINE</span><h3>Device, routing, and output health</h3></div><div class="settings-grid"><label>Audio Device<select id="audioSelect" title="Audio output"></select></label><label>Active Outputs<select id="audioOutputCount" title="Number of active output channels"></select></label><div class="settings-readout"><span>Routing</span><strong id="routeStatus"></strong></div><div class="settings-readout"><span>IEM Outputs</span><strong id="settingsIemStatus">—</strong></div><button id="refreshAudioSettings">REFRESH DEVICE STATUS</button><button id="runAudioCheck">RUN AUDIO ERROR CHECK</button><div class="settings-section-heading settings-wide"><span>CLICK SOUNDS</span><h3>Choose the two WAV sounds used by every dynamic click pattern</h3></div><div class="click-sound-row settings-wide"><label><span>NORMAL CLICK</span><input id="normalClickPath" readonly></label><button id="chooseNormalClick">CHOOSE WAV</button><button id="previewNormalClick">PREVIEW</button></div><div class="click-sound-row settings-wide"><label><span>ACCENT CLICK</span><input id="accentClickPath" readonly></label><button id="chooseAccentClick">CHOOSE WAV</button><button id="previewAccentClick">PREVIEW</button></div><div class="click-sound-actions settings-wide"><button id="resetClickSounds">RESET TO PLAYBACK DEFAULTS</button><p id="clickSoundStatus">These sounds are saved on this computer and locked into the next Confirmed Set.</p></div><div class="settings-section-heading settings-wide"><span>DANTE OUTPUT MATRIX</span><h3 id="outputMatrixHeading">Assign stems and live buses to available outputs</h3></div><div id="outputMatrix" class="settings-grid settings-wide"></div><div id="audioCheckReport" class="settings-report settings-wide">Select Run Audio Error Check for a live readiness report.</div></div></section>
  <section class="settings-page" data-settings-page="midi"><div class="settings-section-heading"><span>MIDI DEVICES</span><h3>Slides and console MIDI</h3></div><div class="settings-grid"><label class="settings-wide">ProPresenter MIDI Output<select id="midiSelect" title="ProPresenter MIDI output"></select></label><div class="settings-readout"><span>Output Status</span><strong id="midiStatus"></strong></div><div class="settings-readout"><span>Loaded Slide Events</span><strong id="settingsMidiEvents">—</strong></div><p class="settings-help settings-wide">Reaper MIDI is imported only from a track named Slides. The selected output is saved and the native engine is re-armed when it changes.</p></div><section class="midi-input-settings"><h3>Allen &amp; Heath GLD-112 · Dedicated MIDI Output</h3><div><label>Output<select id="gldMidiOutput"></select></label><label>MIDI Channel<input id="gldChannel" type="number" min="1" max="16" value="2"></label><button id="testGld">TEST DEVICE · NO DATA</button></div><div class="gld-preview"><button id="previewGld">PREVIEW INPUT 1 MUTE</button><code id="gldHex">Writes locked</code></div><p id="gldStatus">The device-open test sends no MIDI data. Console writes remain locked pending physical acceptance.</p></section></section>
  <section class="settings-page" data-settings-page="import"><div class="settings-section-heading"><span>LIBRARY / ANALYSIS</span><h3>Metadata and library maintenance</h3></div><div class="library-health-grid"><div class="library-health"><span>LIBRARY UPDATE</span><strong id="librarySyncState">IDLE</strong><small id="librarySyncDetail">Not running</small></div><div class="library-health"><span>ANALYZER</span><strong id="libraryAnalyzerState">IDLE</strong><small id="libraryAnalyzerDetail">Waiting for an update</small></div><div class="library-health"><span>READY SONGS</span><strong id="libraryReadyCount">—</strong><small>Analyzer files complete</small></div><div class="library-health"><span>NEEDS ANALYSIS</span><strong id="libraryNeedsCount">—</strong><small>Missing analyzer output</small></div><div class="library-health"><span>MISSING FOLDERS</span><strong id="libraryMissingCount">—</strong><small>Master path unavailable</small></div><div class="library-health"><span>LAST UPDATE</span><strong id="libraryLastScan">NEVER</strong><small id="libraryLastDuration">No completed update</small></div></div><div class="library-paths"><label>Library Root<input id="libraryRootPath" readonly></label><label>Master Workbook<input id="libraryWorkbookPath" readonly></label></div><div class="settings-action-list"><button id="settingsUpdateLibrary"><strong>UPDATE METADATA + LIBRARY</strong><small>Rescan song sources, rebuild changed Analyzer drafts, and refresh the set-builder library without removing setlists or arrangements.</small></button><button id="importReaper"><strong>IMPORT REAPER ARRANGEMENT</strong><small>Preview regions, tempo/key changes, and Slides MIDI before writing.</small></button></div><div id="settingsSyncStatus" class="settings-report">No library task is running.</div><div id="libraryIssueList" class="library-issue-list"><p>Run Update Metadata + Library to see song readiness.</p></div></section>
  <section class="settings-page" data-settings-page="control"><div class="settings-section-heading"><span>HTTP PERFORMANCE REMOTE</span><h3>Control Performance Mode from a phone, tablet, or browser</h3></div><div class="remote-settings"><p id="remoteStatus"></p><section id="httpQrCard" class="osc-qr-card offline"><div class="osc-qr-copy"><span>HTTP PERFORMANCE REMOTE</span><h3>Scan To Open Remote</h3><p id="httpQrStatus">Enable LAN to create a connection for other devices on this network.</p><label>HTTP Remote Address<input id="remoteUrl" type="text" readonly></label><div class="remote-buttons"><button id="openHttpRemote">OPEN REMOTE HERE</button><button id="copyRemoteUrl">COPY PRIVATE LINK</button><button id="toggleLanRemote">ENABLE LAN</button></div></div><div class="osc-qr-code"><canvas id="httpQrCanvas" width="210" height="210"></canvas><small>PRIVATE · DO NOT SHARE PUBLICLY</small></div></section><dl><div><dt>HTTP REMOTE</dt><dd id="remoteHttp">—</dd></div><div><dt>OSC CONTROL</dt><dd id="remoteOsc">—</dd></div></dl><section id="oscQrCard" class="osc-qr-card offline"><div class="osc-qr-copy"><span>OSC REMOTE CONNECTION</span><h3>Scan To Connect OSC</h3><p id="oscQrStatus">Enable LAN and OSC to create a stage-ready connection code.</p><label>Network Address<select id="oscQrAddress"></select></label><label>Private OSC Profile<input id="oscQrPayload" type="password" readonly></label><div class="remote-buttons"><button id="copyOscProfile">COPY OSC PROFILE</button><button id="toggleOsc">OSC ON</button></div></div><div class="osc-qr-code"><canvas id="oscQrCanvas" width="210" height="210"></canvas><small>PRIVATE · DO NOT SHARE PUBLICLY</small></div></section><section class="midi-input-settings"><h3>Foot Controller / MIDI Input</h3><div><label>Input<select id="midiInputDevice"></select></label><label>Profile<select id="footControllerProfile"><option value="disabled">Disabled</option><option value="basic-notes">Basic Notes · CH 1 · 20–26</option></select></label><button id="applyMidiInput">APPLY + ARM</button></div><p id="midiInputStatus">MIDI input is disabled.</p></section><p class="remote-warning">The HTTP remote mirrors the Performance page without its mixer. LAN links and OSC profiles contain a private control token; keep them inside the production network.</p></div></section>
  <section class="settings-page" data-settings-page="transitions"><div class="settings-section-heading"><span>SONG-TO-SONG PLAYBACK</span><h3>Transition timing presets</h3></div><div class="settings-grid transition-timing-grid"><label>Overlap Maximum<input id="transitionOverlapSeconds" type="number" min="0.5" max="5" step="0.5"><small>How early the next song may begin while the outgoing song continues.</small></label><label>Crossfade Length<input id="transitionCrossfadeSeconds" type="number" min="0.5" max="5" step="0.5"><small>Length of the equal-power fade between outgoing and incoming songs.</small></label><button id="saveTransitionSettings" class="settings-wide">SAVE TRANSITION TIMING</button><div id="transitionSettingsStatus" class="settings-report settings-wide">These presets are written into the Confirmed Set when you enter Performance Mode.</div></div><div class="transition-behaviors"><article><strong>CUE NEXT</strong><span>Finish the current song, select and prepare the next song, but do not play it.</span></article><article><strong>STAY</strong><span>Finish and remain on the current song.</span></article><article><strong>AUTO LINK</strong><span>Start the next song immediately when the current song ends.</span></article><article><strong>OVERLAP</strong><span>Start the next song before the current song has completely finished.</span></article><article><strong>CROSSFADE</strong><span>Fade the current song down while fading the next song up.</span></article></div></section>
  <section class="settings-page" data-settings-page="system"><div class="settings-section-heading"><span>DIAGNOSTICS</span><h3>Production readiness and error check</h3></div><div class="settings-grid"><button id="runSystemCheck">RUN FULL ERROR CHECK</button><button id="openReadinessDetails">OPEN READINESS DETAILS</button><div class="settings-readout"><span>Native Engine</span><strong id="settingsEngineStatus">—</strong></div><div class="settings-readout"><span>Current Set</span><strong id="settingsSetStatus">—</strong></div><div id="systemCheckReport" class="settings-report settings-wide">The full check validates the confirmed package, cache isolation, native engine, routing, MIDI, and next-song preload.</div></div></section>
</div></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const setDurationClock=document.createElement("div");
setDurationClock.className="set-duration-clock";
setDurationClock.innerHTML='<span>FULL SET DURATION</span><strong id="fullSetDuration">0:00</strong><small id="fullSetSongs">0 SONGS</small>';
$(".transport-clock").after(setDurationClock);
const data = await window.playback.bootstrap();
let activeSongIndex = data.activeSongIndex ?? 0;
let song = data.manifest.songs[activeSongIndex];
let liveState = data.performance;
let audioHealth:any=null,lastAudioHealthCallbacks=-1,lastAudioHealthAt=0,audioHealthStalled=false;
let editMode = false;
let prepModeActive = false;
let prepState: any = null;
let selectedSetItemId: string | null = null;
let catalogState: any = null;
let currentPosition = 0;
let performanceDuration = song.durationSeconds;
let performanceGrid = buildZeroBasedGrid(song.selectedBpm, song.timeSignature, performanceDuration);
let workspace: any = null;
let selectedRegionId = song.regions[0]?.id;
let selectionStart: number | null = null;
let selectionEnd: number | null = null;
let expandedStems = false;
let dragRegionId: string | null = null;
let dragSetItemId: string | null = null;
let editorLoading: Promise<void> | null = null;
let loopAuditionRegionId: string | null = null;
let stemRowHeight = Math.max(58, Math.min(240, Number(localStorage.getItem("playback.editor.stemHeight.v2")) || 129));
let summaryMixerHeight = Math.max(150, Math.min(360, Number(localStorage.getItem("playback.editor.summaryMixerHeight")) || 230));
let editorSnapMode: EditorSnapMode = localStorage.getItem("playback.editor.snap") === "measure" ? "measure" : "beat";
let arrangementOrderCollapsed = localStorage.getItem("playback.editor.arrangementOrderCollapsed") === "1";
let selectedRegionCollapsed = localStorage.getItem("playback.editor.selectedRegionCollapsed") === "1";
let mixerRenderSignature = "";
let performanceMeterGroups: { readonly id: string; readonly indices: readonly number[] }[] = [];
let loadingSetItemId:string|null=null,loadingProgress=0,loadingLabel="";
let editorLoadSerial:Promise<void>=Promise.resolve();
let performanceSongLoadSerial=0;
let performanceRegionSelectionExplicit=false;
let setCardContextMenu:HTMLElement|null=null;
const pendingEditorWaveforms=new Map<string,any>();
const transitionLabels:Record<SongTransitionType,{label:string;detail:string}>={
  "cue-next":{label:"CUE NEXT",detail:"SELECT NEXT"},
  "stay-in-song":{label:"STAY",detail:"KEEP CURRENT"},
  "auto-link":{label:"AUTO LINK",detail:"START NEXT"},
  overlap:{label:"OVERLAP",detail:"NEXT FULL"},
  crossfade:{label:"CROSSFADE",detail:"5 SEC"},
};
const transitionOptions=Object.entries(transitionLabels) as [SongTransitionType,{label:string;detail:string}][];
const mixerCommandTimers = new Map<number,number>();
const performanceMixerCommandTimers = new Map<string,number>();
const editorMixerCommandTimers = new Map<number,number>();
const storedEditorZoom = Number(localStorage.getItem("playback.editor.zoom"));
if (storedEditorZoom >= 1 && storedEditorZoom <= 12) ($("#editorZoom") as HTMLInputElement).value = String(storedEditorZoom);
document.body.classList.add("edit-mode");
document.addEventListener("click", () => {
  const menu = document.querySelector<HTMLElement>("#editorArrangementVersionMenu");
  if (menu) menu.hidden = true;
});

setupWindowsMenu();
setupNavigation();
setupDeviceSelectors();
setupClickSoundSettings();
setupRemoteControl();
setupReaperImport();
setupPerformance();
window.playback.audio.onHealth((health:any)=>{const now=Date.now();audioHealthStalled=lastAudioHealthAt>0&&now-lastAudioHealthAt<2500&&health.callbacks<=lastAudioHealthCallbacks;lastAudioHealthCallbacks=health.callbacks;lastAudioHealthAt=now;audioHealth=health;renderPerformanceReadiness(liveState.readiness);const status=document.querySelector<HTMLElement>("#settingsEngineStatus");if(status)status.textContent=audioHealthSummary();});
setupEditorControls();
setupPrep();
renderPerformanceTimeline();
renderLiveState();
void restoreStartupMode();

function setupWindowsMenu(){
  const bridge=(window.playback as any).windows;
  bridge?.onMenuAction((action:string)=>{
    const selectors:Record<string,string>={settings:"#remoteControl","import-reaper":"#importReaper","import-setlist":"#editorImportSetlist","export-setlist":"#editorExportSetlist",play:"#play",pause:"#pause",stop:"#stop",panic:"#panic","performance-mode":"#performanceMode","edit-mode":"#editMode"};
    const selector=selectors[action];if(selector)document.querySelector<HTMLButtonElement>(selector)?.click();
  });
}

function setupNavigation() {
  renderPerformanceReadiness(liveState.readiness);
  $("#ready").onclick = () => ($("#performanceReadiness") as HTMLDialogElement).showModal();
  $("#closePerformanceReadiness").onclick = () => ($("#performanceReadiness") as HTMLDialogElement).close();
  const previous = $("#previousSong") as HTMLButtonElement;
  const next = $("#nextSong") as HTMLButtonElement;
  previous.onclick = async () => { if(activeSongIndex>0)await selectPerformanceSong(activeSongIndex-1); };
  next.onclick = async () => { if(activeSongIndex<data.manifest.songs.length-1)await selectPerformanceSong(activeSongIndex+1); };
  $("#prepMode").onclick = () => void setPrepMode();
  $("#editMode").onclick = () => void setMode(true);
  $("#performanceMode").onclick = () => void enterPerformanceMode();
  renderPerformanceSongChrome();
}

function renderPerformanceSet() {
  $("#performanceSetName").textContent = data.manifest.name;
  $("#performanceSongTitle").textContent = song.song.title;
  $("#performanceArrangement").textContent = `${song.arrangement?.name ?? "Original Song"} · ${song.selectedKey} · ${song.selectedBpm} BPM${normalizationLabel(song)}`;
  $("#fullSetDuration").textContent=formatSetDuration(fullSetDurationSeconds());
  $("#fullSetSongs").textContent=`${data.manifest.songs.length} SONG${data.manifest.songs.length===1?"":"S"}`;
  renderSetStrip($("#performanceSetSongs"));
}

function fullSetDurationSeconds(){
  const songs=data.manifest.songs.reduce((total:number,item:any)=>total+Math.max(0,Number(item.durationSeconds)||0),0);
  const overlap=(data.manifest.transitions??[]).reduce((total:number,item:any)=>total+(["overlap","crossfade"].includes(item.type)?Math.max(0,Number(item.durationSeconds)||0):0),0);
  return Math.max(0,songs-overlap);
}

function formatSetDuration(seconds:number){const whole=Math.round(seconds),hours=Math.floor(whole/3600),minutes=Math.floor(whole%3600/60),remaining=whole%60;return hours?`${hours}:${String(minutes).padStart(2,"0")}:${String(remaining).padStart(2,"0")}`:`${minutes}:${String(remaining).padStart(2,"0")}`;}
function normalizationLabel(value:any){const db=Number(value?.loudnessNormalization?.appliedGainDb);return Number.isFinite(db)?` · AUTO ${db>=0?"+":""}${db.toFixed(1)} dB`:"";}

function renderPerformanceSongChrome(){
  $("#title").textContent=`${song.song.title} — ${song.song.artist}`;
  $("#facts").textContent=`${song.selectedKey} • ${song.selectedBpm} BPM • ${song.timeSignature.numerator}/${song.timeSignature.denominator} • ${song.stems.length} stems`;
  $(".setlist strong").textContent=song.song.title;
  $(".setlist small").textContent=song.arrangement?.name??"Original Song";
  ($<HTMLButtonElement>("#previousSong")).disabled=activeSongIndex===0;
  ($<HTMLButtonElement>("#nextSong")).disabled=activeSongIndex>=data.manifest.songs.length-1;
  const cueNext=$<HTMLButtonElement>("#cueNextSong"),hasNext=activeSongIndex<data.manifest.songs.length-1;
  cueNext.disabled=!hasNext;
  cueNext.textContent=hasNext?"CUE NEXT · READY":"NO NEXT SONG";
  renderPerformanceSet();
}

function applyPerformanceSong(payload:any,state:any){
  activeSongIndex=payload.index;
  data.activeSongIndex=payload.index;
  data.waveform=payload.waveform;
  data.stemLabels=payload.stemLabels;
  song=payload.song??data.manifest.songs[payload.index];
  liveState=state??liveState;
  currentPosition=Number(liveState.positionSeconds??0);
  performanceDuration=song.durationSeconds;
  performanceGrid=buildZeroBasedGrid(song.selectedBpm,song.timeSignature,performanceDuration);
  selectedRegionId=liveState.currentRegionId??song.regions[0]?.id??null;
  performanceRegionSelectionExplicit=false;
  mixerRenderSignature="";
  renderPerformanceSongChrome();
  renderPerformanceTimeline();
  renderTransportPosition();
  renderLiveState();
}

async function synchronizePerformanceSong(index:number,state:any){
  const serial=++performanceSongLoadSerial;
  try{const payload=await window.playback.set.getSong(index);if(serial!==performanceSongLoadSerial)return;applyPerformanceSong(payload,state);}catch(error){showError(error);}
}

async function selectPerformanceSong(index:number){
  if(index===activeSongIndex)return;
  const serial=++performanceSongLoadSerial;
  try{const payload=await window.playback.set.selectSong(index);if(serial!==performanceSongLoadSerial)return;applyPerformanceSong(payload,payload.state);}catch(error){showError(error);}
}

function renderSetStrip(strip:HTMLElement){
  const activeIndex=activeSongIndex;
  strip.replaceChildren();
  for(let index=0;index<10;index++){
    const setSong=data.manifest.songs[index];
    if(setSong){
      const button=document.createElement("button");button.className=`set-song-card ${index===activeIndex?"active":""}`;
      button.innerHTML=`<span>${String(index+1).padStart(2,"0")}</span><strong>${escapeHtml(setSong.song.title)}</strong><small>${escapeHtml(setSong.selectedKey)} · ${setSong.selectedBpm} BPM${escapeHtml(normalizationLabel(setSong))}</small>`;
      button.title=index===activeIndex?`${setSong.song.title} is selected`:`Load ${setSong.song.title}`;
      button.onclick=async()=>{if(index===activeIndex)return;button.disabled=true;try{await selectPerformanceSong(index);}finally{button.disabled=false;}};
      strip.append(button);
    }else{
      const empty=document.createElement("div");empty.className="set-song-card empty";empty.innerHTML=`<span>${String(index+1).padStart(2,"0")}</span><strong>EMPTY</strong><small>NO SONG LOADED</small>`;strip.append(empty);
    }
    if(index<9){
      const loaded=Boolean(data.manifest.songs[index]&&data.manifest.songs[index+1]),transition=document.createElement("label");transition.className=`set-transition ${loaded?"loaded":"empty"}`;
      const selected=(data.manifest.transitions?.find((item:{fromSongIndex:number;type:SongTransitionType})=>item.fromSongIndex===index)?.type??"cue-next") as SongTransitionType,definition=transitionLabels[selected];
      transition.innerHTML=`<span>TRANSITION</span><strong>${loaded?definition.label:"—"}</strong><small>${loaded?definition.detail:"EMPTY"}</small>`;
      if(loaded){const select=document.createElement("select");select.title=`Change transition from song ${index+1} to song ${index+2}`;for(const[value,option]of transitionOptions)select.add(new Option(option.label,value,false,value===selected));select.onchange=async()=>{select.disabled=true;try{const state=await window.playback.performance.command({action:"transition",fromSongIndex:index,type:select.value,continuePad:true});liveState=state;const plan=state.transitionPlan,dataTransitions=[...(data.manifest.transitions??[])].filter((item:any)=>item.fromSongIndex!==index);if(plan)dataTransitions.push(plan);data.manifest.transitions=dataTransitions;renderPerformanceSet();renderLiveState();}catch(error){showError(error);renderPerformanceSet();}};transition.append(select);}
      strip.append(transition);
    }
  }
}

function renderEditorSetBuilder() {
  const strip = $("#editorSetSongs"); strip.replaceChildren();
  if (!prepState) { strip.innerHTML = `<div class="set-song-card empty"><span>—</span><strong>LOADING SET</strong><small>PREPARING LIBRARY</small></div>`; return; }
  const items = prepState.setlist.items as any[];
  if (!selectedSetItemId || !items.some((item) => item.itemId === selectedSetItemId)) selectedSetItemId = items.find((item, index) => data.manifest.songs[index]?.song.id === item.songId)?.itemId ?? items[0]?.itemId ?? null;
  $("#editorSetName").textContent = prepState.setlist.name;
  ($<HTMLInputElement>("#editorSetlistName")).value = prepState.setlist.name;
  $("#editorSetlistStatus").textContent = `${items.length}/10 songs · changes save automatically`;
  for (let index = 0; index < 10; index += 1) {
    const item = items[index];
    if (item) {
      const card = document.createElement("article");
      const loaded=workspace?.originalFacts?.id===item.songId&&workspace?.source?.name===item.arrangement;
      card.className = `set-song-card editor-draft-card ${loaded ? "active" : ""} ${item.itemId === selectedSetItemId ? "selected" : ""}`;
      card.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.key)} · ${item.bpm} BPM</small>${loadingSetItemId===item.itemId?`<i class="set-card-load-pie" style="--load-angle:${loadingProgress*3.6}deg"><b>${loadingProgress}%</b></i>`:""}`;
      card.title = loaded ? `${item.title} is loaded for editing · drag to reorder · right-click for options` : `Load ${item.title} for editing · drag to reorder · right-click for options`;
      card.draggable=true;
      card.onclick = async () => { selectedSetItemId = item.itemId; renderEditorSetBuilder();await loadEditorItem(item.itemId); };
      card.oncontextmenu=(event)=>{event.preventDefault();event.stopPropagation();showSetCardContextMenu(event.clientX,event.clientY,item.itemId,item.title);};
      card.ondragstart=(event)=>{dragSetItemId=item.itemId;event.dataTransfer!.effectAllowed="move";event.dataTransfer!.setData("text/plain",item.itemId);requestAnimationFrame(()=>card.classList.add("dragging"));};
      card.ondragover=(event)=>{if(!dragSetItemId||dragSetItemId===item.itemId)return;event.preventDefault();event.dataTransfer!.dropEffect="move";strip.querySelectorAll(".drop-before,.drop-after").forEach(element=>element.classList.remove("drop-before","drop-after"));card.classList.add(event.clientX<card.getBoundingClientRect().left+card.offsetWidth/2?"drop-before":"drop-after");};
      card.ondragleave=(event)=>{if(!card.contains(event.relatedTarget as Node|null))card.classList.remove("drop-before","drop-after");};
      card.ondrop=(event)=>{event.preventDefault();event.stopPropagation();if(!dragSetItemId||dragSetItemId===item.itemId)return;const after=event.clientX>=card.getBoundingClientRect().left+card.offsetWidth/2,remaining=items.filter(candidate=>candidate.itemId!==dragSetItemId),targetIndex=remaining.findIndex(candidate=>candidate.itemId===item.itemId),beforeItemId=remaining[targetIndex+(after?1:0)]?.itemId??null,dragged=dragSetItemId;dragSetItemId=null;void prepCommand({action:"reorder",itemId:dragged,beforeItemId});};
      card.ondragend=()=>{dragSetItemId=null;strip.querySelectorAll(".dragging,.drop-before,.drop-after").forEach(element=>element.classList.remove("dragging","drop-before","drop-after"));};
      strip.append(card);
    } else {
      const add = document.createElement("button"); add.className = "set-song-card empty add-song-card";
      add.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>+ ADD SONG</strong><small>SEARCH LIBRARY</small>`;
      add.onclick = () => showSongLibraryPicker(); strip.append(add);
    }
    if (index < 9) {
      const loaded = Boolean(items[index] && items[index + 1]);
      const transition = document.createElement("label"); transition.className = `set-transition ${loaded ? "loaded" : "empty"}`;
      const selected = items[index]?.transitionToNext?.type ?? "cue-next", definition = transitionLabels[selected as SongTransitionType];
      transition.innerHTML = `<span>TRANSITION</span><strong>${loaded ? definition.label : "—"}</strong><small>${loaded ? definition.detail : "EMPTY"}</small>`;
      if (loaded) { const select = document.createElement("select"); select.title = `Transition from song ${index + 1} to song ${index + 2}`; for (const [value, option] of transitionOptions) select.add(new Option(option.label, value, false, value === selected)); select.onchange = () => void prepCommand({ action:"transition", itemId:items[index].itemId, type:select.value as SongTransitionType, continuePad:true }); transition.append(select); }
      strip.append(transition);
    }
  }
  renderSelectedSetSongVersions(items);
  renderEditorSelectionState(items);
  renderEditorLoadStatus();
}

function renderSelectedSetSongVersions(items: any[]) {
  const panel = $("#editorSongVersions"), item = items.find((candidate) => candidate.itemId === selectedSetItemId);
  panel.hidden = !item;
  if (!item) return;
  $("#selectedSetSong").textContent = `${item.title} · ${item.artist}`;
  $("#editorSelectedArrangementName").textContent = item.arrangement;
  const registryVersions=(prepState.versionRegistry?.[item.songId] as any[]|undefined)??[];
  const versions=(registryVersions.length?registryVersions:prepState.prepared as any[])
    .filter((choice)=>choice.songId===item.songId)
    .filter((choice,index,all)=>all.findIndex((other)=>other.id===choice.id)===index)
    .sort((a,b)=>(a.arrangement==="Original Song"?0:1)-(b.arrangement==="Original Song"?0:1)||a.arrangement.localeCompare(b.arrangement)||a.key.localeCompare(b.key)||a.bpm-b.bpm);
  const select = $<HTMLSelectElement>("#editorArrangementVersion"); select.replaceChildren();
  const menuButton = $<HTMLButtonElement>("#editorArrangementVersionButton"), menu = $("#editorArrangementVersionMenu");
  menu.hidden = true;
  menu.replaceChildren();
  const activeVersionId=versions.find((version)=>version.id===item.id)?.id??versions.find((version)=>version.manifestPath===item.manifestPath&&version.songIndex===item.songIndex)?.id??versions.find((version)=>version.arrangement===item.arrangement&&version.key===item.key&&version.bpm===item.bpm)?.id;
  for (const version of versions) {
    const label = `${version.arrangement} · ${version.key} · ${version.bpm} BPM`;
    select.add(new Option(label, version.id, false, version.id === activeVersionId));
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = version.id === activeVersionId ? "active" : "";
    optionButton.textContent = label;
    optionButton.onclick = async (event) => {
      event.stopPropagation();
      menu.hidden = true;
      if (version.id === activeVersionId) return;
      select.value = version.id;
      await prepCommand({ action: "replace", itemId: item.itemId, choiceId: version.id });
      await loadEditorItem(item.itemId);
    };
    menu.append(optionButton);
  }
  if(activeVersionId)select.value=activeVersionId;
  menuButton.textContent = select.selectedOptions[0]?.textContent ?? "Select arrangement";
  menuButton.onclick = (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  menu.onclick = (event) => event.stopPropagation();
  select.onchange = async () => { await prepCommand({ action: "replace", itemId: item.itemId, choiceId: select.value });await loadEditorItem(item.itemId); };
}

async function restoreStartupMode(){
  const requested=localStorage.getItem("playback.ui.mode");
  if(requested==="performance"){await setMode(false);return;}
  if(requested==="prep"){await setPrepMode();return;}
  await setMode(true);
}

function renderEditorSelectionState(items:any[]){
  const item=items.find((candidate)=>candidate.itemId===selectedSetItemId);
  const loaded=Boolean(item&&workspace?.originalFacts?.id===item.songId&&workspace?.source?.name===item.arrangement);
  $("#editorWorkspace").classList.toggle("empty-selection",!loaded);
  const empty=$("#editorEmptySelection");empty.hidden=loaded;
  if(!loaded){
    empty.querySelector("strong")!.textContent=item?"SONG NOT LOADED":"NO SONG LOADED";
    empty.querySelector("span")!.textContent=item?"Click the selected song card to load it into Edit.":"Select + ADD SONG to load an Original Song or arrangement into this set card.";
    $("#title").textContent=item?item.title:"NO SONG LOADED";
    $("#facts").textContent=item?`${item.key} • ${item.bpm} BPM • WAITING TO LOAD`:"Select a song card to begin editing.";
    return;
  }
  $("#title").textContent=`${workspace.originalFacts.title} — ${workspace.originalFacts.artist}`;
  $("#facts").textContent=`${workspace.draft.selectedKey} • ${workspace.draft.selectedBpm} BPM • ${workspace.draft.timeSignature.numerator}/${workspace.draft.timeSignature.denominator} • ${workspace.waveforms.stems.length} stems`;
}

async function showSongLibraryPicker() {
  ($<HTMLInputElement>("#songLibrarySearch")).value = ""; ($<HTMLSelectElement>("#songLibrarySpeed")).value = "all";
  const dialog=$<HTMLDialogElement>("#songLibraryPicker");dialog.showModal();$("#songLibraryResults").innerHTML="<p>Loading the prepared library…</p>";try{const status=await window.playback.prep.status();catalogState=status.lastScan??catalogState;renderSongLibraryResults();if(!catalogState&&!prepState?.prepared?.length)$("#songLibraryResults").innerHTML="<p>Open Settings → Library / Analysis and run Update Metadata + Library first.</p>";}catch(error){showError(error);$("#songLibraryResults").innerHTML="<p>The prepared library could not be loaded.</p>";}($<HTMLInputElement>("#songLibrarySearch")).focus();
}

function renderSongLibraryResults() {
  const results = $("#songLibraryResults"), search = ($<HTMLInputElement>("#songLibrarySearch")).value.trim().toLowerCase(), speed = ($<HTMLSelectElement>("#songLibrarySpeed")).value;
  const originals = (prepState?.prepared ?? []).filter((choice: any) => choice.arrangement === "Original Song").filter((choice: any, index: number, all: any[]) => all.findIndex((other) => other.songId === choice.songId) === index);
  const preparedBySong=new Map(originals.map((choice:any)=>[choice.songId,choice])),masterRows=(catalogState?.songs??[]).map((song:any)=>({...song,prepared:preparedBySong.get(song.songId)})),choices=(masterRows.length?masterRows:originals.map((choice:any)=>({...choice,readiness:"ready",prepared:choice}))).filter((choice:any) => { const text = `${choice.title} ${choice.artist}`.toLowerCase(), bpm = Number(choice.bpm), speedMatch = speed === "all" || speed === "slow" && bpm <= 80 || speed === "medium" && bpm >= 81 && bpm <= 110 || speed === "fast" && bpm >= 111; return (!search || text.includes(search)) && speedMatch; });
  results.replaceChildren();
  for (const choice of choices) { const row = document.createElement("button"),prepared=choice.prepared,reviewable=choice.readiness==="ready"||choice.readiness==="needs-review";row.className=`library-choice ${choice.readiness}`;row.innerHTML = `<span><strong>${escapeHtml(choice.title)}</strong><small>${escapeHtml(choice.artist)} · ORIGINAL SONG</small></span><b>${escapeHtml(choice.key||"KEY REVIEW")} · ${choice.bpm} BPM</b><i>${prepared||reviewable?"LOAD":"UNAVAILABLE"}</i>`;row.disabled=!prepared&&!reviewable;row.onclick = async () => { row.disabled = true;row.querySelector("i")!.textContent=prepared?"LOADING…":"PREPARING…";try{if(prepared){await prepCommand({ action: "add", choiceId: prepared.id });selectedSetItemId=prepState.setlist.items.at(-1)?.itemId??null;}else{const result=await window.playback.prep.review(choice.songId);prepState=result;selectedSetItemId=result.addedItemId??prepState.setlist.items.at(-1)?.itemId??null;}renderEditorSetBuilder();($<HTMLDialogElement>("#songLibraryPicker")).close();$("#editorSetlistStatus").textContent=`Loading ${choice.title} Original Song…`;await loadEditorItem(selectedSetItemId!);}catch(error){row.disabled=false;row.querySelector("i")!.textContent="TRY AGAIN";showError(error);}};results.append(row); }
  if (!choices.length) results.innerHTML = `<p>No Original Songs match this name and speed.</p>`;
}

function setupDeviceSelectors() {
  const audio = $("#audioSelect") as HTMLSelectElement;
  audio.add(new Option("Audio · System Default", ""));
  for (const device of data.audio.devices) {
    const selected = data.audio.selectedDevice?.type === device.type && data.audio.selectedDevice?.name === device.name;
    audio.add(new Option(`Audio · ${device.name} · ${device.type}`, JSON.stringify(device), false, selected));
  }
  const outputCount=$<HTMLSelectElement>("#audioOutputCount");
  const renderOutputCounts=(device:any)=>{const max=Math.max(2,Number(device?.maxOutputChannels??device?.outputChannels??data.audio.outputChannels??2)),selected=Math.min(max,Number(device?.outputChannels??data.audio.selectedDevice?.outputChannels??max));outputCount.replaceChildren();const choices=[...new Set([2,4,6,8,16,32,64,128,max].filter(value=>value<=max))].sort((a,b)=>a-b);for(const count of choices)outputCount.add(new Option(count===max?`${count} · ALL AVAILABLE`:String(count),String(count),false,count===selected));outputCount.disabled=!device;};
  renderOutputCounts(data.audio.selectedDevice);
  const route = $("#routeStatus");
  setRouteStatus(data.audio.routingReady, data.audio.outputChannels);
  audio.onchange = async () => {
    audio.disabled = true; route.textContent = "OPENING AUDIO DEVICE";
    try { const choice=audio.value?JSON.parse(audio.value):null,device=choice?{...choice,outputChannels:choice.maxOutputChannels}:null;const state = await window.playback.audio.setDevice(device); data.audio={...data.audio,...state};renderOutputCounts(device);setRouteStatus(state.routingReady,state.outputChannels);renderOutputMatrix();renderDawMixer(); }
    catch (error) { route.className = "route-status fault"; route.textContent = "AUDIO FAULT"; showError(error); }
    finally { audio.disabled = false; }
  };
  outputCount.onchange=async()=>{if(!audio.value)return;outputCount.disabled=true;route.textContent="OPENING AUDIO DEVICE";try{const device={...JSON.parse(audio.value),outputChannels:Number(outputCount.value)};const state=await window.playback.audio.setDevice(device);data.audio={...data.audio,...state,selectedDevice:device};setRouteStatus(state.routingReady,state.outputChannels);renderOutputMatrix();renderDawMixer();}catch(error){route.className="route-status fault";route.textContent="AUDIO FAULT";showError(error);}finally{outputCount.disabled=false;}};
  const renderOutputMatrix=()=>{
    const matrix=$("#outputMatrix");matrix.replaceChildren();
    let lockButton=document.querySelector<HTMLButtonElement>("#routingMatrixLock");
    if(!lockButton){lockButton=document.createElement("button");lockButton.id="routingMatrixLock";lockButton.type="button";lockButton.className="settings-wide";matrix.before(lockButton);}
    const locked=data.audio.globalBusRoutingLocked!==false;
    lockButton.textContent=locked?"🔒 MATRIX LOCKED · CLICK TO UNLOCK":"🔓 MATRIX UNLOCKED · CLICK TO LOCK";
    lockButton.classList.toggle("active",locked);
    lockButton.onclick=async()=>{if(locked&&!confirm("Unlock the production output matrix? Routing changes affect every song."))return;lockButton!.disabled=true;try{const state=await window.playback.audio.setGlobalBusRoutingLock(!locked);data.audio={...data.audio,...state};$("#settingsStatus").textContent=state.globalBusRoutingLocked?"Output matrix locked.":"Output matrix unlocked. Routing can now be edited.";}catch(error){showError(error);}finally{lockButton!.disabled=false;renderOutputMatrix();}};
    const activeOutputs=Math.max(2,Number(data.audio.selectedDevice?.outputChannels??data.audio.outputChannels??2));
    const danteActive=/dante/i.test(`${data.audio.selectedDevice?.type??""} ${data.audio.selectedDevice?.name??""}`),stereo=activeOutputs===2;
    $("#outputMatrixHeading").textContent=stereo?"Choose Left, Right, or Both for every track and live bus":danteActive?`Assign stems and live buses to Dante outputs 1–${activeOutputs}`:`Assign stems and live buses to device outputs 1–${activeOutputs}`;
    const fields:any[]=PLAYBACK_OUTPUTS.map(bus=>({label:bus.appBus,key:bus.key,value:data.audio.globalBusRouting[bus.key].output,width:data.audio.globalBusRouting[bus.key].channels}));
    const grid=document.createElement("div");grid.className="dante-routing-grid";grid.style.gridTemplateColumns=`minmax(240px, 1fr) repeat(${activeOutputs}, ${activeOutputs<=8?"minmax(48px, 72px)":"36px"})`;grid.style.width=activeOutputs<=8?"100%":"max-content";
    const makeRouting=()=>structuredClone(data.audio.globalBusRouting);
    const setRoute=(routing:any,field:any,output:number)=>{routing[field.key]={...routing[field.key],output};};
    grid.append(Object.assign(document.createElement("strong"),{textContent:"OUTPUT / BUS"}));
    for(let output=1;output<=activeOutputs;output++)grid.append(Object.assign(document.createElement("b"),{textContent:String(output)}));
    for(const field of fields){
      const heading=document.createElement("span");heading.innerHTML=`<strong>${escapeHtml(field.label)}</strong><button class="route-mode">${field.width===2?(stereo?"BOTH":"STEREO"):(stereo&&field.value===2?"RIGHT":stereo?"LEFT":"MONO")}</button>`;grid.append(heading);
      const mode=heading.querySelector<HTMLButtonElement>(".route-mode");
      if(mode)mode.disabled=locked||!stereo;
      if(mode)mode.onclick=async()=>{if(!stereo)return;const routing:any=makeRouting();let nextWidth:1|2,nextOutput:number;if(field.width===2){nextWidth=1;nextOutput=1;}else if(field.value===1){nextWidth=1;nextOutput=2;}else{nextWidth=2;nextOutput=1;}routing[field.key]={output:nextOutput,channels:nextWidth};grid.classList.add("busy");try{const state=await window.playback.audio.setGlobalBusRouting(routing);data.audio={...data.audio,...state};$("#settingsStatus").textContent=`${field.label} global output updated.`;}catch(error){showError(error);$("#settingsStatus").textContent="Output selection could not be saved.";}renderOutputMatrix();};
      for(let output=1;output<=activeOutputs;output++){
        const cell=document.createElement("button"),selected=output===field.value||field.width===2&&output===field.value+1;
        cell.className=selected?output===field.value?"assigned start":"assigned linked":"";cell.textContent=selected?"✓":"";cell.title=locked?"Unlock the matrix to change routing":selected?`Click to remove ${field.label} from this output`:`Assign ${field.label} to output ${field.width===2?`${output}–${output+1}`:output}`;cell.disabled=locked||field.width===2&&output===activeOutputs;
        cell.onclick=async()=>{
          const routing=makeRouting();
          setRoute(routing,field,selected?0:output);
          grid.classList.add("busy");$("#settingsStatus").textContent=selected?`Removing ${field.label} from output ${field.value}…`:`Routing ${field.label} to output ${output}…`;
          try{const state=await window.playback.audio.setGlobalBusRouting(routing);data.audio={...data.audio,...state};$("#settingsStatus").textContent=selected?`${field.label} is now globally unassigned.`:`${field.label} is now globally routed to output ${output}.`;}catch(error){showError(error);$("#settingsStatus").textContent="That routing selection could not be saved.";}renderOutputMatrix();
        };
        grid.append(cell);
      }
    }
    matrix.append(grid);
  };renderOutputMatrix();
  const midi = $("#midiSelect") as HTMLSelectElement;
  midi.add(new Option("MIDI Disabled", ""));
  for (const output of data.midi.outputs) midi.add(new Option(`MIDI · ${output}`, output, false, output === data.midi.selectedOutput));
  setMidiStatus(data.midi.enabled);
  midi.onchange = async () => {
    midi.disabled = true; $("#midiStatus").textContent = "MIDI ARMING";
    try { const state = await window.playback.midi.setOutput(midi.value || null); data.midi={...data.midi,...state};setMidiStatus(state.enabled); if (workspace) await refreshWorkspace(); }
    catch (error) { $("#midiStatus").className = "midi-status fault"; $("#midiStatus").textContent = "MIDI FAULT"; showError(error); }
    finally { midi.disabled = false; }
  };
  function setRouteStatus(ready: boolean, channels: number) { route.className = `route-status ${ready ? "ready" : "fallback"}`; route.textContent = ready ? `${channels} OUT READY` : `${channels} OUT FALLBACK`; }
  function setMidiStatus(enabled: boolean) { $("#midiStatus").className = `midi-status ${enabled ? "ready" : "disabled"}`; $("#midiStatus").textContent = enabled ? "MIDI READY" : "MIDI OFF"; }
}
function setupClickSoundSettings() {
  let preview: HTMLAudioElement | null = null;
  const render=(settings:any)=>{($<HTMLInputElement>("#normalClickPath")).value=settings.normalPath;($<HTMLInputElement>("#accentClickPath")).value=settings.accentPath;};
  const refresh=async()=>{try{render(await window.playback.clickSounds.get());}catch(error){showError(error);$("#clickSoundStatus").textContent="Click sound settings could not be loaded.";}};
  const choose=async(kind:"normal"|"accent")=>{const button=$<HTMLButtonElement>(kind==="normal"?"#chooseNormalClick":"#chooseAccentClick");button.disabled=true;try{render(await window.playback.clickSounds.choose(kind));$("#clickSoundStatus").textContent=`${kind==="normal"?"Normal":"Accent"} click saved. Confirm Set again to apply it to Performance Mode.`;$("#settingsStatus").textContent="Dynamic click sounds updated.";}catch(error){showError(error);$("#clickSoundStatus").textContent="That file could not be used. Choose a valid WAV file.";}finally{button.disabled=false;}};
  const play=async(kind:"normal"|"accent")=>{try{preview?.pause();preview=new Audio(await window.playback.clickSounds.preview(kind));await preview.play();$("#clickSoundStatus").textContent=`Previewing ${kind} click.`;}catch(error){showError(error);$("#clickSoundStatus").textContent="The selected click sound could not be previewed.";}};
  $("#chooseNormalClick").onclick=()=>void choose("normal");
  $("#chooseAccentClick").onclick=()=>void choose("accent");
  $("#previewNormalClick").onclick=()=>void play("normal");
  $("#previewAccentClick").onclick=()=>void play("accent");
  $("#resetClickSounds").onclick=async()=>{const button=$<HTMLButtonElement>("#resetClickSounds");button.disabled=true;try{render(await window.playback.clickSounds.reset());$("#clickSoundStatus").textContent="Playback default click sounds restored. Confirm Set again to apply them.";}catch(error){showError(error);$("#clickSoundStatus").textContent="Default click sounds are unavailable on this computer.";}finally{button.disabled=false;}};
  void refresh();
}

function setupRemoteControl() {
  const dialog = $("#remoteSettings") as HTMLDialogElement;
  let control: any = null;
  const renderLibraryStatus=(state:any)=>{const scan=state?.lastScan??catalogState;$("#librarySyncState").textContent=(state?.sync??"idle").toUpperCase();$("#librarySyncState").className=state?.sync??"idle";$("#librarySyncDetail").textContent=state?.message??"Not running";$("#libraryAnalyzerState").textContent=state?.analyzer==="scanning"?"SCANNING":state?.analyzer==="waiting"?"WAITING":"IDLE";$("#libraryAnalyzerState").className=state?.analyzer??"idle";$("#libraryAnalyzerDetail").textContent=state?.analyzer==="scanning"?"Checking analyzer metadata now":state?.analyzer==="waiting"?`${scan?.counts?.["needs-analysis"]??0} song(s) need analyzer output`:"No analyzer task running";$("#libraryReadyCount").textContent=scan?String(scan.counts.ready):"—";$("#libraryNeedsCount").textContent=scan?String(scan.counts["needs-analysis"]):"—";$("#libraryMissingCount").textContent=scan?String(scan.counts["missing-folder"]):"—";$("#libraryLastScan").textContent=scan?new Date(scan.scannedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"NEVER";$("#libraryLastDuration").textContent=state?.finishedAt?new Date(state.finishedAt).toLocaleString():"No completed scan";($<HTMLInputElement>("#libraryRootPath")).value=state?.libraryRoot??"";($<HTMLInputElement>("#libraryWorkbookPath")).value=state?.masterWorkbookPath??"";const issues=$("#libraryIssueList"),problemSongs=(scan?.songs??[]).filter((item:any)=>item.readiness!=="ready");issues.innerHTML=problemSongs.length?problemSongs.map((item:any)=>`<div class="library-issue ${item.readiness}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.artist??"")} · ${escapeHtml(item.readiness.replaceAll("-"," ").toUpperCase())}</small></span><p>${escapeHtml(item.issues.join(" · ")||"Needs attention")}</p></div>`).join(""):`<p>${scan?"Every scanned song has complete analyzer metadata.":"Run Sync + Check Analyzer to see song readiness."}</p>`;};
  const showPage = (name: string) => {
    for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-settings-tab]")) button.classList.toggle("active", button.dataset.settingsTab === name);
    for (const page of dialog.querySelectorAll<HTMLElement>("[data-settings-page]")) page.classList.toggle("active", page.dataset.settingsPage === name);
  };
  const renderSettingsSummary = () => {
    $("#settingsIemStatus").textContent = data.audio.iemReady ? "PB_IEM OUTPUT 3 READY" : `${data.audio.outputChannels ?? 0} OUTPUT DEVICE`;
    $("#settingsMidiEvents").textContent = `${song.arrangement?.proPresenterMidi?.length ?? song.control?.proPresenterMidi?.length ?? 0} PREPARED`;
    $("#settingsEngineStatus").textContent = liveState.fault ? `FAULT · ${liveState.fault}` : liveState.readiness?.ready ? "ARMED" : "NOT READY";
    $("#settingsSetStatus").textContent = `${data.manifest.name} · ${liveState.readiness?.status ?? "Checking"}`;
  };
  const renderHttpConnection = async (state: any) => {
    const url = state?.urls?.[0] ?? "";
    ($<HTMLInputElement>("#remoteUrl")).value = url || "Remote adapter is unavailable";
    $("#remoteHttp").textContent = state?.address ? `Port ${state.address.httpPort} · token protected · ${state.lanEnabled ? "LAN ready" : "this computer only"}` : "Unavailable";
    $("#toggleLanRemote").textContent = state?.lanEnabled ? "DISABLE LAN" : "ENABLE LAN";
    $("#toggleLanRemote").classList.toggle("active", state?.lanEnabled === true);
    const card = $("#httpQrCard"), canvas = $<HTMLCanvasElement>("#httpQrCanvas"), context = canvas.getContext("2d")!;
    const available = Boolean(state?.address && url);
    card.classList.toggle("offline", !state?.lanEnabled || !available);
    if (!available || !state?.lanEnabled) {
      $("#httpQrStatus").textContent = available ? "Enable LAN so a phone or tablet can reach this computer. Open Remote Here still works locally." : "The HTTP remote adapter is unavailable.";
      context.fillStyle="#f4fbff";context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle="#263946";context.textAlign="center";context.font="700 13px Inter, sans-serif";context.fillText(available?"ENABLE LAN":"REMOTE OFFLINE",canvas.width/2,canvas.height/2);
      return;
    }
    $("#httpQrStatus").textContent = "Scan this code on a device connected to the same production network.";
    await QRCode.toCanvas(canvas, url, { width: 210, margin: 1, color: { dark: "#071117", light: "#f4fbff" }, errorCorrectionLevel: "M" });
  };
  const renderOscConnection = async (state: any) => {
    const card = $("#oscQrCard"), address = $("#oscQrAddress") as HTMLSelectElement;
    const previous = address.value;
    const hosts = [...new Set((state?.urls ?? []).map((value: string) => { try { return new URL(value).hostname; } catch { return ""; } }).filter(Boolean))] as string[];
    address.replaceChildren(...hosts.map(host => new Option(host, host, false, host === previous)));
    if (!address.value && hosts[0]) address.value = hosts[0];
    const active = Boolean(state?.lanEnabled && state?.oscEnabled && state?.address?.oscPort && address.value);
    card.classList.toggle("offline", !active);
    const canvas = $("#oscQrCanvas") as HTMLCanvasElement, context = canvas.getContext("2d")!;
    if (!active) {
      ($("#oscQrPayload") as HTMLInputElement).value = "";
      $("#oscQrStatus").textContent = "Enable LAN and OSC to create a stage-ready connection code.";
      context.fillStyle="#f4fbff";context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle="#263946";context.textAlign="center";context.font="700 13px Inter, sans-serif";context.fillText("ENABLE LAN + OSC",canvas.width/2,canvas.height/2);
      return;
    }
    const payload = createOscConnectionUri({ host: address.value, port: state.address.oscPort, token: state.token });
    ($("#oscQrPayload") as HTMLInputElement).value = payload;
    $("#oscQrStatus").textContent = `${address.value}:${state.address.oscPort} · token is sent as the first OSC argument`;
    await QRCode.toCanvas(canvas, payload, { width: 210, margin: 1, color: { dark: "#071117", light: "#f4fbff" }, errorCorrectionLevel: "M" });
  };
  $("#remoteControl").onclick = async () => {
    showPage("audio");
    if (!dialog.open) dialog.showModal();
    try{renderLibraryStatus(await window.playback.prep.status());}catch{}
    try{const settings=await window.playback.transitions.get();($<HTMLInputElement>("#transitionOverlapSeconds")).value=String(settings.overlapSeconds);($<HTMLInputElement>("#transitionCrossfadeSeconds")).value=String(settings.crossfadeSeconds);}catch{}
    try { control = await window.playback.control.get(); $("#remoteStatus").textContent = control.address ? control.lanEnabled ? "HTTP REMOTE READY ON LAN" : "HTTP REMOTE READY · THIS COMPUTER ONLY" : "REMOTE ADAPTER FAULT"; $("#remoteOsc").textContent = control.oscEnabled && control.address?.oscPort ? `Port ${control.address.oscPort}${control.lanEnabled ? " · token first argument" : " · localhost"}` : "Disabled"; $("#toggleOsc").textContent = control.oscEnabled ? "OSC ON" : "OSC OFF"; $("#toggleOsc").classList.toggle("active", control.oscEnabled);const input=$("#midiInputDevice") as HTMLSelectElement;input.replaceChildren(new Option("MIDI Input Disabled",""),...control.midiInput.devices.map((name:string)=>new Option(name,name,false,name===control.midiInput.selected)));($("#footControllerProfile") as HTMLSelectElement).value=control.midiInput.profile;$("#midiInputStatus").textContent=control.midiInput.enabled?`ARMED · ${control.midiInput.selected}`:"MIDI input is disabled.";const gldOutput=$("#gldMidiOutput") as HTMLSelectElement;gldOutput.replaceChildren(new Option("GLD MIDI Output Disabled",""),...control.gld.devices.map((name:string)=>new Option(name,name,false,name===control.gld.midiOutputName)));($("#gldChannel") as HTMLInputElement).value=String(control.gld.midiChannel);renderSettingsSummary();await renderHttpConnection(control).catch(()=>{$("#httpQrStatus").textContent="Remote link is ready, but the QR code could not be drawn.";});await renderOscConnection(control).catch(()=>{$("#oscQrStatus").textContent="OSC is ready, but the QR code could not be drawn.";}); } catch (error) { showError(error); }
  };
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-settings-tab]")) button.onclick = () => showPage(button.dataset.settingsTab!);
  $("#closeRemoteSettings").onclick = () => dialog.close();
  $("#saveTransitionSettings").onclick=async()=>{const button=$<HTMLButtonElement>("#saveTransitionSettings");button.disabled=true;$("#transitionSettingsStatus").textContent="Saving transition presets…";try{const settings=await window.playback.transitions.set({overlapSeconds:Number(($<HTMLInputElement>("#transitionOverlapSeconds")).value),crossfadeSeconds:Number(($<HTMLInputElement>("#transitionCrossfadeSeconds")).value)});($<HTMLInputElement>("#transitionOverlapSeconds")).value=String(settings.overlapSeconds);($<HTMLInputElement>("#transitionCrossfadeSeconds")).value=String(settings.crossfadeSeconds);$("#transitionSettingsStatus").textContent=`Saved · Overlap ${settings.overlapSeconds.toFixed(1)} seconds · Crossfade ${settings.crossfadeSeconds.toFixed(1)} seconds. These values will be locked into the next Confirmed Set.`;$("#settingsStatus").textContent="Transition timing saved.";}catch(error){showError(error);$("#transitionSettingsStatus").textContent="Transition timing could not be saved.";}finally{button.disabled=false;}};
  $("#openReadinessDetails").onclick = () => ($<HTMLDialogElement>("#performanceReadiness")).showModal();
  $("#runAudioCheck").onclick = () => {
    const checks = (liveState.readiness?.checks ?? []).filter((item: any) => ["engine", "routing", "assets"].includes(item.id));
    $("#audioCheckReport").innerHTML = checks.map((item: any) => `<div class="diagnostic-line ${item.level}"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></div>`).join("") || "No audio readiness information is available.";
    $("#settingsStatus").textContent = checks.some((item: any) => item.level === "blocked") ? "Audio error check found a blocking problem." : checks.some((item: any) => item.level === "warning") ? "Audio is available with warnings." : "Audio device and routing checks passed.";
  };
  $("#refreshAudioSettings").onclick = async () => { const button=$<HTMLButtonElement>("#refreshAudioSettings");button.disabled=true;$("#settingsStatus").textContent="Scanning Windows Audio, DirectSound, and ASIO devices…";try{const state=await window.playback.audio.refresh();data.audio={...data.audio,...state};const select=$<HTMLSelectElement>("#audioSelect");select.replaceChildren(new Option("Audio · System Default",""));for(const device of state.devices){const selected=state.selectedDevice?.type===device.type&&state.selectedDevice?.name===device.name;select.add(new Option(`Audio · ${device.name} · ${device.type}`,JSON.stringify(device),false,selected));}const route=$("#routeStatus");route.className=`route-status ${state.routingReady?"ready":"fallback"}`;route.textContent=state.routingReady?"6 OUT READY":`${state.outputChannels} OUT FALLBACK`;renderSettingsSummary();$("#settingsStatus").textContent=state.fellBack?"The selected device disconnected. Playback safely fell back to the system default.":`Audio scan complete · ${state.devices.length} devices found across all installed backends.`;}catch(error){showError(error);$("#settingsStatus").textContent="Audio device scan failed.";}finally{button.disabled=false;}};
  $("#runSystemCheck").onclick = () => {
    const checks = liveState.readiness?.checks ?? [], report = $("#systemCheckReport");
    report.innerHTML = checks.map((item: any) => `<div class="diagnostic-line ${item.level}"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></div>`).join("") || "No readiness checks are available.";
    const blocked = checks.filter((item: any) => item.level === "blocked").length, warnings = checks.filter((item: any) => item.level === "warning").length;
    $("#settingsStatus").textContent = blocked ? `System check failed · ${blocked} blocking error${blocked === 1 ? "" : "s"}.` : warnings ? `System check passed with ${warnings} warning${warnings === 1 ? "" : "s"}.` : "System check passed · performance ready.";
  };
  $("#settingsUpdateLibrary").onclick = async () => { const button = $<HTMLButtonElement>("#settingsUpdateLibrary"); button.disabled = true; $("#settingsSyncStatus").textContent = "Reading metadata and updating changed songs…"; try { const result = await window.playback.prep.update(); catalogState = result; prepState = result; if (editMode) renderEditorSetBuilder(); renderLibraryStatus(await window.playback.prep.status()); $("#settingsSyncStatus").textContent = `Update complete · ${result.updated} rebuilt · ${result.unchanged} unchanged · ${result.prepared.length} versions available${result.failures.length ? ` · ${result.failures.length} need attention` : ""}.`; } catch (error) { renderLibraryStatus(await window.playback.prep.status()); $("#settingsSyncStatus").textContent = `Update failed · ${error instanceof Error ? error.message : String(error)}`; } finally { button.disabled = false; } };
  window.playback.prep.onStatus((state:any)=>renderLibraryStatus(state));
  $("#copyRemoteUrl").onclick = async () => { const input = $("#remoteUrl") as HTMLInputElement; try { await navigator.clipboard.writeText(input.value); $("#remoteStatus").textContent = "REMOTE LINK COPIED"; } catch { input.select(); document.execCommand("copy"); $("#remoteStatus").textContent = "REMOTE LINK COPIED"; } };
  $("#openHttpRemote").onclick = () => { const url=$<HTMLInputElement>("#remoteUrl").value;if(url.startsWith("http://")||url.startsWith("https://"))window.open(url,"_blank","noopener"); };
  $("#copyOscProfile").onclick = async () => { const input = $("#oscQrPayload") as HTMLInputElement;if(!input.value)return;try { await navigator.clipboard.writeText(input.value); $("#oscQrStatus").textContent = "PRIVATE OSC PROFILE COPIED"; } catch { input.select(); document.execCommand("copy"); $("#oscQrStatus").textContent = "PRIVATE OSC PROFILE COPIED"; } };
  $("#oscQrAddress").onchange = () => void renderOscConnection(control);
  $("#toggleLanRemote").onclick = async () => { if (!control) return; $("#remoteStatus").textContent = "RESTARTING CONTROL ADAPTER…"; await window.playback.control.setSettings({ lanEnabled: !control.lanEnabled });control=await window.playback.control.get();await Promise.all([renderHttpConnection(control),renderOscConnection(control)]);$("#remoteStatus").textContent=control.lanEnabled?"HTTP REMOTE READY ON LAN":"HTTP REMOTE READY · THIS COMPUTER ONLY"; };
  $("#toggleOsc").onclick = async () => { if (!control) return; $("#remoteStatus").textContent = "RESTARTING CONTROL ADAPTER…"; await window.playback.control.setSettings({ oscEnabled: !control.oscEnabled });control=await window.playback.control.get();await renderOscConnection(control);$("#toggleOsc").textContent=control.oscEnabled?"OSC ON":"OSC OFF";$("#toggleOsc").classList.toggle("active",control.oscEnabled);$("#remoteOsc").textContent=control.oscEnabled&&control.address?.oscPort?`Port ${control.address.oscPort}${control.lanEnabled?" · token first argument":" · localhost"}`:"Disabled"; };
  $("#applyMidiInput").onclick = async () => {const button=$("#applyMidiInput") as HTMLButtonElement;button.disabled=true;$("#midiInputStatus").textContent="ARMING MIDI INPUT…";try{const result=await window.playback.control.setMidiInput({name:($("#midiInputDevice") as HTMLSelectElement).value||null,profile:($("#footControllerProfile") as HTMLSelectElement).value});$("#midiInputStatus").textContent=result.enabled?`ARMED · ${result.selected}`:"MIDI input is disabled.";}catch(error){showError(error);$("#midiInputStatus").textContent="MIDI INPUT FAULT";}finally{button.disabled=false;}};
  window.playback.control.onMidiInput((event:any)=>{$("#midiInputStatus").textContent=`RECEIVED · ${event.status.toString(16).toUpperCase()} · ${event.data1} · ${event.data2}`;});
  $("#previewGld").onclick=async()=>{try{const preview=await window.playback.control.gldPreview({midiChannel:Number(($("#gldChannel") as HTMLInputElement).value),intent:{type:"mute",strip:{kind:"input",number:1},muted:true}});$("#gldHex").textContent=preview.hex;$("#gldStatus").textContent="PREVIEW ONLY · writes remain locked";}catch(error){showError(error);}};
  $("#testGld").onclick=async()=>{const button=$("#testGld") as HTMLButtonElement;button.disabled=true;$("#gldStatus").textContent="OPENING MIDI DEVICE · sending no data…";try{const result=await window.playback.control.gldTest({midiOutputName:($("#gldMidiOutput") as HTMLSelectElement).value,midiChannel:Number(($("#gldChannel") as HTMLInputElement).value)});$("#gldStatus").textContent=result.status==="connection-tested"?`READY · ${result.selected} · CH ${result.midiChannel} · writes locked`:"MIDI DEVICE NOT READY";}catch(error){$("#gldStatus").textContent="MIDI DEVICE TEST FAILED · no data sent";showError(error);}finally{button.disabled=false;}};
}

function setupReaperImport() {
  const dialog = $("#reaperImport") as HTMLDialogElement;
  let preview: any = null;
  const setImportStatus=(state:"idle"|"working"|"ready"|"error",title:string,detail:string,percent:number)=>{
    const status=$("#importStatus");
    status.className=`import-status ${state}`;
    status.querySelector("strong")!.textContent=title;
    status.querySelector("span")!.textContent=detail;
    (status.querySelector("progress") as HTMLProgressElement).value=percent;
  };
  const setImportButtons=(disabled:boolean,previewReady:boolean)=>{
    for(const item of dialog.querySelectorAll<HTMLButtonElement>("[data-action]"))item.disabled=disabled||(item.dataset.action!=="cancel"&&!previewReady);
  };
  $("#importReaper").onclick = async () => {
    preview=null;
    $("#importSummary").textContent="";
    $("#importDifferences").innerHTML="";
    $("#importWarning").textContent="Nothing is written until you choose an import action. Original Song remains unchanged.";
    setImportStatus("working","CHOOSE RPP","Waiting for Reaper project selection.",12);
    setImportButtons(false,false);
    if(!dialog.open)dialog.showModal();
    try {
      preview = await window.playback.arrangements.previewReaper(); if (!preview) { setImportStatus("idle","CANCELLED","No Reaper project was selected.",0); dialog.close(); return; }
      setImportStatus("working","READING RPP","Parsing regions, cues, tempo, stems, and Slides MIDI.",45);
      const a = preview.arrangement;
      $("#importSummary").textContent = `${a.name} · ${a.selectedKey ?? "Key unknown"} · ${a.selectedBpm} BPM · ${a.timeSignature.numerator}/${a.timeSignature.denominator} · ${a.regions.length} regions · ${a.proPresenterMidi.length} Slides MIDI events`;
      $("#importDifferences").innerHTML = preview.differences.length ? `<h3>Preview Differences</h3><ul>${preview.differences.map((item: any) => `<li>${escapeHtml(item.field)}: ${escapeHtml(JSON.stringify(item.original))} → ${escapeHtml(JSON.stringify(item.arrangement))}</li>`).join("")}</ul>` : "<p>No structural differences from Original Song.</p>";
      $("#importWarning").textContent = "Nothing is written until you choose an import action. Original Song remains unchanged.";
      setImportStatus("ready","PREVIEW READY","Review the changes, then choose how to import this arrangement.",100);
      setImportButtons(false,true);
    } catch (error) { setImportStatus("error","PREVIEW FAILED",error instanceof Error ? error.message : String(error),100); setImportButtons(false,false); showError(error); }
  };
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-action]")) button.onclick = async () => {
    const action = button.dataset.action as "new" | "replace" | "cancel" | string;
    if(action==="cancel"){preview=null;dialog.close();return;}
    if(!preview){setImportStatus("error","NO PREVIEW","Choose a Reaper project before importing.",100);return;}
    const buttons=[...dialog.querySelectorAll<HTMLButtonElement>("[data-action]")],originalText=button.textContent;
    buttons.forEach(item=>item.disabled=true);
    setImportStatus("working","IMPORTING","Rendering stems, building cues, copying pad/click assets, and writing the arrangement.",35);
    if(action!=="cancel")button.textContent="PREPARING PLAYABLE ARRANGEMENT…";
    try {
      const result = await window.playback.arrangements.commitReaper(action as "new" | "replace" | "cancel");
      dialog.close();
      if (!result.cancelled) {
        prepState=await window.playback.prep.get();
        const itemId=selectedSetItemId;
        const wanted=normalizeLocalPath(result.preparedManifestPath);
        const choice=(prepState.prepared as any[]).find((item:any)=>normalizeLocalPath(item.manifestPath)===wanted);
        if(itemId&&choice)prepState=await window.playback.prep.command({action:"replace",itemId,choiceId:choice.id});
        await setMode(true);
        renderEditorSetBuilder();
        if(itemId&&choice)await loadEditorItem(itemId);
        setEditorStatus(choice?"Reaper arrangement imported and loaded in Editor.":"Reaper arrangement imported. Select it from the Arrangement dropdown.");
      }
    }
    catch (error) { setImportStatus("error","IMPORT FAILED",error instanceof Error ? error.message : String(error),100); showError(error); }
    finally{buttons.forEach(item=>item.disabled=false);button.textContent=originalText;}
  };
}

function setupPerformance() {
  $("#play").onclick = () => editMode ? window.playback.command("play") : void liveCommand({ action: "play" });
  $("#pause").onclick = () => editMode ? window.playback.command("pause") : void liveCommand({ action: "pause" });
  $("#stop").onclick = () => editMode ? window.playback.command("stop") : void liveCommand({ action: "stop" });
  $("#pad").onclick = () => void liveCommand({ action: "bus", bus: "pad", enabled: !liveState.channels.pad });
  $("#slidesMidi").onclick = () => void liveCommand({ action: "slides-midi", enabled: !liveState.slidesMidiEnabled });
  $("#surfaceMidi").onclick = () => void liveCommand({ action: "surface-midi", enabled: liveState.surfaceMixerMidiEnabled === false });
  $("#previousSection").onclick = () => navigateSection(-1);
  $("#nextSection").onclick = () => navigateSection(1);
  $("#loopSection").onclick = () => void liveCommand({ action: "loop", regionId: performanceRegionSelectionExplicit ? selectedRegionId : liveState.currentRegionId });
  $("#repeatOnce").onclick = () => void liveCommand({ action: "repeat-once", regionId: performanceRegionSelectionExplicit ? selectedRegionId : liveState.currentRegionId });
  $("#panic").onclick = () => { if (!liveState.panicActive) void liveCommand({ action: "panic" }); };
  $("#clearFault").onclick = () => void liveCommand({ action: "clear-fault" });
  const cueNext = $("#cueNextSong") as HTMLButtonElement;
  cueNext.onclick = async () => { await liveCommand({ action: "cue-next" }); };
  const mixerCollapsed=localStorage.getItem("playback.performance.mixerCollapsed")==="1";document.body.classList.toggle("mixer-collapsed",mixerCollapsed);$("#mixerCollapse").textContent=mixerCollapsed?"EXPAND":"COLLAPSE";$("#mixerCollapse").setAttribute("aria-expanded",String(!mixerCollapsed));
  $("#mixerCollapse").onclick=()=>{const collapsed=document.body.classList.toggle("mixer-collapsed");localStorage.setItem("playback.performance.mixerCollapsed",collapsed?"1":"0");$("#mixerCollapse").textContent=collapsed?"EXPAND":"COLLAPSE";$("#mixerCollapse").setAttribute("aria-expanded",String(!collapsed));};
  setupMixerResize();
  window.playback.performance.onState((state) => { if(state.songIndex!==activeSongIndex){void synchronizePerformanceSong(state.songIndex,state);return;}liveState = state;if(!performanceRegionSelectionExplicit)selectedRegionId=state.currentRegionId;renderLiveState(); });
  window.playback.performance.onMeters(updateMixerMeters);
  window.playback.onTransport((state) => {
    currentPosition = state.positionSeconds;
    if (editMode && loopAuditionRegionId && workspace) {
      const loopSection = workspace.draft.sections.find((section: any) => section.id === loopAuditionRegionId);
      if (loopSection && state.positionSeconds >= loopSection.sourceEndSeconds - 0.01) window.playback.command("seek", loopSection.sourceStartSeconds);
    }
    renderTransportPosition();
  });
  addEventListener("keydown", (event) => {
    if (editMode || prepModeActive || event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    const action = keyboardAction(event.key); if (!action) return; event.preventDefault();
    if (action === "play-pause") void liveCommand({ action: liveState.playing ? "pause" : "play" });
    else if (action === "panic") { if (!liveState.panicActive) void liveCommand({ action: "panic" }); }
    else if (action === "previous-section") navigateSection(-1);
    else if (action === "next-section") navigateSection(1);
    else if (action === "loop") void liveCommand({ action: "loop" });
    else { const bus = action.replace("toggle-", ""); void liveCommand({ action: "bus", bus, enabled: !liveState.channels[bus] }); }
  });
}

function setupMixerResize(){const stored=Number(localStorage.getItem("playback.performance.mixerHeight")),initial=Number.isFinite(stored)&&stored>=180?stored:innerWidth>=1600?310:270;document.body.style.setProperty("--performance-mixer-height",`${initial}px`);const handle=$("#mixerResizeHandle");let originY=0,originHeight=initial;handle.onpointerdown=(event:PointerEvent)=>{if(document.body.classList.contains("mixer-collapsed"))return;originY=event.clientY;originHeight=$("#performanceMixer").getBoundingClientRect().height;handle.setPointerCapture(event.pointerId);document.body.classList.add("mixer-resizing");};handle.onpointermove=(event:PointerEvent)=>{if(!handle.hasPointerCapture(event.pointerId))return;const maximum=Math.min(520,innerHeight-330),height=Math.max(180,Math.min(maximum,originHeight+originY-event.clientY));document.body.style.setProperty("--performance-mixer-height",`${Math.round(height)}px`);};handle.onpointerup=(event:PointerEvent)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);document.body.classList.remove("mixer-resizing");localStorage.setItem("playback.performance.mixerHeight",String(Math.round($("#performanceMixer").getBoundingClientRect().height)));};}

function setupEditorSummaryMixerResize(){document.body.style.setProperty("--editor-summary-mixer-height",`${summaryMixerHeight}px`);}
function bindEditorSummaryMixerResize(){const handle=document.querySelector<HTMLElement>("#summaryMixerResizeHandle");if(!handle)return;let originY=0,originHeight=summaryMixerHeight;handle.onpointerdown=(event:PointerEvent)=>{originY=event.clientY;originHeight=$("#summaryStemMixer").getBoundingClientRect().height;handle.setPointerCapture(event.pointerId);document.body.classList.add("mixer-resizing");};handle.onpointermove=(event:PointerEvent)=>{if(!handle.hasPointerCapture(event.pointerId))return;const height=Math.max(150,Math.min(380,originHeight+originY-event.clientY));summaryMixerHeight=Math.round(height);document.body.style.setProperty("--editor-summary-mixer-height",`${summaryMixerHeight}px`);};handle.onpointerup=(event:PointerEvent)=>{if(!handle.hasPointerCapture(event.pointerId))return;handle.releasePointerCapture(event.pointerId);document.body.classList.remove("mixer-resizing");localStorage.setItem("playback.editor.summaryMixerHeight",String(summaryMixerHeight));};}
function renderEditorPanelCollapse(){const grid=document.querySelector<HTMLElement>(".editor-grid");if(!grid)return;grid.classList.toggle("arrangement-order-collapsed",arrangementOrderCollapsed);grid.classList.toggle("selected-region-collapsed",selectedRegionCollapsed);$("#toggleRegionBrowser").textContent=arrangementOrderCollapsed?"ORDER ›":"‹ ORDER";$("#toggleRegionBrowser").setAttribute("aria-expanded",String(!arrangementOrderCollapsed));$("#toggleEditorInspector").textContent=selectedRegionCollapsed?"‹ REGION":"REGION ›";$("#toggleEditorInspector").setAttribute("aria-expanded",String(!selectedRegionCollapsed));}

function setupEditorControls() {
  $("#confirmNewArrangement").onclick=async(event)=>{event.preventDefault();const input=$("#newArrangementName") as HTMLInputElement,name=input.value.trim();if(!name){input.classList.add("invalid");setSaveArrangementStatus("error","NAME REQUIRED","Enter an arrangement name before saving.",100);return;}const button=$("#confirmNewArrangement") as HTMLButtonElement;button.disabled=true;try{setSaveArrangementStatus("working","STARTING SAVE","Checking the arrangement name and editor state.",10);await saveCurrentArrangement(name);($("#arrangementNameDialog") as HTMLDialogElement).close();}catch(error){setSaveArrangementStatus("error","SAVE FAILED",error instanceof Error ? error.message : String(error),100);showError(error);}finally{button.disabled=false;}};
  $("#closeSongLibrary").onclick = () => ($<HTMLDialogElement>("#songLibraryPicker")).close();
  $("#songLibrarySearch").oninput = () => renderSongLibraryResults();
  $("#songLibrarySpeed").onchange = () => renderSongLibraryResults();
  $("#editorSetlistName").onchange = (event) => void prepCommand({ action: "rename", name: (event.currentTarget as HTMLInputElement).value });
  $("#summaryView").onclick = () => { expandedStems = false; renderEditorViewMode(); };
  $("#stemsView").onclick = () => { expandedStems = true; renderEditorViewMode(); };
  $("#editorZoom").oninput = () => { localStorage.setItem("playback.editor.zoom", ($("#editorZoom") as HTMLInputElement).value); renderEditorTimelineAtTransport(); };
  $("#widthDown").onclick = () => stepEditorWidth(-0.25); $("#widthUp").onclick = () => stepEditorWidth(0.25);
  $("#heightDown").onclick = () => stepStemHeight(-12); $("#heightUp").onclick = () => stepStemHeight(12);
  setupEditorSummaryMixerResize();
  renderEditorPanelCollapse();
  $("#toggleRegionBrowser").onclick=()=>{arrangementOrderCollapsed=!arrangementOrderCollapsed;localStorage.setItem("playback.editor.arrangementOrderCollapsed",arrangementOrderCollapsed?"1":"0");renderEditorPanelCollapse();renderEditorTimeline();};
  $("#toggleEditorInspector").onclick=()=>{selectedRegionCollapsed=!selectedRegionCollapsed;localStorage.setItem("playback.editor.selectedRegionCollapsed",selectedRegionCollapsed?"1":"0");renderEditorPanelCollapse();renderEditorTimeline();};
  for (const button of document.querySelectorAll<HTMLButtonElement>("#editorSnap [data-snap]")) button.onclick = () => setEditorSnapMode(button.dataset.snap as EditorSnapMode);
  const updateKeyTempo = () => void arrange({ type: "set-key-tempo", key: ($("#arrangementKey") as HTMLSelectElement).value, bpm: Number(($("#arrangementBpm") as HTMLInputElement).value) });
  $("#arrangementKey").onchange = updateKeyTempo; $("#arrangementBpm").onchange = updateKeyTempo;
  $("#arrangementClickTemplate").onchange = event => void arrange({ type: "set-click-template", templateId: (event.currentTarget as HTMLSelectElement).value });
  $("#sectionName").onchange = (event) => void arrange({ type: "rename-section", sectionId: selectedRegionId, name: (event.currentTarget as HTMLInputElement).value });
  $("#sectionStart").onchange = () => commitRegionBoundary("start");
  $("#sectionEnd").onchange = () => commitRegionBoundary("end");
  $("#cuePosition").onchange = () => commitCuePosition();
  for (const input of [$("#sectionStart"), $("#sectionEnd"), $("#cuePosition")]) input.addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Enter") (event.currentTarget as HTMLInputElement).blur(); });
  $("#selectPrevious").onclick = () => selectRelative(-1); $("#selectNext").onclick = () => selectRelative(1);
  $("#moveEarlier").onclick = () => moveSelected(-1); $("#moveLater").onclick = () => moveSelected(1);
  $("#duplicateRegion").onclick = () => void arrange({ type: "duplicate-section", sectionId: selectedRegionId });
  $("#deleteRegion").onclick = () => void arrange({ type: "delete-section", sectionId: selectedRegionId });
  $("#splitRegion").onclick = () => void arrange({ type: "split-section", atPosition: editorPosition(currentPosition) });
  $("#trimStart").onclick = () => void arrange({ type: "trim-start", atPosition: editorPosition(currentPosition) });
  $("#trimEnd").onclick = () => void arrange({ type: "trim-end", atPosition: editorPosition(currentPosition) });
  $("#newRegion").onclick = () => createRegionFromSelection();
  $("#auditionRegion").onclick = () => auditionSelectedSource();
  $("#loopAudition").onclick = () => toggleLoopAudition();
  $("#auditionBoundary").onclick = () => auditionSelectedBoundary();
  $("#cueEnabled").onchange = (event) => { const cue = selectedCue(); if (cue) void arrange({ type: "set-cue-enabled", cueId: cue.id, enabled: (event.currentTarget as HTMLInputElement).checked }); };
  $("#cueTarget").onchange = (event) => { const cue = selectedCue(); if (cue) void arrange({ type: "set-cue-target", cueId: cue.id, targetRegionId: (event.currentTarget as HTMLSelectElement).value }); };
  $("#auditionArrangementCue").onclick = async () => { const cue = selectedCue(); if (!cue) return; try { await new Audio(await window.playback.arrange.auditionCue(cue.id)).play(); } catch (error) { showError(error); } };
  $("#arrangementUndo").onclick = async () => { try { await window.playback.arrange.undo(); await refreshWorkspace(); } catch (error) { showError(error); } };
  $("#arrangementRedo").onclick = async () => { try { await window.playback.arrange.redo(); await refreshWorkspace(); } catch (error) { showError(error); } };
  $("#saveDraft").onclick = async () => { try { workspace = await window.playback.arrange.saveDraft(); renderEditor(); setEditorStatus("Draft saved. It will be restored after restart."); } catch (error) { showError(error); } };
  $("#revertDraft").onclick = async () => { try { workspace = await window.playback.arrange.revert(); selectedRegionId = workspace.draft.sections[0]?.id; renderEditor(); setEditorStatus("Reverted to the last saved draft."); } catch (error) { showError(error); } };
  $("#saveArrangement").onclick = () => void promptArrangementSave();
  $("#saveArrangementTop").onclick = () => void promptArrangementSave();
}

async function promptArrangementSave(){
  setSaveArrangementStatus("working","VERIFYING","Checking key, tempo, regions, cues, and readiness.",20);
  try{
    await window.playback.arrange.command({type:"set-key-tempo",key:($("#arrangementKey") as HTMLSelectElement).value,bpm:Number(($("#arrangementBpm") as HTMLInputElement).value)});
    workspace=await window.playback.arrange.workspace();
    renderEditor();
    const input=$("#newArrangementName") as HTMLInputElement;
    input.classList.remove("invalid");
    input.value=`${workspace.originalFacts.title} - ${workspace.draft.selectedKey} - ${workspace.draft.selectedBpm} BPM`;
    setSaveArrangementStatus("idle","WAITING","Verify the name, then save the arrangement.",0);
    const dialog=$("#arrangementNameDialog") as HTMLDialogElement;
    dialog.showModal();
    requestAnimationFrame(()=>{input.focus();input.select();});
  }catch(error){showError(error);}
}

function setSaveArrangementStatus(state:"idle"|"working"|"ready"|"error",title:string,detail:string,percent:number){
  const status=$("#saveArrangementStatus");
  status.className=`import-status ${state}`;
  status.querySelector("strong")!.textContent=title;
  status.querySelector("span")!.textContent=detail;
  (status.querySelector("progress") as HTMLProgressElement).value=percent;
}

async function saveCurrentArrangement(name:string){
  const buttons=[$("#saveArrangement"),$("#saveArrangementTop")] as HTMLButtonElement[];
  for(const button of buttons)button.disabled=true;
  setSaveArrangementStatus("working","VERIFYING","Checking key, tempo, regions, cues, and readiness.",20);
  setEditorStatus("Verifying arrangement…");
  try{
    await window.playback.arrange.command({type:"set-name",name});
    workspace=await window.playback.arrange.workspace();
    renderEditor();
    if(workspace.readiness.status==="Blocked")throw new Error("This arrangement is not ready to save. Check the red readiness items.");
    setEditorStatus("Rendering every stem and preparing the arrangement version…");
    setSaveArrangementStatus("working","RENDERING","Rendering every stem and preparing the playable arrangement package.",45);
    const saved=await window.playback.arrange.save(),itemId=selectedSetItemId;
    setSaveArrangementStatus("working","PUBLISHING","Adding the saved arrangement to the prepared arrangement library.",75);
    prepState=await window.playback.prep.get();
    const wanted=normalizeLocalPath(saved.manifestPath),choice=(prepState.prepared as any[]).find((item:any)=>normalizeLocalPath(item.manifestPath)===wanted);
    if(!choice)throw new Error(`${saved.arrangement.name} was rendered but did not publish to the arrangement library.`);
    setSaveArrangementStatus("working","LOADING EDITOR","Selecting the saved version on this set card.",90);
    if(itemId){prepState=await window.playback.prep.command({action:"replace",itemId,choiceId:choice.id});renderEditorSetBuilder();await loadEditorItem(itemId);}
    setSaveArrangementStatus("ready","SAVE COMPLETE",`${saved.arrangement.name} is selected and loaded in Editor.`,100);
    setEditorStatus(`Saved ${saved.arrangement.name} in ${saved.arrangement.selectedKey}. It is selected on this set card.`);
  }catch(error){throw error;}
  finally{for(const button of buttons)button.disabled=false;}
}

function normalizeLocalPath(value:string){return value.replaceAll("/","\\").toLowerCase();}

async function setMode(edit: boolean) {
  prepModeActive = false;
  editMode = edit;
  localStorage.setItem("playback.ui.mode",edit?"edit":"performance");
  document.body.classList.toggle("edit-mode", edit);
  document.body.classList.toggle("performance-mode", !edit);
  $("#prepWorkspace").hidden = true;
  $("#performanceWorkspace").hidden = edit;
  $("#editorWorkspace").hidden = !edit;
  $("#liveControls").hidden = edit;
  $("#performanceMixer").hidden = edit;
  $("#editorSnap").hidden = !edit;
  $("#editMode").classList.toggle("active", edit);
  $("#performanceMode").classList.toggle("active", !edit);
  $("#prepMode").classList.remove("active");
  $(".transport").hidden = false;
  $("#title").textContent = `${song.song.title} — ${song.song.artist}`;
  $("#facts").textContent = `${song.selectedKey} • ${song.selectedBpm} BPM • ${song.timeSignature.numerator}/${song.timeSignature.denominator} • ${song.stems.length} stems`;
  $("#modeLabel").textContent = edit ? "EDIT · SONG MAP + ARRANGEMENT WORKSPACE" : "PERFORMANCE MODE · CONFIRMED SET";
  if (edit && !prepState) {
    $("#editorSetlistStatus").textContent = "Loading setlist...";
    void window.playback.prep.get().then((state) => {
      prepState = state;
      if (editMode) renderEditorSetBuilder();
    }).catch(showError);
  }
  if (edit && !workspace) $("#editorStatus").textContent = "Select a song card to load it into Edit.";
  if (edit && workspace) {
    try {
      const pending = JSON.parse(localStorage.getItem("playback.editor.createNew") ?? "null");
      if (pending?.songId === String(song.song.id)) { await window.playback.arrange.command({ type: "set-name", name: pending.name }); localStorage.removeItem("playback.editor.createNew"); await refreshWorkspace(); setEditorStatus(`New arrangement ready: ${pending.name}`); }
    } catch { localStorage.removeItem("playback.editor.createNew"); }
  }
  if (edit && prepState) renderEditorSetBuilder();
  renderEditorSnapMode();
  renderPerformanceReadiness(liveState.readiness);
}

async function enterPerformanceMode(){
  if(!editMode){await setMode(false);return;}
  try{
    prepState??=await window.playback.prep.get();
    if(!prepState.setlist.items.length)throw new Error("Add at least one song before entering Performance");
    if(confirmedSetMatchesDraft()){
      await setMode(false);
      return;
    }
    localStorage.setItem("playback.ui.mode","performance");
    const selectedIndex=Math.max(0,prepState.setlist.items.findIndex((item:any)=>item.itemId===selectedSetItemId));
    $("#editorSetlistStatus").textContent="Confirming, caching, and checking the complete set for Performance…";
    const confirmStatus=$("#confirmSetProgress");confirmStatus.hidden=false;confirmStatus.classList.remove("fault");($<HTMLProgressElement>("#confirmSetProgressBar")).value=0;$("#confirmSetProgressPercent").textContent="0%";$("#confirmSetProgressLabel").textContent="Starting Confirm Set…";
    ($<HTMLButtonElement>("#performanceMode")).disabled=true;
    await window.playback.prep.confirm({selectedIndex});
  }catch(error){localStorage.setItem("playback.ui.mode","edit");($<HTMLButtonElement>("#performanceMode")).disabled=false;$("#confirmSetProgress").classList.add("fault");$("#confirmSetProgressLabel").textContent=error instanceof Error?error.message:String(error);showError(error);}
}

function confirmedSetMatchesDraft(){
  const items=prepState?.setlist?.items??[],confirmed=data.manifest.songs??[];
  if(prepState?.setlist?.name!==data.manifest.name||items.length!==confirmed.length)return false;
  for(let index=0;index<items.length;index+=1){
    const item=items[index],prepared=confirmed[index];
    if(String(prepared?.song?.id)!==String(item.songId)||(prepared?.arrangement?.name??"Original Song")!==item.arrangement)return false;
    if(index<items.length-1){
      const draftType=item.transitionToNext?.type??"cue-next";
      const confirmedType=data.manifest.transitions?.find((transition:any)=>transition.fromSongIndex===index)?.type??"cue-next";
      if(draftType!==confirmedType)return false;
    }
  }
  return true;
}

function setupPrep() {
  window.playback.prep.onConfirmStatus((state)=>{const progress=Math.max(0,Math.min(100,Math.round(state.progress))),status=$("#confirmSetProgress");status.hidden=false;status.classList.remove("fault");($<HTMLProgressElement>("#confirmSetProgressBar")).value=progress;$("#confirmSetProgressPercent").textContent=`${progress}%`;$("#confirmSetProgressLabel").textContent=state.label;$("#editorSetlistStatus").textContent=state.label;});
  window.playback.prep.onLoadStatus((state)=>{loadingSetItemId=state.itemId;loadingProgress=Math.max(0,Math.min(100,Math.round(state.progress)));loadingLabel=state.label;renderEditorSetBuilder();if(loadingProgress===100)window.setTimeout(()=>{if(loadingSetItemId===state.itemId&&loadingProgress===100){loadingSetItemId=null;loadingProgress=0;loadingLabel="";renderEditorSetBuilder();}},650);});
  window.playback.prep.onWaveformsReady((state)=>{pendingEditorWaveforms.set(state.itemId,state.waveforms);if(selectedSetItemId===state.itemId&&workspace){workspace={...workspace,waveforms:state.waveforms};pendingEditorWaveforms.delete(state.itemId);requestAnimationFrame(()=>renderEditorTimeline());}});
  $("#libraryFilter").oninput = () => renderCatalog();
  $("#setlistName").onchange = () => void prepCommand({ action: "rename", name: ($("#setlistName") as HTMLInputElement).value });
  $("#clearSetlist").onclick = () => void prepCommand({ action: "clear" });
  $("#editorClearSetlist").onclick = () => void prepCommand({ action: "clear" });
  $("#editorExportSetlist").onclick = () => void exportCurrentSetlist();
  $("#editorImportSetlist").onclick = () => void importSetlist();
  $("#confirmSet").onclick = async () => { const button = $("#confirmSet") as HTMLButtonElement; button.disabled = true; $("#setlistStatus").textContent = "Copying and validating the isolated performance package…"; try { localStorage.setItem("playback.ui.mode","performance"); const result = await window.playback.prep.confirm(); $("#setlistStatus").textContent = `Confirmed ${result.songs} song${result.songs === 1 ? "" : "s"}. Loading Performance…`; } catch (error) { localStorage.setItem("playback.ui.mode","prep"); showError(error); button.disabled = false; $("#setlistStatus").textContent = "Confirm Set failed. Draft was preserved."; } };
}

async function setPrepMode() {
  prepModeActive = true; editMode = false; localStorage.setItem("playback.ui.mode","prep"); document.body.classList.remove("edit-mode", "performance-mode");
  $("#prepWorkspace").hidden = false; $("#performanceWorkspace").hidden = true; $("#editorWorkspace").hidden = true; $("#liveControls").hidden = true; $("#performanceMixer").hidden=true; $("#editorSnap").hidden = true; $(".transport").hidden = true;
  $("#prepMode").classList.add("active"); $("#editMode").classList.remove("active"); $("#performanceMode").classList.remove("active");
  $("#modeLabel").textContent = "PREP · LIBRARY + SETLIST + CONFIRM SET"; $("#title").textContent = "Production Preparation"; $("#facts").textContent = "Performance remains isolated while this lane scans, orders, copies, and validates.";
  if (!prepState) prepState = await window.playback.prep.get(); renderPrep();
}

async function prepCommand(command: any) { try { prepState = await window.playback.prep.command(command); renderPrep(); renderEditorSetBuilder(); } catch (error) { showError(error); } }
async function exportCurrentSetlist(){
  const button=$("#editorExportSetlist") as HTMLButtonElement;
  button.disabled=true;
  $("#editorSetlistStatus").textContent="Exporting setlist to Dropbox...";
  try{
    const result=await window.playback.prep.exportSetlist();
    $("#editorSetlistStatus").textContent=`Setlist exported: ${result.path}`;
  }catch(error){showError(error);$("#editorSetlistStatus").textContent="Setlist export failed.";}
  finally{button.disabled=false;}
}
async function importSetlist(){
  const button=$("#editorImportSetlist") as HTMLButtonElement;
  button.disabled=true;
  $("#editorSetlistStatus").textContent="Importing setlist...";
  try{
    const result=await window.playback.prep.importSetlist();
    if(result?.cancelled){$("#editorSetlistStatus").textContent="Setlist import cancelled.";return;}
    prepState=result;
    selectedSetItemId=prepState.setlist.items[0]?.itemId??null;
    workspace=null;
    renderPrep();
    renderEditorSetBuilder();
    $("#editorSetlistStatus").textContent=`Imported ${prepState.setlist.name} from ${result.importedPath}.`;
  }catch(error){showError(error);$("#editorSetlistStatus").textContent="Setlist import failed.";}
  finally{button.disabled=false;}
}
function closeSetCardContextMenu(){setCardContextMenu?.remove();setCardContextMenu=null;}
function showSetCardContextMenu(clientX:number,clientY:number,itemId:string,title:string){
  closeSetCardContextMenu();
  const menu=document.createElement("div");menu.className="set-card-context-menu";menu.setAttribute("role","menu");menu.onpointerdown=(event)=>event.stopPropagation();
  const heading=document.createElement("strong");heading.textContent=title;
  const remove=document.createElement("button");remove.type="button";remove.className="danger";remove.textContent="Remove Song from Set";remove.setAttribute("role","menuitem");
  remove.onclick=async(event)=>{event.stopPropagation();closeSetCardContextMenu();if(selectedSetItemId===itemId){selectedSetItemId=null;workspace=null;}await prepCommand({action:"remove",itemId});};
  menu.append(heading,remove);document.body.append(menu);setCardContextMenu=menu;
  const bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(clientX,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(clientY,innerHeight-bounds.height-8))}px`;
  window.setTimeout(()=>document.addEventListener("pointerdown",closeSetCardContextMenu,{once:true}),0);
}
function loadEditorItem(itemId:string){const request=editorLoadSerial.then(async()=>{if(selectedSetItemId!==itemId)return;try{const result=await window.playback.prep.loadItem(itemId);if(selectedSetItemId!==itemId)return;if(!prepState)prepState=await window.playback.prep.get();workspace=result.workspace;const preparedWaveforms=pendingEditorWaveforms.get(itemId);if(preparedWaveforms){workspace={...workspace,waveforms:preparedWaveforms};pendingEditorWaveforms.delete(itemId);}selectedRegionId=workspace.draft.sections[0]?.id??null;selectionStart=null;selectionEnd=null;currentPosition=0;renderEditorSetBuilder();renderEditor();requestAnimationFrame(()=>{if(selectedSetItemId===itemId)renderEditorTimeline();});}catch(error){if(selectedSetItemId===itemId){loadingSetItemId=null;loadingProgress=0;loadingLabel="";renderEditorSetBuilder();}throw error;}});editorLoadSerial=request.catch(()=>{});return request;}
function renderEditorLoadStatus(){const status=$("#editorLoadStatus"),visible=loadingSetItemId!==null;status.hidden=!visible;if(!visible)return;status.style.setProperty("--load-angle",`${loadingProgress*3.6}deg`);$("#editorLoadPercent").textContent=`${loadingProgress}%`;$("#editorLoadLabel").textContent=loadingLabel;($<HTMLProgressElement>("#editorLoadProgress")).value=loadingProgress;}
function renderPrep() {
  if (!prepState) return;
  ($("#setlistName") as HTMLInputElement).value = prepState.setlist.name;
  const library = $("#preparedLibrary"); library.replaceChildren();
  for (const choice of prepState.prepared) { const row = document.createElement("article"); row.innerHTML = `<div><strong>${escapeHtml(choice.title)}</strong><span>${escapeHtml(choice.artist)} · ${escapeHtml(choice.arrangement)}</span><small>${escapeHtml(choice.key)} · ${choice.bpm} BPM</small></div><button>ADD</button>`; row.querySelector("button")!.onclick = () => void prepCommand({ action: "add", choiceId: choice.id }); library.append(row); }
  if (!prepState.prepared.length) library.innerHTML = "<p>No prepared versions were found.</p>";
  const items = $("#setlistItems"); items.replaceChildren();
  prepState.setlist.items.forEach((item: any, index: number) => { const row = document.createElement("article"); row.innerHTML = `<b>${String(index + 1).padStart(2, "0")}</b><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.arrangement)} · ${escapeHtml(item.key)} · ${item.bpm} BPM</span></div><button data-action="up">↑</button><button data-action="down">↓</button><button data-action="remove">×</button>`; for (const button of row.querySelectorAll<HTMLButtonElement>("button")) button.onclick = () => void prepCommand(button.dataset.action === "remove" ? { action: "remove", itemId: item.itemId } : { action: "move", itemId: item.itemId, direction: button.dataset.action === "up" ? -1 : 1 }); items.append(row); });
  if (!prepState.setlist.items.length) items.innerHTML = "<p class='empty-set'>Add a prepared song version to begin.</p>";
  ($("#confirmSet") as HTMLButtonElement).disabled = !prepState.setlist.items.length; $("#setlistStatus").textContent = `${prepState.setlist.items.length} prepared song${prepState.setlist.items.length === 1 ? "" : "s"} · draft saved automatically`;
}
function renderCatalog() {
  if (!catalogState) return; const counts = catalogState.counts;
  $("#librarySummary").innerHTML = `<strong>${catalogState.songs.length} MASTER SONGS</strong><span>${counts.ready} ready</span><span>${counts["needs-review"]??0} ready for review</span><span>${counts["needs-analysis"]} need analysis</span><span>${counts["missing-folder"]} missing folder</span>`;
  const filter = ($("#libraryFilter") as HTMLInputElement).value.trim().toLowerCase(), rows = $("#catalogRows"); rows.replaceChildren();
  for (const songRow of catalogState.songs.filter((item: any) => !filter || `${item.title} ${item.artist} ${item.vendor}`.toLowerCase().includes(filter))) { const row = document.createElement("article"); row.className = songRow.readiness; row.innerHTML = `<div><strong>${escapeHtml(songRow.title)}</strong><span>${escapeHtml(songRow.artist)} · ${escapeHtml(songRow.vendor)}</span></div><b>${escapeHtml(songRow.key || "KEY ?")} · ${songRow.bpm || "BPM ?"}</b><em>${escapeHtml(songRow.readiness.replace("-", " "))}</em>`; rows.append(row); }
}

async function refreshWorkspace() {
  workspace = await window.playback.arrange.workspace();
  if (!workspace.draft.sections.some((section: any) => section.id === selectedRegionId)) selectedRegionId = workspace.draft.sections[0]?.id;
  renderEditor();
}

async function arrange(command: any) {
  try { await window.playback.arrange.command(command); await refreshWorkspace(); setEditorStatus(`Revision ${workspace.draft.revision} · ${workspace.draft.sections.length} regions · ${formatTime(workspace.draft.durationSeconds)}`); }
  catch (error) { showError(error); }
}

function renderEditor() {
  renderEditorPanelCollapse();
  const draft = workspace.draft;
  $("#editorSource").textContent = `${workspace.source.name} · ${workspace.source.kind.replaceAll("-", " ").toUpperCase()}`;
  $("#editorVersion").textContent = `${workspace.source.id} · ${workspace.source.hash.slice(0, 18)}`;
  $("#editorSelectedArrangementName").textContent = draft.name;
  const keySelect=$("#arrangementKey") as HTMLSelectElement;if(![...keySelect.options].some(option=>option.value===draft.selectedKey))keySelect.add(new Option(draft.selectedKey,draft.selectedKey));keySelect.value=draft.selectedKey;
  ($("#arrangementBpm") as HTMLInputElement).value = String(draft.selectedBpm);
  const clickSelect=$("#arrangementClickTemplate") as HTMLSelectElement;
  clickSelect.replaceChildren(...compatibleClickTemplates(draft.timeSignature).map(template=>new Option(template.label.toUpperCase(),template.id)));
  clickSelect.value=draft.clickTemplateId;
  $("#originalFacts").textContent = `${workspace.originalFacts.originalKey} · ${workspace.originalFacts.originalBpm} BPM · ${workspace.originalFacts.originalTimeSignature.numerator}/${workspace.originalFacts.originalTimeSignature.denominator}`;
  $("#arrangementDuration").textContent = `${draft.timeSignature.numerator}/${draft.timeSignature.denominator} · ${formatTime(draft.durationSeconds)}`;
  $("#draftState").className = `draft-state ${workspace.dirty ? "dirty" : "saved"}`;
  $("#draftState").textContent = workspace.dirty ? `UNSAVED · REV ${draft.revision}` : `SAVED · REV ${draft.revision}`;
  ($("#arrangementUndo") as HTMLButtonElement).disabled = !workspace.canUndo;
  ($("#arrangementRedo") as HTMLButtonElement).disabled = !workspace.canRedo;
  renderRegionList(); renderSelectedInspector(); renderReadiness(); renderEditorTimeline();
}

function renderRegionList() {
  const list = $("#regionList"); list.replaceChildren();
  for (const [index, section] of workspace.draft.sections.entries()) {
    const row = document.createElement("div");
    row.className = `region-list-item ${regionClass(section.name)} ${section.id === selectedRegionId ? "selected" : ""}`;
    row.draggable = true; row.dataset.regionId = section.id;
    row.innerHTML = `<button class="region-list-main" title="Select ${escapeHtml(section.name)}"><i class="region-drag-handle">⋮⋮</i><span class="region-order">${index + 1}</span><span class="region-list-copy"><strong>${escapeHtml(section.name)}</strong><small>${formatMusicalLocation(section.startPosition,section.startSeconds)}–${formatMusicalLocation(section.endPosition,section.endSeconds)}</small></span></button><div class="region-list-actions"><button data-action="rename" title="Rename region">RENAME</button><button data-action="duplicate" title="Duplicate region">DUPLICATE</button><button data-action="remove" title="Remove region and close its gap">REMOVE</button></div>`;
    row.querySelector<HTMLButtonElement>(".region-list-main")!.onclick = () => selectRegion(section.id);
    row.querySelector<HTMLButtonElement>("[data-action='rename']")!.onclick = (event) => { event.stopPropagation(); const name = prompt("Rename region", section.name)?.trim(); if (name && name !== section.name) void arrange({ type: "rename-section", sectionId: section.id, name }); };
    row.querySelector<HTMLButtonElement>("[data-action='duplicate']")!.onclick = (event) => { event.stopPropagation(); void arrange({ type: "duplicate-section", sectionId: section.id }); };
    row.querySelector<HTMLButtonElement>("[data-action='remove']")!.onclick = (event) => { event.stopPropagation(); void arrange({ type: "delete-section", sectionId: section.id }); };
    row.ondragstart = (event) => { dragRegionId = section.id; row.classList.add("dragging"); event.dataTransfer!.effectAllowed = "move"; };
    row.ondragend = () => { dragRegionId = null; row.classList.remove("dragging"); };
    row.ondragover = (event) => { event.preventDefault(); event.dataTransfer!.dropEffect = "move"; };
    row.ondrop = () => { if (!dragRegionId) return; const from = workspace.draft.sections.findIndex((item: any) => item.id === dragRegionId); if (from >= 0 && from !== index) void arrange({ type: "move-section", sectionId: dragRegionId, toIndex: index }); dragRegionId = null; };
    list.append(row);
  }
  list.querySelector(".region-list-item.selected")?.scrollIntoView({ block: "nearest" });
}

function renderSelectedInspector() {
  const section = selectedSection(); if (!section) return;
  ($("#sectionName") as HTMLInputElement).value = section.name;
  ($("#sectionStart") as HTMLInputElement).value = formatMusicalLocation(section.startPosition,section.startSeconds);
  ($("#sectionEnd") as HTMLInputElement).value = formatMusicalLocation(section.endPosition,section.endSeconds);
  $("#sectionSource").textContent = `Source ${section.sourceRegionId} · ${formatTime(section.sourceStartSeconds)}–${formatTime(section.sourceEndSeconds)}`;
  $("#loopAudition").classList.toggle("active", loopAuditionRegionId === section.id);
  const cue = selectedCue();
  ($("#cueEnabled") as HTMLInputElement).checked = cue?.enabled ?? false;
  const target = $("#cueTarget") as HTMLSelectElement;
  target.replaceChildren(...workspace.draft.sections.map((item: any) => new Option(item.name, item.id)));
  target.value = cue?.targetRegionId ?? section.id;
  const cuePosition = $("#cuePosition") as HTMLInputElement;
  cuePosition.value = cue ? formatMusicalLocation(cue.position,cue.atSeconds) : "";
  cuePosition.disabled = !cue;
  $("#cueDetail").textContent = cue ? `${cue.phrase} at ${formatMusicalLocation(cue.position,cue.atSeconds)} → ${sectionById(cue.targetRegionId)?.name ?? "Missing"}` : "No cue for this region";
  const midi = $("#midiEvents"); midi.replaceChildren();
  const events = workspace.draft.midi.filter((event: any) => event.atSeconds >= section.startSeconds && event.atSeconds < section.endSeconds && (event.status & 240) === 144 && event.data2 > 0);
  if (!events.length) midi.textContent = "No Slides MIDI in this region.";
  for (const event of events) {
    const label = document.createElement("div"); label.className = `midi-event ${event.data1 === 18 ? "automatic" : ""}`;
    const kind = midiKind(event.status, event.data2);
    const automatic = event.data1 === 18;
    label.innerHTML = `<input data-midi-enabled type="checkbox" ${event.enabled ? "checked" : ""}><span><strong>${automatic ? "SONG POSITION · AUTO" : kind}</strong><small>${formatMusicalLocation(event.position,event.atSeconds)} · CH ${(event.status & 15) + 1} · ${automatic ? "18 / setlist position" : `${event.data1}/${event.data2}`}</small></span>${automatic ? "" : `<input data-midi-value type="number" min="1" max="127" value="${event.data2}" title="ProPresenter value">`}${event.data1 === 19 ? '<button data-midi-delete title="Delete slide command">DELETE</button>' : ""}`;
    (label.querySelector("[data-midi-enabled]") as HTMLInputElement).onchange = (change) => void arrange({ type: "set-midi-enabled", eventId: event.id, enabled: (change.currentTarget as HTMLInputElement).checked });
    const value = label.querySelector<HTMLInputElement>("[data-midi-value]");
    if (value) value.onchange = () => void arrange({ type: "set-midi-value", eventId: event.id, value: Number(value.value) });
    const remove = label.querySelector<HTMLButtonElement>("[data-midi-delete]");
    if (remove) remove.onclick = () => void arrange({ type: "delete-midi-event", eventId: event.id });
    midi.append(label);
  }
}

function renderReadiness() {
  $("#readinessSummary").className = `readiness-summary ${workspace.readiness.status.toLowerCase().replaceAll(" ", "-")}`;
  $("#readinessSummary").textContent = workspace.readiness.status.toUpperCase();
  const checks = $("#readinessChecks"); checks.replaceChildren();
  for (const check of workspace.readiness.checks) { const row = document.createElement("div"); row.className = `readiness-check ${check.level}`; row.innerHTML = `<i></i><span><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></span>`; checks.append(row); }
  // Save stays available; clicking it reports any specific blocking check.
  ($("#saveArrangement") as HTMLButtonElement).disabled=false;($("#saveArrangementTop") as HTMLButtonElement).disabled=false;
}

function renderEditorViewMode() {
  document.body.classList.toggle("expanded-editor", expandedStems);
  $("#summaryView").classList.toggle("active", !expandedStems); $("#stemsView").classList.toggle("active", expandedStems);
  $("#summaryWaveform").hidden = expandedStems; $("#stemWaveforms").hidden = !expandedStems;
  $("#summaryStemMixer").hidden = expandedStems;
  $("#stemLabelGutter").hidden = !expandedStems;
  $("#expandedSizeControls").hidden = !expandedStems;
  renderEditorTimeline();
}

async function updateEditorStemMix(index: number, patch: any) {
  const latest = workspace.mixer.channels[index] ?? { index, gain: 1, muted: false, solo: false, iem: false };
  const next = await window.playback.editor.mixerChannel({ ...latest, ...patch, index });
  workspace.mixer.channels[index] = next;
  workspace.draft.stemMix = workspace.mixer.channels;
  return next;
}

function editorStemName(index: number, fallback: string) {
  return workspace?.stemLabels?.[index] ?? fallback ?? `Stem ${index + 1}`;
}

function editorStemDisplayOrder() {
  return workspace.waveforms.stems
    .map((stem: any, index: number) => ({ stem, index, label: editorStemName(index, stem.role) }))
    .sort((a: any, b: any) => editorStemOrderRank(a.label) - editorStemOrderRank(b.label) || a.index - b.index);
}

function editorStemOrderRank(label: string) {
  const value = label.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(acoustic|acous|ag)\b/.test(value)) return 10;
  if (/\b(electric|elec|eg)\s*\d*\b/.test(value) || /\bguitar\b/.test(value)) return 20;
  if (/\bbass\b/.test(value)) return 30;
  if (/\b(piano|keys?|organ|rhodes|synth)\b/.test(value)) return 40;
  if (/\b(strings?|violin|viola|cello)\b/.test(value)) return 60;
  if (/\b(drums?|loop|loops|perc|percussion|kick|snare|tom|toms|cymbal|shaker|tambourine|clap)\b/.test(value)) return 70;
  if (/\b(vocals?|bgv|bgvs|choir|alto|tenor|soprano|lead vocal)\b/.test(value)) return 80;
  return 90;
}

function renderEditorTimeline() {
  if (!workspace) return;
  const timeline = $("#editorTimeline");
  const zoom = Number(($<HTMLInputElement>("#editorZoom")).value);
  $("#editorZoomValue").textContent = `${zoom}x`;
  timeline.style.width = `${zoom * 100}%`;
  timeline.closest<HTMLElement>(".editor-timeline-shell")!.style.setProperty("--stem-row-height", `${stemRowHeight}px`);
  timeline.style.setProperty("--stem-row-height", `${stemRowHeight}px`);
  timeline.style.setProperty("--summary-mixer-height", `${summaryMixerHeight}px`);
  const ruler = $("#editorRuler"); ruler.replaceChildren();
  const labelEvery = Math.max(1, Math.ceil(4 / zoom));
  const musicalGrid = editorGrid();
  for (const mark of musicalGrid.filter((item: any) => item.beat === 1)) {
    const el = document.createElement("i"); el.style.left = `${(mark.timeSeconds / workspace.draft.durationSeconds) * 100}%`; if ((mark.measure - 1) % labelEvery === 0) el.innerHTML = `<span>${mark.measure}.1</span>`; ruler.append(el);
  }
  const gridLines = $("#editorGridLines"); gridLines.replaceChildren();
  for (const mark of musicalGrid) { const line = document.createElement("i"); line.className = mark.beat === 1 ? "measure" : "beat"; line.style.left = `${(mark.timeSeconds / workspace.draft.durationSeconds) * 100}%`; gridLines.append(line); }
  const boundaryLines = $("#editorBoundaryLines"); boundaryLines.replaceChildren();
  for (const section of workspace.draft.sections) { const line = document.createElement("i"); line.style.left = `${(section.startSeconds / workspace.draft.durationSeconds) * 100}%`; boundaryLines.append(line); }
  const lane = $("#editorRegionLane"); lane.replaceChildren();
  for (const section of workspace.draft.sections) {
    const button = document.createElement("button");
    button.className = `editor-region ${regionClass(section.name)} ${section.id === selectedRegionId ? "selected" : ""}`;
    button.style.left = `${(section.startSeconds / workspace.draft.durationSeconds) * 100}%`;
    button.style.width = `${((section.endSeconds - section.startSeconds) / workspace.draft.durationSeconds) * 100}%`;
    button.innerHTML = `<strong>${escapeHtml(section.name)}</strong><small>${measureLength(section)} measures</small>`;
    button.draggable = true; button.onclick = (event) => { event.stopPropagation(); selectRegion(section.id); };
    button.ondragstart = () => { dragRegionId = section.id; };
    button.ondragover = (event) => event.preventDefault();
    button.ondrop = () => { if (!dragRegionId) return; const index = workspace.draft.sections.findIndex((item: any) => item.id === section.id); if (dragRegionId !== section.id) void arrange({ type: "move-section", sectionId: dragRegionId, toIndex: index }); dragRegionId = null; };
    lane.append(button);
  }
  renderMarkers();
  drawWaveform($("#summaryWaveform canvas") as HTMLCanvasElement, workspace.waveforms.summary, "#63d8ff");
  const summaryMixer = $("#summaryStemMixer"); summaryMixer.replaceChildren();
  const summaryResize=document.createElement("div");summaryResize.id="summaryMixerResizeHandle";summaryResize.className="summary-mixer-resize-handle";summaryResize.title="Drag to resize editor mixer";summaryMixer.append(summaryResize);
  const summaryHeader = document.createElement("div"); summaryHeader.className = "summary-stem-mixer-heading"; summaryHeader.innerHTML = "<strong>STEM MIXER</strong><span>Mute choices follow Confirm Set.</span>"; summaryMixer.append(summaryHeader);
  const summaryChannelRow = document.createElement("div"); summaryChannelRow.className = "summary-stem-channel-row"; summaryMixer.append(summaryChannelRow);
  const stems = $("#stemWaveforms"); stems.replaceChildren();
  const labels = $("#stemLabelItems"); labels.replaceChildren();
  for (const [displayIndex, entry] of editorStemDisplayOrder().entries()) {
    const { stem, index } = entry;
    const channel=workspace.mixer?.channels[index]??{index,gain:1,muted:false,solo:false,iem:false};
    const stemName = entry.label;
    const color = stemColor(stemName, stem.role);
    const summaryStrip=document.createElement("article");summaryStrip.className=`daw-channel editor-summary-channel ${channel.muted?"muted":""}`;summaryStrip.style.setProperty("--channel-accent",color);summaryStrip.innerHTML=`<div class="channel-console"><div class="meter-shell"><i class="meter-fill" data-editor-vertical-meter-channel="${index}"></i></div><div class="console-controls"><div class="channel-switches"><button data-summary-stem-switch="muted" class="${channel.muted?"active":""}" title="Mute ${escapeHtml(stemName)}">M</button><button data-summary-stem-switch="solo" class="${channel.solo?"active":""}" title="Solo ${escapeHtml(stemName)}">S</button></div><input class="channel-fader" data-summary-stem-fader="${index}" type="range" min="0" max="1.25" step=".01" value="${channel.gain}" aria-label="${escapeHtml(stemName)} summary fader"></div></div><output>${Math.round(channel.gain*100)}%</output><div class="channel-name" title="${escapeHtml(stemName)}">${escapeHtml(stemName)}</div>`;summaryChannelRow.append(summaryStrip);
    for(const button of summaryStrip.querySelectorAll<HTMLButtonElement>("button"))button.onclick=async()=>{try{const latest=workspace.mixer.channels[index];await updateEditorStemMix(index,{muted:button.dataset.summaryStemSwitch==="muted"?!latest.muted:latest.muted,solo:button.dataset.summaryStemSwitch==="solo"?!latest.solo:latest.solo});renderEditorTimeline();}catch(error){showError(error);}};
    for(const fader of summaryStrip.querySelectorAll<HTMLInputElement>("input"))fader.oninput=()=>{const latest=workspace.mixer.channels[index],gain=Number(fader.value);workspace.mixer.channels[index]={...latest,gain};workspace.draft.stemMix=workspace.mixer.channels;const readout=summaryStrip.querySelector("output");if(readout)readout.textContent=`${Math.round(gain*100)}%`;const previous=editorMixerCommandTimers.get(index);if(previous)clearTimeout(previous);editorMixerCommandTimers.set(index,window.setTimeout(async()=>{try{await updateEditorStemMix(index,{gain:workspace.mixer.channels[index].gain});}catch(error){showError(error);}},30));};
    const label = document.createElement("label"); label.className="stem-console";label.innerHTML = `<span class="stem-console-name"><i class="stem-identifier" style="--stem-color:${color}"></i><strong title="${escapeHtml(stemName)}">${escapeHtml(stemName)}</strong></span><span class="stem-console-level"><input data-stem-fader type="range" min="0" max="1.25" step=".01" value="${channel.gain}" aria-label="${escapeHtml(stemName)} level"><span class="stem-inline-meter" title="Live signal level"><i data-editor-meter-channel="${index}"></i></span></span><span class="stem-console-switches"><button data-stem-switch="muted" class="${channel.muted?"active":""}">M</button><button data-stem-switch="solo" class="${channel.solo?"active":""}">S</button></span>`; labels.append(label);
    for(const button of label.querySelectorAll<HTMLButtonElement>("button"))button.onclick=async()=>{try{const latest=workspace.mixer.channels[index];await updateEditorStemMix(index,{muted:button.dataset.stemSwitch==="muted"?!latest.muted:latest.muted,solo:button.dataset.stemSwitch==="solo"?!latest.solo:latest.solo});renderEditorTimeline();}catch(error){showError(error);}};
    for(const fader of label.querySelectorAll<HTMLInputElement>("input"))fader.oninput=()=>{const latest=workspace.mixer.channels[index],gain=Number(fader.value);workspace.mixer.channels[index]={...latest,gain};workspace.draft.stemMix=workspace.mixer.channels;const previous=editorMixerCommandTimers.get(index);if(previous)clearTimeout(previous);editorMixerCommandTimers.set(index,window.setTimeout(async()=>{try{await updateEditorStemMix(index,{gain:workspace.mixer.channels[index].gain});}catch(error){showError(error);}},30));};
    const row = document.createElement("div"); row.className = `stem-row ${displayIndex % 2 ? "alternate" : ""}`; row.innerHTML = `<canvas></canvas>`; stems.append(row);
    row.style.setProperty("--stem-color", color);
    drawWaveform(row.querySelector("canvas")!, stem.buckets, color);
  }
  const scroll = $("#editorTimelineScroll");
  scroll.onscroll = () => { labels.style.transform = `translateY(${-scroll.scrollTop}px)`; };
  updateSelectionOverlay();
  bindEditorTimelinePointer();
  bindEditorSummaryMixerResize();
}

function renderMarkers() {
  const cueLane = $("#editorCueLane"); cueLane.querySelectorAll("i").forEach((item) => item.remove());
  for (const cue of workspace.draft.cues) {
    const marker=document.createElement("i"),target=sectionById(cue.targetRegionId);let dragged=false,dragAt=cue.atSeconds;
    marker.className=cue.enabled?"":"disabled";marker.style.left=`${(cue.atSeconds/workspace.draft.durationSeconds)*100}%`;marker.title=`Drag ${cue.phrase} left or right · announces ${target?.name}`;marker.innerHTML=`<span>${escapeHtml(cue.phrase)}</span>`;
    const position=(event:PointerEvent)=>{const rect=$("#editorTimeline").getBoundingClientRect(),raw=((event.clientX-rect.left)/rect.width)*workspace.draft.durationSeconds;return Math.max(0,Math.min(target?.startSeconds??workspace.draft.durationSeconds,snapToGrid(raw)));};
    marker.onpointerdown=(event)=>{event.preventDefault();event.stopPropagation();dragged=false;dragAt=cue.atSeconds;marker.setPointerCapture(event.pointerId);marker.classList.add("dragging");selectedRegionId=cue.targetRegionId;renderRegionList();renderSelectedInspector();};
    marker.onpointermove=(event)=>{if(!marker.hasPointerCapture(event.pointerId))return;const next=position(event);dragged=dragged||Math.abs(next-cue.atSeconds)>.0001;dragAt=next;marker.style.left=`${(next/workspace.draft.durationSeconds)*100}%`;marker.title=`${cue.phrase} · ${formatGridLocation(next,editorGrid())}`;};
    marker.onpointerup=(event)=>{if(!marker.hasPointerCapture(event.pointerId))return;marker.releasePointerCapture(event.pointerId);marker.classList.remove("dragging");if(dragged)void arrange({type:"set-cue-time",cueId:cue.id,atPosition:editorPosition(dragAt)});};
    marker.onpointercancel=()=>{marker.classList.remove("dragging");marker.style.left=`${(cue.atSeconds/workspace.draft.durationSeconds)*100}%`;};
    marker.onclick=(event)=>{event.stopPropagation();if(!dragged)selectRegion(cue.targetRegionId);};cueLane.append(marker);
  }
  const midiLane = $("#editorMidiLane"); midiLane.querySelectorAll("i").forEach((item) => item.remove());
  const commandEvents = workspace.draft.midi.filter((event: any) => (event.status & 240) === 144 && event.data2 > 0 && [17, 18, 19].includes(event.data1));
  for (const event of commandEvents) {
    const marker = document.createElement("i"), editable = event.data1 === 19; let dragged = false, dragAt = event.atSeconds;
    marker.className = `${event.enabled ? "" : "disabled"} note-${event.data1}`;
    marker.style.left = `${(event.atSeconds / workspace.draft.durationSeconds) * 100}%`;
    marker.innerHTML = `<span>${event.data1 === 18 ? "18/AUTO" : `${event.data1}/${event.data2}`}</span>`;
    marker.title = event.data1 === 18 ? "Song position is assigned automatically from the confirmed set" : editable ? "Drag to move · double-click to change slide value" : `Fixed ProPresenter command ${event.data1}/${event.data2}`;
    const position = (pointer: PointerEvent) => { const rect = $("#editorTimeline").getBoundingClientRect(), raw = Math.max(0, Math.min(workspace.draft.durationSeconds, ((pointer.clientX - rect.left) / rect.width) * workspace.draft.durationSeconds)); return pointer.shiftKey ? raw : snapToGrid(raw); };
    if (editable) {
      marker.onpointerdown = (pointer) => { pointer.preventDefault(); pointer.stopPropagation(); dragged = false; dragAt = event.atSeconds; marker.setPointerCapture(pointer.pointerId); marker.classList.add("dragging"); };
      marker.onpointermove = (pointer) => { if (!marker.hasPointerCapture(pointer.pointerId)) return; dragAt = position(pointer); dragged = dragged || Math.abs(dragAt - event.atSeconds) > .0001; marker.style.left = `${(dragAt / workspace.draft.durationSeconds) * 100}%`; };
      marker.onpointerup = (pointer) => { if (!marker.hasPointerCapture(pointer.pointerId)) return; marker.releasePointerCapture(pointer.pointerId); marker.classList.remove("dragging"); if (dragged) void arrange({ type: "set-midi-time", eventId: event.id, atPosition: editorPosition(dragAt) }); };
      marker.ondblclick = (pointer) => { pointer.preventDefault(); pointer.stopPropagation(); const next = prompt("ProPresenter slide value (1–127)", String(event.data2)); if (next !== null) void arrange({ type: "set-midi-value", eventId: event.id, value: Number(next) }); };
    }
    marker.onclick = (pointer) => { pointer.stopPropagation(); const section = workspace.draft.sections.find((candidate: any) => event.atSeconds >= candidate.startSeconds && event.atSeconds < candidate.endSeconds); if (section) selectRegion(section.id); };
    midiLane.append(marker);
  }
  midiLane.ondblclick = (pointer) => { if ((pointer.target as HTMLElement).closest("i")) return; pointer.preventDefault(); pointer.stopPropagation(); const rect = $("#editorTimeline").getBoundingClientRect(), raw = Math.max(0, Math.min(workspace.draft.durationSeconds, ((pointer.clientX - rect.left) / rect.width) * workspace.draft.durationSeconds)), at = pointer.shiftKey ? raw : snapToGrid(raw), next = prompt("New ProPresenter slide value (1–127)", "1"); if (next !== null) void arrange({ type: "add-slide-midi", atPosition: editorPosition(at), value: Number(next) }); };
}

function bindEditorTimelinePointer() {
  const stage = $("#editorTimeline");
  if (stage.dataset.bound === "true") return; stage.dataset.bound = "true";
  let pointerDown = false; let anchor = 0;
  const position = (event: PointerEvent) => { const rect = stage.getBoundingClientRect(); return snapToGrid(Math.max(0, Math.min(workspace.draft.durationSeconds, ((event.clientX - rect.left) / rect.width) * workspace.draft.durationSeconds))); };
  stage.onpointerdown = (event) => { if ((event.target as HTMLElement).closest("button")) return; pointerDown = true; anchor = position(event); selectionStart = anchor; selectionEnd = anchor; currentPosition = anchor; stage.setPointerCapture(event.pointerId); window.playback.command("seek", currentPosition); updateSelectionOverlay(); };
  stage.onpointermove = (event) => { if (!pointerDown) return; selectionStart = Math.min(anchor, position(event)); selectionEnd = Math.max(anchor, position(event)); currentPosition = position(event); window.playback.command("seek", currentPosition); updateSelectionOverlay(); };
  stage.onpointerup = (event) => { if (!pointerDown) return; pointerDown = false; stage.releasePointerCapture(event.pointerId); updateSelectionOverlay(); };
}

function updateSelectionOverlay() {
  if (!workspace) return;
  const overlay = $("#editorSelection");
  const valid = selectionStart !== null && selectionEnd !== null && selectionEnd - selectionStart > 0.0001;
  overlay.hidden = !valid;
  if (valid) { overlay.style.left = `${(selectionStart! / workspace.draft.durationSeconds) * 100}%`; overlay.style.width = `${((selectionEnd! - selectionStart!) / workspace.draft.durationSeconds) * 100}%`; $("#selectionLocation").textContent = `Selection ${formatGridLocation(selectionStart!, editorGrid())}–${formatGridLocation(selectionEnd!, editorGrid())}`; }
  else $("#selectionLocation").textContent = "Drag in the waveform to create a grid-aligned selection.";
  $("#editorPlayhead").style.left = `${(currentPosition / workspace.draft.durationSeconds) * 100}%`;
  $("#playheadLocation").textContent = formatGridLocation(currentPosition, editorGrid());
}

function renderPerformanceTimeline() {
  const canvas = $("#wave") as HTMLCanvasElement;
  const progressCanvas = $("#waveProgress") as HTMLCanvasElement;
  drawWaveform(canvas, data.waveform.buckets, "#63d8ff");
  drawWaveform(progressCanvas, data.waveform.buckets, "#ffffff");
  const ruler = $("#ruler"); ruler.replaceChildren();
  for (const mark of performanceGrid.filter((item: any) => item.beat === 1)) { const line = document.createElement("i"); line.style.left = `${(mark.timeSeconds / performanceDuration) * 100}%`; ruler.append(line); }
  const regions = $("#regions"); regions.replaceChildren();
  for (const region of song.regions) { const button = document.createElement("button"); button.className = `region ${regionClass(region.name)}`; button.dataset.regionId = region.id; button.style.left = `${(region.startSeconds / performanceDuration) * 100}%`; button.style.width = `${((region.endSeconds - region.startSeconds) / performanceDuration) * 100}%`; button.textContent = region.name; button.onclick = (event) => { event.stopPropagation();selectedRegionId=region.id;performanceRegionSelectionExplicit=true;renderLiveState();if (liveState.panicActive) void liveCommand({ action: "recover", regionId: region.id }); else { const now = performance.now(); const last = Number(button.dataset.lastClick ?? 0); if (now - last <= 400) void liveCommand({ action: "jump", regionId: region.id }); button.dataset.lastClick = String(now); } }; regions.append(button); }
  const boundaries=$("#performanceBoundaryLines");boundaries.replaceChildren();
  for(const region of song.regions.slice(1)){const line=document.createElement("i");line.style.left=`${(region.startSeconds/performanceDuration)*100}%`;line.title=`${region.name} boundary`;boundaries.append(line);}
  const cues = $("#cueMarkers"); cues.replaceChildren();
  for (const cue of song.cues ?? []) { const marker = document.createElement("i"); marker.style.left = `${(cue.atSeconds / performanceDuration) * 100}%`; marker.title = cue.phrase; marker.innerHTML = `<span>${escapeHtml(cue.phrase)}</span>`; cues.append(marker); }
  $("#performanceTimeline").onclick = (event) => { const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); window.playback.command("seek", ((event.clientX - rect.left) / rect.width) * performanceDuration); };
  updatePerformanceProgress();
  addEventListener("resize", () => { drawWaveform(canvas, data.waveform.buckets, "#63d8ff"); drawWaveform(progressCanvas, data.waveform.buckets, "#ffffff"); });
}

function updatePerformanceProgress() {
  if (!performanceDuration) return;
  const progress = Math.max(0, Math.min(100, (currentPosition / performanceDuration) * 100));
  const progressWave = $("#waveProgress");
  progressWave.style.clipPath = `inset(0 ${100 - progress}% 0 0)`;
  const active = song.regions.find((region: any) => currentPosition >= region.startSeconds && currentPosition < region.endSeconds)
    ?? (currentPosition >= performanceDuration ? song.regions.at(-1) : song.regions[0]);
  const shade = $("#currentRegionShade");
  if (!active) { shade.hidden = true; return; }
  shade.hidden = false;
  shade.style.left = `${(active.startSeconds / performanceDuration) * 100}%`;
  shade.style.width = `${((active.endSeconds - active.startSeconds) / performanceDuration) * 100}%`;
  for (const region of document.querySelectorAll<HTMLElement>("#regions .region")) region.classList.toggle("transport-current", region.dataset.regionId === active.id);
}

function renderTransportPosition(){
  const duration=editMode&&workspace?workspace.draft.durationSeconds:performanceDuration;
  const safePosition=Math.max(0,Math.min(Number(currentPosition)||0,duration||0));
  $("#clock").textContent=`${formatTime(safePosition)} / -${formatTime(Math.max(0,(duration||0)-safePosition))}`;
  const grid=editMode&&workspace?editorGrid():performanceGrid;
  $("#position").textContent=formatGridLocation(safePosition,grid);
  $("#playhead").style.left=`${performanceDuration?Math.max(0,Math.min(100,(safePosition/performanceDuration)*100)):0}%`;
  updatePerformanceProgress();
  if(workspace){$("#editorPlayhead").style.left=`${workspace.draft.durationSeconds?Math.max(0,Math.min(100,(safePosition/workspace.draft.durationSeconds)*100)):0}%`;$("#playheadLocation").textContent=formatGridLocation(safePosition,editorGrid());}
}

function renderLiveState() {
  const currentRegion = song.regions.find((region: any) => region.id === liveState.currentRegionId);
  const transitionRegion = song.regions.find((region: any) => region.id === liveState.recoveryRegionId);
  const currentRegionIndex = song.regions.findIndex((region: any) => region.id === liveState.currentRegionId);
  const nextRegion = currentRegionIndex >= 0 ? song.regions[currentRegionIndex + 1] : null;
  $("#currentSection").textContent = currentRegion?.name ?? "—";
  $("#upNextSection").textContent = `NEXT · ${nextRegion?.name ?? "END OF SONG"}`;
  $("#pad").textContent = `PAD ${song.selectedKey}`; $("#pad").classList.toggle("active", liveState.channels.pad);
  const slidesMidi = $<HTMLButtonElement>("#slidesMidi"), slidesMidiEnabled = Boolean(liveState.slidesMidiEnabled);
  slidesMidi.textContent = slidesMidiEnabled ? "PRO-PRESENTER ON" : "PRO-PRESENTER OFF";
  slidesMidi.classList.toggle("active", slidesMidiEnabled);
  slidesMidi.classList.toggle("manual", !slidesMidiEnabled);
  slidesMidi.title = slidesMidiEnabled ? "ProPresenter MIDI commands enabled" : "ProPresenter MIDI commands off for manual operator control";
  const surfaceMidi = $<HTMLButtonElement>("#surfaceMidi"), surfaceMidiEnabled = liveState.surfaceMixerMidiEnabled !== false;
  surfaceMidi.textContent = surfaceMidiEnabled ? "SURFACE MIXER ON" : "SURFACE MIXER OFF";
  surfaceMidi.classList.toggle("active", surfaceMidiEnabled);
  surfaceMidi.classList.toggle("manual", !surfaceMidiEnabled);
  surfaceMidi.title = surfaceMidiEnabled ? "Allen & Heath GLD-112 MIDI commands enabled" : "Allen & Heath GLD-112 MIDI commands off";
  for (const button of document.querySelectorAll<HTMLElement>("[data-bus]")) { const enabled = Boolean(liveState.channels[button.dataset.bus!]); button.classList.toggle("active", enabled); button.closest(".live-bus")?.classList.toggle("active", enabled); }
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-gain]")) { const bus = input.dataset.gain!; const gain = Number(liveState.gains?.[bus] ?? 1); if (document.activeElement !== input) input.value = String(gain); const output = document.querySelector<HTMLOutputElement>(`[data-gain-output="${bus}"]`); if (output) output.value = `${Math.round(gain * 100)}%`; }
  $("#loopSection").classList.toggle("active", liveState.loopRegionId !== null); $("#repeatOnce").classList.toggle("active", Boolean(liveState.repeatOnceRegionId));
  for (const region of document.querySelectorAll<HTMLElement>("#regions .region")) { region.classList.toggle("current", region.dataset.regionId === liveState.currentRegionId); region.classList.toggle("armed", region.dataset.regionId === liveState.recoveryRegionId); }
  for (const region of document.querySelectorAll<HTMLElement>("#regions .region")) region.classList.toggle("selected",performanceRegionSelectionExplicit&&region.dataset.regionId===selectedRegionId);
  const jump = $("#jumpState"); jump.hidden = liveState.panicActive || !transitionRegion; jump.querySelector("span")!.textContent = transitionRegion ? `${transitionRegion.name} will be announced, then entered at its boundary` : "";
  const panic = $("#panicState"); panic.hidden = !liveState.panicActive; panic.querySelector("span")!.textContent = transitionRegion ? `${transitionRegion.name} will be announced, then entered at its boundary` : "Tracks faded down · click and timeline continue · choose a section";
  $("#panic").classList.toggle("active", liveState.panicActive); $("#panic").textContent = liveState.panicActive ? "PANIC ACTIVE" : "PANIC";
  const actionCard = $("#performanceActionCard"); actionCard.className = "performance-action-card";
  let action = liveState.playing ? "FOLLOW TIMELINE" : "READY TO PLAY";
  let actionDetail = liveState.playing ? "No transition is armed" : "Transport is stopped";
  if (liveState.panicActive) { actionCard.classList.add("panic-active"); action = transitionRegion ? `RECOVER TO ${transitionRegion.name}` : "SELECT RECOVERY SECTION"; actionDetail = transitionRegion ? "Announcement and recovery are armed" : "Tracks down · click and timeline continue"; }
  else if (liveState.loopRegionId) { actionCard.classList.add("loop-active"); action = `LOOP ${song.regions.find((region: any) => region.id === liveState.loopRegionId)?.name ?? "SECTION"}`; actionDetail = transitionRegion ? "Repeat cue and return are armed" : "Continuous loop is selected"; }
  else if (transitionRegion) { actionCard.classList.add("armed"); action = `ENTER ${transitionRegion.name}`; actionDetail = "Destination cue and boundary transition are armed"; }
  $("#performanceAction").textContent = action;
  $("#performanceActionDetail").textContent = actionDetail;
  document.body.classList.toggle("transport-playing", Boolean(liveState.playing));
  const fault = $("#liveFault"); fault.hidden = !liveState.fault; fault.querySelector("span")!.textContent = liveState.fault ?? "";
  renderDawMixer();
  renderPerformanceReadiness(liveState.readiness);
}

function renderPerformanceBusMixer(){
  const mixer=liveState.mixer;if(!mixer)return;
  const groups=performanceMixerGroups(mixer),signature=groups.map(group=>`${group.id}:${group.label}:${group.sourceChannels.map((channel:any)=>channel.index).join(".")}`).join("|"),container=$("#mixerChannels");
  if(signature!==mixerRenderSignature){
    mixerRenderSignature=signature;performanceMeterGroups=groups.map(group=>({id:group.id,indices:group.sourceChannels.map((channel:any)=>channel.index)}));container.replaceChildren();
    for(const group of groups){
      const strip=document.createElement("article");strip.className=`daw-channel ${group.className}`;strip.dataset.mixerGroup=group.id;strip.style.setProperty("--channel-accent",group.accent);strip.innerHTML=`<div class="channel-head"><b data-meter-readout="${escapeHtml(group.id)}">-inf</b></div><div class="channel-console"><div class="meter-shell"><i class="meter-fill" data-meter-channel="${escapeHtml(group.id)}"></i></div><div class="console-controls"><div class="channel-switches"><button data-mixer-switch="muted" title="Mute ${escapeHtml(group.label)}">M</button><button data-mixer-switch="solo" title="Solo ${escapeHtml(group.label)}">S</button><button data-mixer-switch="iem" title="Send ${escapeHtml(group.label)} to PB_IEM output 3">IEM</button></div><input class="channel-fader" data-mixer-fader="${escapeHtml(group.id)}" type="range" min="0" max="1.25" step="0.01" value="${group.gain}" aria-label="${escapeHtml(group.label)} fader"></div></div><output data-mixer-output="${escapeHtml(group.id)}">${Math.round(group.gain*100)}%</output><div class="channel-name" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</div>`;container.append(strip);
      const controlsLocked=group.controlsLocked;
      for(const button of strip.querySelectorAll<HTMLButtonElement>("[data-mixer-switch]")){const autoIem=group.className==="bus"&&button.dataset.mixerSwitch==="iem";button.disabled=controlsLocked||autoIem;button.title=autoIem?"PB_IEM follows this bus mute automatically":controlsLocked?`${group.label} is fixed in Performance mode`:button.title;button.onclick=()=>{if(controlsLocked||autoIem)return;const current=performanceMixerGroups(liveState.mixer).find(item=>item.id===group.id);if(!current)return;const key=button.dataset.mixerSwitch!;void updatePerformanceMixerGroup(current,{muted:key==="muted"?!current.muted:current.muted,solo:key==="solo"?!current.solo:current.solo,iem:key==="iem"?!current.iem:current.iem});};}
      const fader=strip.querySelector<HTMLInputElement>("[data-mixer-fader]")!,levelLocked=group.levelLocked||controlsLocked;fader.disabled=levelLocked;fader.title=levelLocked?`${group.label} is fixed in Performance mode`:`${group.label} level`;strip.classList.toggle("level-locked",levelLocked);strip.classList.toggle("controls-locked",controlsLocked);if(!levelLocked)fader.oninput=()=>{const requested=Number(fader.value);strip.querySelector<HTMLOutputElement>("output")!.value=`${Math.round(requested*100)}%`;const previous=performanceMixerCommandTimers.get(group.id);if(previous)clearTimeout(previous);performanceMixerCommandTimers.set(group.id,window.setTimeout(()=>{const current=performanceMixerGroups(liveState.mixer).find(item=>item.id===group.id);if(current)void updatePerformanceMixerGroup(current,{gain:requested});},30));};
    }
  }
  for(const group of groups){const strip=container.querySelector<HTMLElement>(`[data-mixer-group="${group.id}"]`);if(!strip)continue;strip.querySelector<HTMLButtonElement>('[data-mixer-switch="muted"]')?.classList.toggle("active",group.muted);strip.querySelector<HTMLButtonElement>('[data-mixer-switch="solo"]')?.classList.toggle("active",group.solo);strip.querySelector<HTMLButtonElement>('[data-mixer-switch="iem"]')?.classList.toggle("active",group.iem);strip.classList.toggle("muted",group.muted);const fader=strip.querySelector<HTMLInputElement>("[data-mixer-fader]");if(fader&&document.activeElement!==fader){fader.value=String(group.gain);strip.querySelector<HTMLOutputElement>("output")!.value=`${Math.round(group.gain*100)}%`;}}
  const iemReady=Boolean(data.audio.iemReady);$("#mixerIemStatus").textContent=iemReady?`PB_IEM AUTO - UNMUTED STEMS`:`PB_IEM ARMED - ${data.audio.outputChannels??0} OUTPUT DEVICE`;$("#performanceMixer").classList.toggle("iem-unavailable",!iemReady);
}

function performanceMixerGroups(mixer:any){
  const byId=new Map<string,any>();
  for(const channel of mixer.channels){const spec=performanceMixerSpec(channel);if(!byId.has(spec.id))byId.set(spec.id,{...spec,sourceChannels:[]});byId.get(spec.id).sourceChannels.push(channel);}
  return [...byId.values()].sort((a,b)=>a.order-b.order).map(group=>{const channels=group.sourceChannels,gain=channels.reduce((sum:number,channel:any)=>sum+Number(channel.gain??1),0)/Math.max(1,channels.length),controlsLocked=group.id==="dynamic-click"||group.id==="dynamic-cue";return{...group,gain,muted:channels.length>0&&channels.every((channel:any)=>channel.muted),solo:channels.some((channel:any)=>channel.solo),iem:controlsLocked?false:channels.length>0&&channels.every((channel:any)=>channel.iem),levelLocked:controlsLocked,controlsLocked};});
}
function performanceMixerSpec(channel:any){
  if(channel.kind==="click")return{id:"dynamic-click",label:"Dynamic Click",className:"click",accent:"#f0c75e",order:110};
  if(channel.kind==="cue")return{id:"dynamic-cue",label:"Dynamic Cue",className:"cue",accent:"#ff78b3",order:120};
  if(channel.kind==="pad")return{id:"dynamic-pad",label:"Dynamic Pad",className:"pad",accent:"#b495ff",order:100};
  const label=data.stemLabels?.[channel.index]??song.stems[channel.index]?.displayName??song.stems[channel.index]?.role??`Stem ${channel.index+1}`,role=song.stems[channel.index]?.role??"";
  return performanceBusSpec(label,role);
}
function performanceBusSpec(label:string,role:string){
  const value=`${label} ${role}`.toLowerCase().replace(/[_-]+/g," ");
  if(/\b(acoustic|acous|ag)\b/.test(value))return{id:"bus-acoustic",label:"Acoustic",className:"bus",accent:"#63d8ff",order:10};
  if(/\b(electric|elec|eg)\s*\d*\b/.test(value)||/\bguitar\b/.test(value))return{id:"bus-electric",label:"Electric",className:"bus",accent:"#b69cff",order:20};
  if(/\bbass\b/.test(value))return{id:"bus-bass",label:"Bass",className:"bus",accent:"#74efb8",order:30};
  if(/\b(piano|keys?|organ|rhodes|synth)\b/.test(value))return{id:"bus-keys",label:"Keys",className:"bus",accent:"#84a9ff",order:40};
  if(/\b(strings?|violin|viola|cello)\b/.test(value))return{id:"bus-strings",label:"Strings",className:"bus",accent:"#64e0d2",order:60};
  if(/\b(drums?|kick|snare|tom|toms|cymbal|loop|loops|perc|percussion|shaker|tambourine|clap)\b/.test(value))return{id:"bus-drums",label:"Drums",className:"bus",accent:"#ff9b71",order:70};
  if(/\b(vocals?|bgv|bgvs|choir|alto|tenor|soprano|lead vocal)\b/.test(value))return{id:"bus-vocals",label:"Vocals",className:"bus",accent:"#ff78b3",order:80};
  return{id:"bus-other",label:"Other",className:"bus",accent:"#9fb4bf",order:90};
}
async function updatePerformanceMixerGroup(group:any,patch:Partial<{gain:number;muted:boolean;solo:boolean;iem:boolean}>){
  try{let state=liveState;for(const channel of group.sourceChannels){const current=state.mixer.channels[channel.index]??channel;state=await window.playback.performance.command({action:"mixer-channel",index:current.index,gain:patch.gain??current.gain,muted:patch.muted??current.muted,solo:patch.solo??current.solo,iem:group.levelLocked?false:patch.iem??current.iem});}if(state.songIndex!==activeSongIndex){await synchronizePerformanceSong(state.songIndex,state);return;}liveState=state;renderLiveState();}catch(error){showError(error);}
}

function renderDawMixer(){
  renderPerformanceBusMixer();
  return;
  const mixer=liveState.mixer;if(!mixer)return;
  const signature=mixer.channels.map((channel:any)=>channel.kind).join(",")+"|"+(data.stemLabels??[]).join(","),container=$("#mixerChannels");
  if(signature!==mixerRenderSignature){
    mixerRenderSignature=signature;container.replaceChildren();
    for(const channel of mixer.channels){
      const label=channel.kind==="stem"?(data.stemLabels?.[channel.index]??song.stems[channel.index]?.role??`Stem ${channel.index+1}`):channel.kind.toUpperCase(),strip=document.createElement("article");strip.className=`daw-channel ${channel.kind}`;strip.dataset.mixerIndex=String(channel.index);strip.innerHTML=`<div class="channel-head"><strong title="${escapeHtml(label)}">${escapeHtml(label)}</strong><b data-meter-readout="${channel.index}">−∞</b></div><div class="channel-console"><div class="meter-shell"><i class="meter-fill" data-meter-channel="${channel.index}"></i></div><div class="console-controls"><div class="channel-switches"><button data-mixer-switch="muted" title="Mute ${escapeHtml(label)}">M</button><button data-mixer-switch="solo" title="Solo ${escapeHtml(label)}">S</button><button data-mixer-switch="iem" title="Send ${escapeHtml(label)} to PB_IEM output 3">IEM</button></div><input class="channel-fader" data-mixer-fader="${channel.index}" type="range" min="0" max="1.25" step="0.01" value="${channel.gain}" aria-label="${escapeHtml(label)} fader"></div></div><output data-mixer-output="${channel.index}">${Math.round(channel.gain*100)}%</output><div class="channel-name">${escapeHtml(label)}</div><small>${String(channel.index+1).padStart(2,"0")} · ${channel.kind==="stem"?"MUSIC":channel.kind.toUpperCase()}</small>`;container.append(strip);
      for(const button of strip.querySelectorAll<HTMLButtonElement>("[data-mixer-switch]"))button.onclick=()=>{const active=liveState.mixer.channels[channel.index],key=button.dataset.mixerSwitch!;void liveCommand({action:"mixer-channel",index:active.index,gain:active.gain,muted:key==="muted"?!active.muted:active.muted,solo:key==="solo"?!active.solo:active.solo,iem:key==="iem"?!active.iem:active.iem});};
      const fader=strip.querySelector<HTMLInputElement>("[data-mixer-fader]")!,levelLocked=channel.kind==="click"||channel.kind==="cue";fader.disabled=levelLocked;fader.title=levelLocked?`${label} level is locked in Performance mode`:`${label} level`;strip.classList.toggle("level-locked",levelLocked);if(!levelLocked)fader.oninput=()=>{const requested=Number(fader.value);strip.querySelector<HTMLOutputElement>("output")!.value=`${Math.round(requested*100)}%`;const previous=mixerCommandTimers.get(channel.index);if(previous)clearTimeout(previous);mixerCommandTimers.set(channel.index,window.setTimeout(()=>{const active=liveState.mixer.channels[channel.index];void liveCommand({action:"mixer-channel",index:active.index,gain:requested,muted:active.muted,solo:active.solo,iem:active.iem});},30));};
    }
  }
  for(const channel of mixer.channels){
    const legacyStrip=container.querySelector<HTMLElement>(`[data-mixer-index="${channel.index}"]`)!;
    if(!legacyStrip)continue;
    legacyStrip.querySelector<HTMLButtonElement>('[data-mixer-switch="muted"]')?.classList.toggle("active",channel.muted);
    legacyStrip.querySelector<HTMLButtonElement>('[data-mixer-switch="solo"]')?.classList.toggle("active",channel.solo);
    legacyStrip.querySelector<HTMLButtonElement>('[data-mixer-switch="iem"]')?.classList.toggle("active",channel.iem);
    legacyStrip.classList.toggle("muted",channel.muted);
    const fader=legacyStrip.querySelector<HTMLInputElement>("[data-mixer-fader]")!;
    const output=legacyStrip.querySelector<HTMLOutputElement>("output")!;
    if(fader&&output&&document.activeElement!==fader){fader.value=String(channel.gain);output.value=`${Math.round(channel.gain*100)}%`;}
  }
  const iemReady=Boolean(data.audio.iemReady);$("#mixerIemStatus").textContent=iemReady?"IEM SEND - PB_IEM OUTPUT 3 READY":`IEM SEND ARMED - ${data.audio.outputChannels??0} OUTPUT DEVICE`;$("#performanceMixer").classList.toggle("iem-unavailable",!iemReady);
}

function updateMixerMeters(meters:{master:number;channels:readonly number[]}){setMeter(document.querySelector<HTMLElement>("[data-meter-master]"),document.querySelector<HTMLElement>("[data-meter-master-readout]"),meters.master);for(const group of performanceMeterGroups){const value=Math.max(0,...group.indices.map(index=>Number(meters.channels[index])||0));setMeter(document.querySelector<HTMLElement>(`[data-meter-channel="${group.id}"]`),document.querySelector<HTMLElement>(`[data-meter-readout="${group.id}"]`),value);}meters.channels.forEach((value,index)=>{document.querySelectorAll<HTMLElement>(`[data-editor-meter-channel="${index}"]`).forEach((meter)=>setHorizontalMeter(meter,value));document.querySelectorAll<HTMLElement>(`[data-editor-vertical-meter-channel="${index}"]`).forEach((meter)=>setVerticalMeter(meter,value));});}
function setMeter(fill:HTMLElement|null,readout:HTMLElement|null,amplitude:number){if(!fill||!readout)return;const safe=Math.max(0,Number(amplitude)||0),db=safe>0?20*Math.log10(safe):-Infinity,percent=Number.isFinite(db)?Math.max(0,Math.min(100,(db+60)/66*100)):0;fill.style.height=`${percent}%`;fill.classList.toggle("hot",db>=-6);readout.textContent=Number.isFinite(db)?`${Math.max(-60,db).toFixed(0)}`:"−∞";}
function setVerticalMeter(fill:HTMLElement,amplitude:number){const safe=Math.max(0,Number(amplitude)||0),db=safe>0?20*Math.log10(safe):-Infinity,percent=Number.isFinite(db)?Math.max(0,Math.min(100,(db+60)/66*100)):0;fill.style.height=`${percent}%`;fill.classList.toggle("hot",db>=-6);}
function setHorizontalMeter(fill:HTMLElement,amplitude:number){const safe=Math.max(0,Number(amplitude)||0),db=safe>0?20*Math.log10(safe):-Infinity,percent=Number.isFinite(db)?Math.max(0,Math.min(100,(db+60)/66*100)):0;fill.style.width=`${percent}%`;fill.classList.toggle("hot",db>=-6);}

function renderPerformanceReadiness(report: any) {
  if (!report) return;
  const badge = $("#ready"), blocked = report.checks.filter((item: any) => item.level === "blocked").length, warnings = report.checks.filter((item: any) => item.level === "warning").length;
  badge.className = `ready ${report.status === "Blocked" ? "blocked" : report.status === "Ready with warnings" ? "warning" : ""}`;
  badge.textContent = report.status === "Blocked" ? `PERFORMANCE LOCKED · ${blocked}` : report.status === "Ready with warnings" ? `READY · ${warnings} WARNING${warnings === 1 ? "" : "S"}` : "PERFORMANCE READY";
  const audioProblem=audioHealth&&!audioHealthIsHealthy();
  if(report.status!=="Blocked"&&audioProblem)badge.textContent="READY · AUDIO CHECK";else if(report.status!=="Blocked"&&report.status!=="Ready with warnings"&&audioHealth)badge.textContent="PERFORMANCE READY · AUDIO OK";
  badge.classList.toggle("audio-warning",Boolean(audioProblem));badge.title=audioHealth?audioHealthSummary():"Audio health is starting";
  $("#performanceReadinessTitle").textContent = report.status.toUpperCase();
  const checks = $("#performanceReadinessChecks"); checks.replaceChildren();
  for (const item of report.checks) { const row = document.createElement("section"); row.className = `performance-readiness-check ${item.level}`; row.innerHTML = `<i></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>`; checks.append(row); }
  const faulted = Boolean(liveState.fault);
  if (faulted) { badge.classList.add("blocked"); badge.textContent = "PERFORMANCE LOCKED - ENGINE FAULT"; }
  const noLoadedSong=editMode?!workspace:String(song?.song?.id)==="__playback_empty__";
  const locked = noLoadedSong || ((!report.ready || faulted) && !editMode);
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("#liveControls button, #liveControls input, #performanceMixer button, #performanceMixer input, #play, #pause, #pad, #slidesMidi, #surfaceMidi")) if (control.id !== "clearFault"&&control.id!=="mixerCollapse") control.disabled = locked;
  $("#performanceWorkspace").classList.toggle("performance-locked", locked);
}

function audioHealthIsHealthy(){return Boolean(audioHealth)&&audioHealth.sampleRate===48000&&audioHealth.blockFrames===512&&audioHealth.xruns===0&&audioHealth.deadlineMisses===0&&!audioHealth.deviceError&&!audioHealthStalled&&!audioHealth.iemClips;}
function audioHealthSummary(){if(!audioHealth)return liveState.fault?`FAULT · ${liveState.fault}`:liveState.readiness?.ready?"ARMED · CHECKING AUDIO":"NOT READY";if(audioHealthIsHealthy())return"AUDIO OK · 48 kHz · 512";const issues:string[]=[];if(audioHealth.sampleRate!==48000)issues.push(`${audioHealth.sampleRate||0} Hz`);if(audioHealth.blockFrames!==512)issues.push(`${audioHealth.blockFrames||0} samples`);if(audioHealth.xruns)issues.push(`${audioHealth.xruns} dropout${audioHealth.xruns===1?"":"s"}`);if(audioHealth.deadlineMisses)issues.push(`${audioHealth.deadlineMisses} overrun${audioHealth.deadlineMisses===1?"":"s"}`);if(audioHealthStalled)issues.push("clock stopped");if(audioHealth.deviceError)issues.push("device error");if(audioHealth.iemClips)issues.push("PB_IEM overload");return`AUDIO CHECK · ${issues.join(" · ")||"unknown"}`;}

async function liveCommand(command: any) { try { const state=await window.playback.performance.command(command);if(state.songIndex!==activeSongIndex){await synchronizePerformanceSong(state.songIndex,state);return;}liveState=state;renderLiveState(); } catch (error) { showError(error); } }
function navigateSection(offset: number) { if (!liveState.panicActive) { void liveCommand({ action: offset < 0 ? "previous-section" : "next-section" }); return; } const anchor = liveState.recoveryRegionId ?? liveState.currentRegionId; const index = song.regions.findIndex((item: any) => item.id === anchor); const target = song.regions[Math.max(0, Math.min(song.regions.length - 1, index + offset))]; if (target) void liveCommand({ action: "recover", regionId: target.id }); }
function moveSelected(offset: number) { const index = workspace.draft.sections.findIndex((item: any) => item.id === selectedRegionId); const destination = index + offset; if (destination >= 0 && destination < workspace.draft.sections.length) void arrange({ type: "move-section", sectionId: selectedRegionId, toIndex: destination }); }
function renderEditorTimelineAtTransport(){renderEditorTimeline();const scroll=$("#editorTimelineScroll"),ratio=workspace?.draft.durationSeconds?Math.max(0,Math.min(1,currentPosition/workspace.draft.durationSeconds)):0;scroll.scrollLeft=Math.max(0,Math.min(scroll.scrollWidth-scroll.clientWidth,ratio*scroll.scrollWidth-scroll.clientWidth/2));}
function stepEditorWidth(amount: number) { const control = $("#editorZoom") as HTMLInputElement; control.value = String(Math.max(Number(control.min), Math.min(Number(control.max), Number(control.value) + amount))); localStorage.setItem("playback.editor.zoom", control.value); renderEditorTimelineAtTransport(); }
function stepStemHeight(amount: number) { stemRowHeight = Math.max(58, Math.min(240, stemRowHeight + amount)); localStorage.setItem("playback.editor.stemHeight.v2", String(stemRowHeight)); renderEditorTimeline(); }
function selectRegion(id: string) { selectedRegionId = id; renderRegionList(); renderSelectedInspector(); renderEditorTimeline(); }
function selectRelative(offset: number) { const index = workspace.draft.sections.findIndex((section: any) => section.id === selectedRegionId); const target = workspace.draft.sections[Math.max(0, Math.min(workspace.draft.sections.length - 1, index + offset))]; if (target) selectRegion(target.id); }
function selectedSection() { return workspace?.draft.sections.find((section: any) => section.id === selectedRegionId); }
function selectedCue() { return workspace?.draft.cues.find((cue: any) => cue.targetRegionId === selectedRegionId); }
function sectionById(id: string) { return workspace?.draft.sections.find((section: any) => section.id === id); }
function gridEntryPosition(value: string) {
  const match = value.trim().match(/^(\d+)[.:](\d+)$/);
  if (!match) throw new Error("Enter a musical position as Measure.Beat, for example 12.1");
  const measure = Number(match[1]), beat = Number(match[2]), meter = workspace.draft.timeSignature;
  if (measure < 1 || beat < 1 || beat > meter.numerator) throw new Error(`Beat must be between 1 and ${meter.numerator}`);
  const position = { measure, beat, tick: 0 }, finalPosition=workspace.draft.sections.at(-1)?.endPosition;
  if (!finalPosition || positionToGridBeats(position,meter)>positionToGridBeats(finalPosition,meter)) throw new Error("That musical position is outside this arrangement");
  return position;
}
function commitRegionBoundary(edge: "start" | "end") {
  const input = $(`#section${edge === "start" ? "Start" : "End"}`) as HTMLInputElement;
  try { void arrange({ type: "set-section-boundary", sectionId: selectedRegionId, edge, atPosition: gridEntryPosition(input.value) }); }
  catch (error) { showError(error); renderSelectedInspector(); }
}
function commitCuePosition() {
  const cue = selectedCue(); if (!cue) return;
  try { void arrange({ type: "set-cue-time", cueId: cue.id, atPosition: gridEntryPosition(($("#cuePosition") as HTMLInputElement).value) }); }
  catch (error) { showError(error); renderSelectedInspector(); }
}
function createRegionFromSelection() { if (selectionStart === null || selectionEnd === null || selectionEnd <= selectionStart) { setEditorStatus("Drag a selection inside one source section first."); return; } const name = prompt("New region name", "New Section"); if (name) void arrange({ type: "create-region-from-selection", startPosition: editorPosition(selectionStart), endPosition: editorPosition(selectionEnd), name }); }
function auditionSelectedSource() { const section = selectedSection(); if (!section) return; loopAuditionRegionId = null; $("#loopAudition").classList.remove("active"); window.playback.command("seek", section.sourceStartSeconds); window.playback.command("play"); setEditorStatus(`Auditioning source audio for ${section.name}. Render the arrangement to hear reordered boundaries exactly.`); }
function toggleLoopAudition() { const section = selectedSection(); if (!section) return; loopAuditionRegionId = loopAuditionRegionId === section.id ? null : section.id; $("#loopAudition").classList.toggle("active", loopAuditionRegionId !== null); if (loopAuditionRegionId) { window.playback.command("seek", section.sourceStartSeconds); window.playback.command("play"); setEditorStatus(`Looping the source slice for ${section.name}.`); } else setEditorStatus("Source audition loop released."); }
function auditionSelectedBoundary() { const section = selectedSection(); if (!section) return; const index = workspace.draft.sections.findIndex((item: any) => item.id === section.id), next = workspace.draft.sections[index + 1]; if (!next) { setEditorStatus("The selected region is the end of the arrangement."); return; } if (Math.abs(section.sourceEndSeconds - next.sourceStartSeconds) > .01) { setEditorStatus("This boundary is reordered. Render the arrangement to audition that exact transition."); return; } loopAuditionRegionId = null; window.playback.command("seek", Math.max(section.sourceStartSeconds, section.sourceEndSeconds - 2)); window.playback.command("play"); setEditorStatus(`Auditioning the ${section.name} → ${next.name} boundary.`); }
function editorGrid() { return buildZeroBasedGrid(workspace.draft.selectedBpm, workspace.draft.timeSignature, workspace.draft.durationSeconds); }
function snapToGrid(at: number) { return snapEditorPosition(editorGrid(), at, editorSnapMode); }
function editorPosition(at: number) { return secondsToMusicalPosition(snapToGrid(at), workspace.draft.selectedBpm, workspace.draft.timeSignature); }
function setEditorSnapMode(mode: EditorSnapMode) {
  editorSnapMode = mode;
  localStorage.setItem("playback.editor.snap", mode);
  currentPosition = snapToGrid(currentPosition);
  if (selectionStart !== null) selectionStart = snapToGrid(selectionStart);
  if (selectionEnd !== null) selectionEnd = snapToGrid(selectionEnd);
  window.playback.command("seek", currentPosition);
  renderEditorSnapMode();
  updateSelectionOverlay();
}
function renderEditorSnapMode() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("#editorSnap [data-snap]")) button.classList.toggle("active", button.dataset.snap === editorSnapMode);
  const snap = $("#editorSnap");
  snap.title = editorSnapMode === "measure" ? "Playhead and selections snap to measure boundaries" : "Playhead and selections snap to beats";
}
function measureLength(section: any) { const beats = (section.endSeconds - section.startSeconds) / ((60 / workspace.draft.selectedBpm) * (4 / workspace.draft.timeSignature.denominator)); return Math.max(0.01, beats / workspace.draft.timeSignature.numerator).toFixed(2).replace(/\.00$/, ""); }
function regionClass(name: string) {
  const value = name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (value.includes("pre chorus") || value.includes("prechorus")) return "pre-chorus";
  if (value.includes("chorus")) return "chorus";
  if (value.includes("verse")) return "verse";
  if (value.includes("bridge")) return "bridge";
  if (value.includes("instrumental")) return "instrumental";
  if (value.includes("turnaround")) return "turnaround";
  if (value.includes("interlude") || value.includes("breakdown")) return "interlude";
  if (value.includes("vamp")) return "vamp";
  if (value.includes("outro")) return "outro";
  if (value.includes("ending") || value === "end") return "ending";
  if (value.includes("intro") || value === "start") return "intro";
  if (value.includes("tag")) return "tag";
  if (value.includes("blank")) return "blank";
  if (value.includes("title")) return "title";
  return "other";
}
function midiKind(status: number, data2: number) { const kind = status & 240; return kind === 144 && data2 > 0 ? "NOTE ON" : kind === 128 || kind === 144 ? "NOTE OFF" : kind === 176 ? "CONTROL" : "MIDI"; }
function drawWaveform(canvas: HTMLCanvasElement,buckets:readonly any[],color:string){
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height){canvas.width=0;canvas.height=0;return;}canvas.width=Math.ceil(rect.width*devicePixelRatio);canvas.height=Math.ceil(rect.height*devicePixelRatio);const context=canvas.getContext("2d")!;context.scale(devicePixelRatio,devicePixelRatio);context.clearRect(0,0,rect.width,rect.height);if(!buckets.length)return;
  const performanceWaveform=canvas.id==="wave"||canvas.id==="waveProgress",magnitudes=performanceWaveform?buckets.map((bucket:any)=>Math.max(Math.abs(Number(bucket.min)||0),Math.abs(Number(bucket.max)||0))).sort((a:number,b:number)=>a-b):[],reference=performanceWaveform?magnitudes[Math.min(magnitudes.length-1,Math.floor(magnitudes.length*.985))]??1:1,visualGain=performanceWaveform?Math.max(1,Math.min(12,.92/Math.max(.02,reference))):1,mid=rect.height/2,verticalScale=performanceWaveform ? .485 : .86,shape=(value:number)=>{const normalized=Math.min(1,Math.abs(value)*visualGain),defined=performanceWaveform?Math.pow(normalized,.76):normalized;return Math.sign(value)*defined;};
  context.strokeStyle=color;context.globalAlpha=performanceWaveform ? .16 : .18;context.lineWidth=performanceWaveform?3:2;context.beginPath();for(const[index,bucket]of buckets.entries()){const x=(index/buckets.length)*rect.width;context.moveTo(x,mid+shape(bucket.min)*mid*verticalScale);context.lineTo(x,mid+shape(bucket.max)*mid*verticalScale);}context.stroke();
  context.globalAlpha=performanceWaveform ? .96 : .85;context.lineWidth=performanceWaveform?Math.max(1.1,rect.width/buckets.length):1;context.shadowColor=performanceWaveform?color:"transparent";context.shadowBlur=performanceWaveform?2:0;context.beginPath();for(const[index,bucket]of buckets.entries()){const x=(index/buckets.length)*rect.width;context.moveTo(x,mid+shape(bucket.min)*mid*verticalScale);context.lineTo(x,mid+shape(bucket.max)*mid*verticalScale);}context.stroke();context.shadowBlur=0;
  if(performanceWaveform){context.globalAlpha=.2;context.lineWidth=1;context.beginPath();context.moveTo(0,Math.round(mid)+.5);context.lineTo(rect.width,Math.round(mid)+.5);context.stroke();}
}
function formatTime(seconds: number) { const minutes = Math.floor(seconds / 60); return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`; }
function formatGridLocation(seconds: number, grid: readonly any[]) { if (!grid.length) return "1.1"; const closest = grid.reduce((best: any, item: any) => Math.abs(item.timeSeconds - seconds) < Math.abs(best.timeSeconds - seconds) ? item : best); return `${closest.measure}.${closest.beat}`; }
function formatMusicalLocation(position:any,fallbackSeconds:number){return position?`${position.measure}.${position.beat}${position.tick?`+${position.tick}`:""}`:formatGridLocation(fallbackSeconds,editorGrid());}
function stemColor(label: string, role = "") {
  const value = `${label} ${role}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(acoustic|acous|ag)\b/.test(value)) return "#63d8ff";
  if (/\b(electric|elec|eg)\s*\d*\b/.test(value) || /\bguitar\b/.test(value)) return "#b69cff";
  if (/\bbass\b/.test(value)) return "#74efb8";
  if (/\b(piano|keys?|organ|rhodes|synth)\b/.test(value)) return "#84a9ff";
  if (/\b(strings?|violin|viola|cello)\b/.test(value)) return "#64e0d2";
  if (/\b(drums?|kick|snare|tom|toms|cymbal|loop|loops|perc|percussion|shaker|tambourine|clap)\b/.test(value)) return "#ff9b71";
  if (/\b(vocals?|bgv|bgvs|choir|alto|tenor|soprano|lead vocal)\b/.test(value)) return "#ff78b3";
  if (/\bpad\b/.test(value)) return "#d6b25e";
  return "#9fb4bf";
}
function setEditorStatus(message: string) { $("#editorStatus").textContent = message; }
function showError(error: unknown) { const message = error instanceof Error ? error.message : String(error); if (editMode) setEditorStatus(message); else { const fault = $("#liveFault"); fault.hidden = false; fault.querySelector("span")!.textContent = message; } }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }


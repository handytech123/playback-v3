import "./style.css";
import "./mode.css";
import { buildZeroBasedGrid } from "../domain/grid.js";
import { keyboardAction } from "../live/performance-session.js";
import { snapEditorPosition, type EditorSnapMode } from "../edit/editor-snap.js";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
<main>
  <nav>
    <div class="modes"><button id="prepMode" hidden>PREP / SETLIST</button><button id="editMode">EDIT / ARRANGE</button><button id="performanceMode" class="active">PERFORMANCE</button></div>
    <div class="arrangement-tools"><button id="remoteControl" class="settings-menu-button" title="Playback settings">⚙ SETTINGS</button></div>
    <div class="setlist"><button id="previousSong">‹</button><span>SET 01</span><strong>Loading…</strong><small>Original Song</small><button id="nextSong">›</button></div>
  </nav>
  <header class="app-heading"><div><span id="modeLabel" class="eyebrow">PERFORMANCE MODE · CONFIRMED SET</span><h1 id="title">Loading…</h1><p id="facts"></p></div><section class="transport"><div class="transport-buttons"><button id="stop" aria-label="Stop">■</button><button id="play" class="primary" aria-label="Play">▶</button><button id="pause" aria-label="Pause">Ⅱ</button><button id="pad">PAD</button><button id="panic" class="panic">PANIC</button></div><div class="transport-clock"><span>ELAPSED / REMAINING</span><strong id="clock">0:00.000 / -0:00.000</strong><small id="position">1.1</small></div></section><button id="ready" class="ready">ARMING</button></header>
  <section id="prepWorkspace" class="prep-workspace" hidden>
    <div class="prep-toolbar"><div><span class="eyebrow">LIBRARY / PREPARATION LANE</span><h2>Build The Confirmed Set</h2><p>Scan production metadata, choose prepared versions, order the set, then freeze one isolated performance package.</p></div><button id="scanLibrary">SCAN MASTER LIBRARY</button></div>
    <div class="prep-summary" id="librarySummary"><span>Library scan has not run in this session.</span></div>
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
    <section class="editor-setlist-toolbar"><label>SET NAME<input id="editorSetlistName" value="Sunday Set"></label><span id="editorSetlistStatus">Loading draft set…</span><button id="editorRefreshLibrary">REFRESH LIBRARY</button><button id="editorConfirmSet" class="primary">CONFIRM + LOAD SET</button></section>
    <section id="editorSongVersions" class="editor-song-versions" hidden><div><span>SELECTED SONG</span><strong id="selectedSetSong">—</strong></div><label>ARRANGEMENT<select id="editorArrangementVersion"></select></label><button id="editorCreateArrangement">+ CREATE NEW ARRANGEMENT</button></section>
    <div class="editor-topbar">
      <div class="editor-info-row">
      <div><span class="eyebrow">ARRANGEMENT NAME</span><strong id="editorSelectedArrangementName">Loading…</strong><small id="editorVersion" hidden></small><span id="editorSource" hidden></span></div>
      <label class="editor-top-field">KEY<input id="arrangementKey"></label>
      <label class="editor-top-field">BPM<input id="arrangementBpm" type="number" min="1" step=".01"></label>
      <span class="editor-top-fact"><small>ORIGINAL</small><strong id="originalFacts"></strong></span>
      <span class="editor-top-fact"><small>TIME / DURATION</small><strong id="arrangementDuration"></strong></span>
      <span id="draftState" class="draft-state">LOADING</span>
      </div>
      <div class="editor-view-row">
        <div class="view-toggle"><button id="summaryView" class="active">SUMMARY</button><button id="stemsView">EXPANDED STEMS</button></div>
        <label class="zoom-control">ZOOM <input id="editorZoom" type="range" min="1" max="6" step=".25" value="1"></label>
        <div id="editorSnap" class="transport-snap" hidden><span>SNAP</span><button data-snap="beat">BEAT</button><button data-snap="measure">MEASURE</button></div>
      </div>
    </div>
    <div class="editor-grid">
      <aside class="region-browser"><header><div><h2>ARRANGEMENT ORDER</h2><small>DRAG REGIONS TO REORDER</small></div><button id="newRegion">+ FROM SELECTION</button></header><div id="regionList"></div></aside>
      <section class="editor-stage">
        <div class="editor-timeline-shell"><div id="stemLabelGutter" class="stem-label-gutter" hidden><div id="stemLabelItems"></div></div><div id="editorTimelineScroll" class="editor-timeline-scroll"><div id="editorTimeline" class="editor-timeline">
          <div id="editorGridLines" class="editor-grid-lines"></div><div id="editorBoundaryLines" class="editor-boundary-lines"></div><div id="editorRuler" class="editor-ruler"></div><div id="editorCueLane" class="marker-lane cue-lane"><span>CUES</span></div><div id="editorMidiLane" class="marker-lane midi-lane"><span>SLIDES</span></div><div id="editorRegionLane" class="editor-region-lane"></div>
          <div id="summaryWaveform" class="summary-waveform"><canvas></canvas></div><div id="stemWaveforms" class="stem-waveforms" hidden></div>
          <div id="editorSelection" class="editor-selection" hidden></div><div id="editorPlayhead" class="playhead"></div>
        </div></div></div>
        <div class="editor-selection-readout"><strong id="playheadLocation">1.1</strong><span id="selectionLocation">Drag in the waveform to create a grid-aligned selection.</span></div><div id="expandedSizeControls" class="editor-corner-controls" hidden><span class="width-adjust"><b>WIDTH</b><button id="widthDown" title="Decrease timeline width">−</button><button id="widthUp" title="Increase timeline width">+</button></span><span class="height-adjust"><b>HEIGHT</b><button id="heightDown" title="Decrease stem height">−</button><button id="heightUp" title="Increase stem height">+</button></span></div>
      </section>
      <aside class="editor-inspector">
        <section><h2>Selected Region</h2><label>Name<input id="sectionName"></label><div class="field-pair"><label>Start<input id="sectionStart" readonly></label><label>End<input id="sectionEnd" readonly></label></div><p id="sectionSource"></p><div class="button-grid"><button id="selectPrevious">SELECT ←</button><button id="selectNext">SELECT →</button><button id="moveEarlier">MOVE ←</button><button id="moveLater">MOVE →</button><button id="duplicateRegion">DUPLICATE</button><button id="splitRegion">SPLIT AT PLAYHEAD</button><button id="deleteRegion" class="danger">REMOVE + CLOSE GAP</button><button id="auditionRegion">AUDITION SOURCE</button><button id="loopAudition">LOOP SOURCE</button><button id="auditionBoundary">AUDITION BOUNDARY</button><button id="trimStart">TRIM START HERE</button><button id="trimEnd">TRIM END HERE</button></div></section>
        <section><h2>Destination Cue</h2><label class="check"><input id="cueEnabled" type="checkbox"> Enabled</label><label>Destination<select id="cueTarget"></select></label><button id="auditionArrangementCue">AUDITION CUE</button><p id="cueDetail"></p></section>
        <section><h2>Slides MIDI</h2><div id="midiEvents" class="midi-events"></div></section>
        <section><h2>Readiness</h2><div id="readinessSummary"></div><div id="readinessChecks"></div></section>
        <section class="editor-actions"><div class="button-grid"><button id="arrangementUndo">UNDO</button><button id="arrangementRedo">REDO</button><button id="saveDraft">SAVE DRAFT</button><button id="revertDraft">REVERT</button></div><button id="saveArrangement" class="save-arrangement">RENDER + SAVE NEW ARRANGEMENT</button><p id="editorStatus">Original Song remains unchanged.</p></section>
      </aside>
    </div>
  </section>
  <section id="liveControls">
    <div class="live-section"><button id="previousSection">← PREVIOUS</button><button id="repeatOnce">REPEAT ONCE</button><button id="loopSection">LOOP</button><button id="nextSection">NEXT →</button><button id="cueNextSong">CUE NEXT SONG</button></div>
    <p id="jumpState" hidden><strong>JUMP ARMED</strong><span></span></p><p id="panicState" hidden><strong>MUSICAL RECOVERY</strong><span></span></p><p id="liveFault" hidden><span></span><button id="clearFault">CLEAR FAULT</button></p>
  </section>
  <section id="performanceMixer" class="daw-mixer" aria-label="Live mixer"><div id="mixerResizeHandle" class="mixer-resize-handle" title="Drag to resize mixer"></div><header><div><span>LIVE MIXER</span><strong id="mixerIemStatus">IEM SEND CHECKING</strong></div><button id="mixerCollapse" aria-expanded="true">COLLAPSE</button></header><div id="mixerChannels" class="mixer-channels"></div></section>
</main>
<dialog id="reaperImport"><h2>Reaper Arrangement Import</h2><div id="importSummary"></div><div id="importDifferences"></div><p id="importWarning"></p><footer><button data-action="cancel">CANCEL</button><button data-action="replace">REPLACE SELECTED ARRANGEMENT</button><button data-action="new" class="primary">IMPORT AS NEW VERSION</button></footer></dialog>
<dialog id="performanceReadiness"><header><div><span class="eyebrow">PRODUCTION PERFORMANCE READINESS</span><h2 id="performanceReadinessTitle">Checking…</h2></div><button id="closePerformanceReadiness">CLOSE</button></header><div id="performanceReadinessChecks"></div></dialog>
<dialog id="songLibraryPicker" class="song-library-picker"><header><div><span class="eyebrow">ADD TO SET</span><h2>Prepared Song Library</h2></div><button id="closeSongLibrary">CLOSE</button></header><div class="song-library-filters"><label>SEARCH BY NAME<input id="songLibrarySearch" type="search" placeholder="Song title, artist, arrangement…"></label><label>SPEED<select id="songLibrarySpeed"><option value="all">All tempos</option><option value="slow">Slow · 80 BPM or less</option><option value="medium">Medium · 81–110 BPM</option><option value="fast">Fast · 111 BPM or more</option></select></label></div><div id="songLibraryResults" class="song-library-results"></div></dialog>
<dialog id="remoteSettings" class="settings-window"><header><div><span class="eyebrow">PLAYBACK V3</span><h2>Settings</h2><p id="settingsStatus">Configure the production system without crowding the performance surface.</p></div><button id="closeRemoteSettings">CLOSE</button></header><nav class="settings-tabs" aria-label="Settings sections"><button class="active" data-settings-tab="general">GENERAL</button><button data-settings-tab="audio">AUDIO</button><button data-settings-tab="midi">MIDI / SLIDES</button><button data-settings-tab="import">LIBRARY / ANALYSIS</button><button data-settings-tab="control">REMOTE / CONTROL</button><button data-settings-tab="system">SYSTEM CHECK</button></nav><div class="settings-pages">
  <section class="settings-page active" data-settings-page="general"><div class="settings-section-heading"><span>ACTIVE PLAYBACK</span><h3>Arrangement and production status</h3></div><div class="settings-grid"><label class="settings-wide">Prepared Arrangement<select id="arrangementSelect" title="Arrangement"></select></label><div class="settings-readout"><span>Song</span><strong id="settingsSongName">—</strong></div><div class="settings-readout"><span>Performance Package</span><strong id="settingsPackageStatus">—</strong></div><div class="settings-readout"><span>Cache</span><strong>CONFIRMED SET · LOCAL</strong></div></div></section>
  <section class="settings-page" data-settings-page="audio"><div class="settings-section-heading"><span>AUDIO ENGINE</span><h3>Device, routing, and output health</h3></div><div class="settings-grid"><label class="settings-wide">Audio Device<select id="audioSelect" title="Audio output"></select></label><div class="settings-readout"><span>Routing</span><strong id="routeStatus"></strong></div><div class="settings-readout"><span>IEM Outputs</span><strong id="settingsIemStatus">—</strong></div><button id="refreshAudioSettings">REFRESH DEVICE STATUS</button><button id="runAudioCheck">RUN AUDIO ERROR CHECK</button><div class="settings-section-heading settings-wide"><span>DANTE OUTPUT MATRIX</span><h3>Assign stems and live buses to outputs 1–32</h3></div><div id="outputMatrix" class="settings-grid settings-wide"></div><div id="audioCheckReport" class="settings-report settings-wide">Select Run Audio Error Check for a live readiness report.</div></div></section>
  <section class="settings-page" data-settings-page="midi"><div class="settings-section-heading"><span>PROPRESENTER</span><h3>Slides MIDI output</h3></div><div class="settings-grid"><label class="settings-wide">ProPresenter MIDI Output<select id="midiSelect" title="ProPresenter MIDI output"></select></label><div class="settings-readout"><span>Output Status</span><strong id="midiStatus"></strong></div><div class="settings-readout"><span>Loaded Slide Events</span><strong id="settingsMidiEvents">—</strong></div><p class="settings-help settings-wide">Reaper MIDI is imported only from a track named Slides. The selected output is saved and the native engine is re-armed when it changes.</p></div></section>
  <section class="settings-page" data-settings-page="import"><div class="settings-section-heading"><span>LIBRARY / ANALYSIS</span><h3>Synchronization and analyzer activity</h3></div><div class="library-health-grid"><div class="library-health"><span>LIBRARY SYNC</span><strong id="librarySyncState">IDLE</strong><small id="librarySyncDetail">Not running</small></div><div class="library-health"><span>ANALYZER</span><strong id="libraryAnalyzerState">IDLE</strong><small id="libraryAnalyzerDetail">Waiting for a scan</small></div><div class="library-health"><span>READY SONGS</span><strong id="libraryReadyCount">—</strong><small>Analyzer files complete</small></div><div class="library-health"><span>NEEDS ANALYSIS</span><strong id="libraryNeedsCount">—</strong><small>Missing analyzer output</small></div><div class="library-health"><span>MISSING FOLDERS</span><strong id="libraryMissingCount">—</strong><small>Master path unavailable</small></div><div class="library-health"><span>LAST SCAN</span><strong id="libraryLastScan">NEVER</strong><small id="libraryLastDuration">No completed scan</small></div></div><div class="library-paths"><label>Library Root<input id="libraryRootPath" readonly></label><label>Master Workbook<input id="libraryWorkbookPath" readonly></label></div><div class="settings-action-list"><button id="settingsScanLibrary"><strong>SYNC + CHECK ANALYZER</strong><small>Read the master workbook, scan every song folder, and verify analyzer metadata.</small></button><button id="settingsRefreshLibrary"><strong>REFRESH PREPARED LIBRARY</strong><small>Reload prepared Original Songs and arrangements available to the set builder.</small></button><button id="importReaper"><strong>IMPORT REAPER ARRANGEMENT</strong><small>Preview regions, tempo/key changes, and Slides MIDI before writing.</small></button></div><div id="settingsSyncStatus" class="settings-report">No library task is running.</div><div id="libraryIssueList" class="library-issue-list"><p>Run Sync + Check Analyzer to see song readiness.</p></div></section>
  <section class="settings-page" data-settings-page="control"><div class="settings-section-heading"><span>STAGE CONTROL</span><h3>Remote, OSC, MIDI input, and console</h3></div><div class="remote-settings"><p id="remoteStatus"></p><label>Remote URL · private<input id="remoteUrl" type="password" readonly></label><div class="remote-buttons"><button id="copyRemoteUrl">COPY PRIVATE LINK</button><button id="toggleLanRemote">ENABLE LAN</button><button id="toggleOsc">OSC ON</button></div><dl><div><dt>HTTP</dt><dd id="remoteHttp">—</dd></div><div><dt>OSC</dt><dd id="remoteOsc">—</dd></div></dl><section class="midi-input-settings"><h3>Foot Controller / MIDI Input</h3><div><label>Input<select id="midiInputDevice"></select></label><label>Profile<select id="footControllerProfile"><option value="disabled">Disabled</option><option value="basic-notes">Basic Notes · CH 1 · 20–26</option></select></label><button id="applyMidiInput">APPLY + ARM</button></div><p id="midiInputStatus">MIDI input is disabled.</p></section><section class="midi-input-settings"><h3>Allen &amp; Heath GLD-112 · Dedicated MIDI Output</h3><div><label>Output<select id="gldMidiOutput"></select></label><label>MIDI Channel<input id="gldChannel" type="number" min="1" max="16" value="2"></label><button id="testGld">TEST DEVICE · NO DATA</button></div><div class="gld-preview"><button id="previewGld">PREVIEW INPUT 1 MUTE</button><code id="gldHex">Writes locked</code></div><p id="gldStatus">The device-open test sends no MIDI data. Console writes remain locked pending physical acceptance.</p></section><p class="remote-warning">LAN access requires the private token in the link. OSC on LAN also requires the token as the first OSC argument. Audio continues if a control adapter fails.</p></div></section>
  <section class="settings-page" data-settings-page="system"><div class="settings-section-heading"><span>DIAGNOSTICS</span><h3>Production readiness and error check</h3></div><div class="settings-grid"><button id="runSystemCheck">RUN FULL ERROR CHECK</button><button id="openReadinessDetails">OPEN READINESS DETAILS</button><div class="settings-readout"><span>Native Engine</span><strong id="settingsEngineStatus">—</strong></div><div class="settings-readout"><span>Current Set</span><strong id="settingsSetStatus">—</strong></div><div id="systemCheckReport" class="settings-report settings-wide">The full check validates the confirmed package, cache isolation, native engine, routing, MIDI, and next-song preload.</div></div></section>
</div></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const data = await window.playback.bootstrap();
const song = data.manifest.songs[data.activeSongIndex ?? 0];
let liveState = data.performance;
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
let editorLoading: Promise<void> | null = null;
let loopAuditionRegionId: string | null = null;
let stemRowHeight = Math.max(38, Math.min(194, Number(localStorage.getItem("playback.editor.stemHeight")) || 86));
let editorSnapMode: EditorSnapMode = localStorage.getItem("playback.editor.snap") === "measure" ? "measure" : "beat";
let mixerRenderSignature = "";
type SetTransitionType = "cue-next" | "crossfade" | "stay";
const transitionLabels:Record<SetTransitionType,{label:string;detail:string}>={
  "cue-next":{label:"CUE NEXT",detail:"PAD → NEXT"},
  crossfade:{label:"CROSSFADE",detail:"PAD → NEXT"},
  stay:{label:"STAY",detail:"PAD OFF"},
};
const transitionStorageKey=`playback.set-transitions.${data.manifest.id}`;
let setTransitions=loadSetTransitions();
const mixerCommandTimers = new Map<number,number>();
const storedEditorZoom = Number(localStorage.getItem("playback.editor.zoom"));
if (storedEditorZoom >= 1 && storedEditorZoom <= 6) ($("#editorZoom") as HTMLInputElement).value = String(storedEditorZoom);
document.body.classList.add("performance-mode");

setupNavigation();
setupDeviceSelectors();
setupRemoteControl();
setupReaperImport();
setupPerformance();
setupEditorControls();
setupPrep();
renderPerformanceTimeline();
renderLiveState();
if(localStorage.getItem("playback.ui.mode")==="edit") await setMode(true);

function setupNavigation() {
  $("#title").textContent = `${song.song.title} — ${song.song.artist}`;
  $("#facts").textContent = `${song.selectedKey} • ${song.selectedBpm} BPM • ${song.timeSignature.numerator}/${song.timeSignature.denominator} • ${song.stems.length} stems`;
  renderPerformanceReadiness(liveState.readiness);
  $("#ready").onclick = () => ($("#performanceReadiness") as HTMLDialogElement).showModal();
  $("#closePerformanceReadiness").onclick = () => ($("#performanceReadiness") as HTMLDialogElement).close();
  $(".setlist strong").textContent = song.song.title;
  $(".setlist small").textContent = song.arrangement?.name ?? "Original Song";
  renderPerformanceSet();
  const index = data.activeSongIndex ?? 0;
  const previous = $("#previousSong") as HTMLButtonElement;
  const next = $("#nextSong") as HTMLButtonElement;
  previous.disabled = index === 0;
  next.disabled = index === data.manifest.songs.length - 1;
  previous.onclick = async () => { previous.disabled=true;await window.playback.set.selectSong(index-1); };
  next.onclick = async () => { next.disabled=true;await window.playback.set.selectSong(index+1); };
  $("#prepMode").onclick = () => void setPrepMode();
  $("#editMode").onclick = () => void setMode(true);
  $("#performanceMode").onclick = () => void setMode(false);
}

function renderPerformanceSet() {
  $("#performanceSetName").textContent = data.manifest.name;
  $("#performanceSongTitle").textContent = song.song.title;
  $("#performanceArrangement").textContent = `${song.arrangement?.name ?? "Original Song"} · ${song.selectedKey} · ${song.selectedBpm} BPM`;
  renderSetStrip($("#performanceSetSongs"));
}

function renderSetStrip(strip:HTMLElement){
  const activeIndex=data.activeSongIndex??0;
  strip.replaceChildren();
  for(let index=0;index<10;index++){
    const setSong=data.manifest.songs[index];
    if(setSong){
      const button=document.createElement("button");button.className=`set-song-card ${index===activeIndex?"active":""}`;
      button.innerHTML=`<span>${String(index+1).padStart(2,"0")}</span><strong>${escapeHtml(setSong.song.title)}</strong><small>${escapeHtml(setSong.selectedKey)} · ${setSong.selectedBpm} BPM</small>`;
      button.title=index===activeIndex?`${setSong.song.title} is selected`:`Load ${setSong.song.title}`;
      button.onclick=async()=>{if(index===activeIndex)return;button.disabled=true;await window.playback.set.selectSong(index);};
      strip.append(button);
    }else{
      const empty=document.createElement("div");empty.className="set-song-card empty";empty.innerHTML=`<span>${String(index+1).padStart(2,"0")}</span><strong>EMPTY</strong><small>NO SONG LOADED</small>`;strip.append(empty);
    }
    if(index<9){
      const loaded=Boolean(data.manifest.songs[index]&&data.manifest.songs[index+1]),transition=document.createElement("label");transition.className=`set-transition ${loaded?"loaded":"empty"}`;
      const selected=setTransitions[index]??"cue-next",definition=transitionLabels[selected];
      transition.innerHTML=`<span>TRANSITION</span><strong>${loaded?definition.label:"—"}</strong><small>${loaded?definition.detail:"EMPTY"}</small>`;
      if(loaded){const select=document.createElement("select");select.title=`Transition from song ${index+1} to song ${index+2}`;for(const[value,label]of [["cue-next","Cue Next"],["crossfade","Crossfade"],["stay","Stay"]])select.add(new Option(label,value,false,value===selected));select.onchange=()=>{setTransitions[index]=select.value as SetTransitionType;localStorage.setItem(transitionStorageKey,JSON.stringify(setTransitions));renderPerformanceSet();};transition.append(select);}
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
  ($<HTMLButtonElement>("#editorConfirmSet")).disabled = items.length === 0;
  for (let index = 0; index < 10; index += 1) {
    const item = items[index];
    if (item) {
      const card = document.createElement("article");
      const activeIndex = data.activeSongIndex ?? 0;
      const loaded = data.manifest.songs[index]?.song.id === item.songId;
      card.className = `set-song-card editor-draft-card ${loaded && index === activeIndex ? "active" : ""} ${item.itemId === selectedSetItemId ? "selected" : ""}`;
      card.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.key)} · ${item.bpm} BPM</small><div class="set-card-actions"><button data-action="up" title="Move earlier">←</button><button data-action="down" title="Move later">→</button><button data-action="remove" title="Remove from set">×</button></div>`;
      card.title = loaded ? `Load ${item.title} for editing` : `${item.title} will load after Confirm Set`;
      card.onclick = async () => { selectedSetItemId = item.itemId; renderEditorSetBuilder(); if (!loaded || index === activeIndex) return; await window.playback.set.selectSong(index); };
      for (const button of card.querySelectorAll<HTMLButtonElement>(".set-card-actions button")) button.onclick = (event) => { event.stopPropagation(); const action = button.dataset.action; void prepCommand(action === "remove" ? { action: "remove", itemId: item.itemId } : { action: "move", itemId: item.itemId, direction: action === "up" ? -1 : 1 }); };
      strip.append(card);
    } else {
      const add = document.createElement("button"); add.className = "set-song-card empty add-song-card";
      add.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>+ ADD SONG</strong><small>SEARCH LIBRARY</small>`;
      add.onclick = () => showSongLibraryPicker(); strip.append(add);
    }
    if (index < 9) {
      const loaded = Boolean(items[index] && items[index + 1]);
      const transition = document.createElement("label"); transition.className = `set-transition ${loaded ? "loaded" : "empty"}`;
      const selected = setTransitions[index] ?? "cue-next", definition = transitionLabels[selected];
      transition.innerHTML = `<span>TRANSITION</span><strong>${loaded ? definition.label : "—"}</strong><small>${loaded ? definition.detail : "EMPTY"}</small>`;
      if (loaded) { const select = document.createElement("select"); select.title = `Transition from song ${index + 1} to song ${index + 2}`; for (const [value, label] of [["cue-next", "Cue Next"], ["crossfade", "Crossfade"], ["stay", "Stay"]]) select.add(new Option(label, value, false, value === selected)); select.onchange = () => { setTransitions[index] = select.value as SetTransitionType; localStorage.setItem(transitionStorageKey, JSON.stringify(setTransitions)); renderEditorSetBuilder(); }; transition.append(select); }
      strip.append(transition);
    }
  }
  renderSelectedSetSongVersions(items);
}

function renderSelectedSetSongVersions(items: any[]) {
  const panel = $("#editorSongVersions"), item = items.find((candidate) => candidate.itemId === selectedSetItemId);
  panel.hidden = !item;
  if (!item) return;
  $("#selectedSetSong").textContent = `${item.title} · ${item.artist}`;
  $("#editorSelectedArrangementName").textContent = item.arrangement;
  const versions = (prepState.prepared as any[]).filter((choice) => choice.songId === item.songId).filter((choice, index, all) => all.findIndex((other) => other.arrangement === choice.arrangement && other.key === choice.key && other.bpm === choice.bpm) === index);
  const select = $<HTMLSelectElement>("#editorArrangementVersion"); select.replaceChildren();
  for (const version of versions) select.add(new Option(`${version.arrangement} · ${version.key} · ${version.bpm} BPM`, version.id, false, version.id === item.id || version.arrangement === item.arrangement && version.key === item.key && version.bpm === item.bpm));
  select.onchange = () => void prepCommand({ action: "replace", itemId: item.itemId, choiceId: select.value });
  $("#editorCreateArrangement").onclick = () => void createNewArrangementForSelected(items.indexOf(item), item);
}

async function createNewArrangementForSelected(index: number, item: any) {
  const original = (prepState.prepared as any[]).find((choice) => choice.songId === item.songId && choice.arrangement === "Original Song");
  if (!original) { $("#editorSetlistStatus").textContent = `${item.title} has no prepared Original Song source.`; return; }
  if (item.id !== original.id) await prepCommand({ action: "replace", itemId: item.itemId, choiceId: original.id });
  localStorage.setItem("playback.ui.mode", "edit");
  localStorage.setItem("playback.editor.createNew", JSON.stringify({ songId: item.songId, name: `${item.title} New Arrangement` }));
  $("#editorSetlistStatus").textContent = `Loading ${item.title} Original Song into a new arrangement…`;
  await window.playback.prep.confirm({ selectedIndex: index });
}

function showSongLibraryPicker() {
  ($<HTMLInputElement>("#songLibrarySearch")).value = ""; ($<HTMLSelectElement>("#songLibrarySpeed")).value = "all";
  renderSongLibraryResults(); ($<HTMLDialogElement>("#songLibraryPicker")).showModal(); ($<HTMLInputElement>("#songLibrarySearch")).focus();
}

function renderSongLibraryResults() {
  const results = $("#songLibraryResults"), search = ($<HTMLInputElement>("#songLibrarySearch")).value.trim().toLowerCase(), speed = ($<HTMLSelectElement>("#songLibrarySpeed")).value;
  const originals = (prepState?.prepared ?? []).filter((choice: any) => choice.arrangement === "Original Song").filter((choice: any, index: number, all: any[]) => all.findIndex((other) => other.songId === choice.songId) === index);
  const choices = originals.filter((choice: any) => { const text = `${choice.title} ${choice.artist}`.toLowerCase(), bpm = Number(choice.bpm), speedMatch = speed === "all" || speed === "slow" && bpm <= 80 || speed === "medium" && bpm >= 81 && bpm <= 110 || speed === "fast" && bpm >= 111; return (!search || text.includes(search)) && speedMatch; });
  results.replaceChildren();
  for (const choice of choices) { const row = document.createElement("button"); row.innerHTML = `<span><strong>${escapeHtml(choice.title)}</strong><small>${escapeHtml(choice.artist)} · ORIGINAL SONG</small></span><b>${escapeHtml(choice.key)} · ${choice.bpm} BPM</b><i>SELECT</i>`; row.onclick = async () => { row.disabled = true; await prepCommand({ action: "add", choiceId: choice.id }); selectedSetItemId = prepState.setlist.items.at(-1)?.itemId ?? null; renderEditorSetBuilder(); ($<HTMLDialogElement>("#songLibraryPicker")).close(); }; results.append(row); }
  if (!choices.length) results.innerHTML = `<p>No prepared songs match this name and speed.</p>`;
}

function loadSetTransitions():SetTransitionType[]{try{const value=JSON.parse(localStorage.getItem(transitionStorageKey)??"[]");return Array.isArray(value)?value.map(item=>item in transitionLabels?item:"cue-next"):[];}catch{return[];}}

function setupDeviceSelectors() {
  const arrangement = $("#arrangementSelect") as HTMLSelectElement;
  for (const version of data.arrangements) arrangement.add(new Option(version.name, version.path, false, version.path === data.selectedManifestPath));
  arrangement.onchange = async () => {
    arrangement.disabled = true;
    if (editMode) localStorage.setItem("playback.ui.mode", "edit");
    await window.playback.arrangements.select(arrangement.value);
  };
  const audio = $("#audioSelect") as HTMLSelectElement;
  audio.add(new Option("Audio · System Default", ""));
  for (const device of data.audio.devices) {
    const selected = data.audio.selectedDevice?.type === device.type && data.audio.selectedDevice?.name === device.name;
    audio.add(new Option(`Audio · ${device.name} · ${device.type}`, JSON.stringify(device), false, selected));
  }
  const route = $("#routeStatus");
  setRouteStatus(data.audio.routingReady, data.audio.outputChannels);
  audio.onchange = async () => {
    audio.disabled = true; route.textContent = "AUDIO ARMING";
    try { const state = await window.playback.audio.setDevice(audio.value ? JSON.parse(audio.value) : null); data.audio={...data.audio,...state};setRouteStatus(state.routingReady, state.outputChannels);renderDawMixer(); }
    catch (error) { route.className = "route-status fault"; route.textContent = "AUDIO FAULT"; showError(error); }
    finally { audio.disabled = false; }
  };
  const renderOutputMatrix=()=>{
    const matrix=$("#outputMatrix");matrix.replaceChildren();
    const fields=[...data.audio.routingLabels.map((label:string,index:number)=>({label,width:data.audio.routing.stemChannels[index],kind:"stem",index,value:data.audio.routing.stems[index]})),{label:"Click",width:1,kind:"click",value:data.audio.routing.click},{label:"Spoken Cues",width:1,kind:"cue",value:data.audio.routing.cue},{label:"Pad",width:1,kind:"pad",value:data.audio.routing.pad},{label:"IEM Send",width:1,kind:"iem",value:data.audio.routing.iem}];
    const grid=document.createElement("div");grid.className="dante-routing-grid";
    const makeRouting=()=>({stems:[...data.audio.routing.stems],stemChannels:[...data.audio.routing.stemChannels],click:data.audio.routing.click,cue:data.audio.routing.cue,pad:data.audio.routing.pad,iem:data.audio.routing.iem});
    const setRoute=(routing:any,field:any,output:number)=>{if(field.kind==="stem")routing.stems[field.index]=output;else routing[field.kind]=output;};
    grid.append(Object.assign(document.createElement("strong"),{textContent:"OUTPUT / BUS"}));
    for(let output=1;output<=32;output++)grid.append(Object.assign(document.createElement("b"),{textContent:String(output)}));
    for(const field of fields){
      const heading=document.createElement("span");heading.innerHTML=`<strong>${escapeHtml(field.label)}</strong>${field.kind==="stem"?`<button class="route-mode">${field.width===2?"STEREO":"MONO"}</button>`:`<small>${field.width===2?"STEREO":"MONO"}</small>`}`;grid.append(heading);
      const mode=heading.querySelector<HTMLButtonElement>(".route-mode");
      if(mode)mode.onclick=async()=>{const routing=makeRouting();routing.stemChannels[field.index!]=field.width===2?1:2;grid.classList.add("busy");try{const state=await window.playback.audio.setRouting(routing);data.audio={...data.audio,...state};$("#settingsStatus").textContent=`${field.label} changed to ${field.width===2?"mono":"stereo"}.`;}catch(error){showError(error);$("#settingsStatus").textContent="Mode change rejected; choose an output pair without a collision.";}renderOutputMatrix();};
      for(let output=1;output<=32;output++){
        const cell=document.createElement("button"),selected=output===field.value||field.width===2&&output===field.value+1;
        cell.className=selected?output===field.value?"assigned start":"assigned linked":"";cell.textContent=selected?"✓":"";cell.title=selected?`Click to remove ${field.label} from this output`:`Assign ${field.label} to Dante ${field.width===2?`${output}–${output+1}`:output}`;cell.disabled=field.width===2&&output===32;
        cell.onclick=async()=>{
          const routing=makeRouting();
          setRoute(routing,field,selected?0:output);
          grid.classList.add("busy");$("#settingsStatus").textContent=selected?`Removing ${field.label} from Dante ${field.value}…`:`Routing ${field.label} to Dante ${output}…`;
          try{const state=await window.playback.audio.setRouting(routing);data.audio={...data.audio,...state};$("#settingsStatus").textContent=selected?`${field.label} is now unassigned.`:`${field.label} is now routed to Dante ${output}. Shared outputs are allowed.`;}catch(error){showError(error);$("#settingsStatus").textContent="That routing selection could not be saved.";}renderOutputMatrix();
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
  function setRouteStatus(ready: boolean, channels: number) { route.className = `route-status ${ready ? "ready" : "fallback"}`; route.textContent = ready ? "6 OUT READY" : `${channels} OUT FALLBACK`; }
  function setMidiStatus(enabled: boolean) { $("#midiStatus").className = `midi-status ${enabled ? "ready" : "disabled"}`; $("#midiStatus").textContent = enabled ? "MIDI READY" : "MIDI OFF"; }
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
    $("#settingsSongName").textContent = `${song.song.title} · ${song.selectedKey} · ${song.selectedBpm} BPM`;
    $("#settingsPackageStatus").textContent = `${data.manifest.songs.length} SONG${data.manifest.songs.length === 1 ? "" : "S"} · ${liveState.readiness?.status?.toUpperCase() ?? "CHECKING"}`;
    $("#settingsIemStatus").textContent = data.audio.iemReady ? "OUTPUTS 7–8 READY" : `${data.audio.outputChannels ?? 0} OUTPUT DEVICE`;
    $("#settingsMidiEvents").textContent = `${song.arrangement?.proPresenterMidi?.length ?? song.control?.proPresenterMidi?.length ?? 0} PREPARED`;
    $("#settingsEngineStatus").textContent = liveState.fault ? `FAULT · ${liveState.fault}` : liveState.readiness?.ready ? "ARMED" : "NOT READY";
    $("#settingsSetStatus").textContent = `${data.manifest.name} · ${liveState.readiness?.status ?? "Checking"}`;
  };
  $("#remoteControl").onclick = async () => {
    try{renderLibraryStatus(await window.playback.prep.status());}catch{}
    try { control = await window.playback.control.get(); const url = control.urls[0] ?? "Remote adapter is unavailable"; ($("#remoteUrl") as HTMLInputElement).value = url; $("#remoteStatus").textContent = control.address ? control.lanEnabled ? "LAN REMOTE READY" : "LOCAL TEST MODE" : "REMOTE ADAPTER FAULT"; $("#remoteHttp").textContent = control.address ? `Port ${control.address.httpPort} · token protected` : "Unavailable"; $("#remoteOsc").textContent = control.oscEnabled && control.address?.oscPort ? `Port ${control.address.oscPort}${control.lanEnabled ? " · token first argument" : " · localhost"}` : "Disabled"; $("#toggleLanRemote").textContent = control.lanEnabled ? "DISABLE LAN" : "ENABLE LAN"; $("#toggleOsc").textContent = control.oscEnabled ? "OSC ON" : "OSC OFF"; $("#toggleOsc").classList.toggle("active", control.oscEnabled);const input=$("#midiInputDevice") as HTMLSelectElement;input.replaceChildren(new Option("MIDI Input Disabled",""),...control.midiInput.devices.map((name:string)=>new Option(name,name,false,name===control.midiInput.selected)));($("#footControllerProfile") as HTMLSelectElement).value=control.midiInput.profile;$("#midiInputStatus").textContent=control.midiInput.enabled?`ARMED · ${control.midiInput.selected}`:"MIDI input is disabled.";const gldOutput=$("#gldMidiOutput") as HTMLSelectElement;gldOutput.replaceChildren(new Option("GLD MIDI Output Disabled",""),...control.gld.devices.map((name:string)=>new Option(name,name,false,name===control.gld.midiOutputName)));($("#gldChannel") as HTMLInputElement).value=String(control.gld.midiChannel);renderSettingsSummary();showPage("general");dialog.showModal(); } catch (error) { showError(error); }
  };
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-settings-tab]")) button.onclick = () => showPage(button.dataset.settingsTab!);
  $("#closeRemoteSettings").onclick = () => dialog.close();
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
  $("#settingsRefreshLibrary").onclick = async () => { const button = $<HTMLButtonElement>("#settingsRefreshLibrary"); button.disabled = true; $("#settingsSyncStatus").textContent = "Refreshing prepared versions…"; try { prepState = await window.playback.prep.get(); if (editMode) renderEditorSetBuilder(); $("#settingsSyncStatus").textContent = `Prepared library refreshed · ${prepState.prepared.length} versions available.`; } catch (error) { $("#settingsSyncStatus").textContent = `Refresh failed · ${error instanceof Error ? error.message : String(error)}`; } finally { button.disabled = false; } };
  $("#settingsScanLibrary").onclick = async () => { const button = $<HTMLButtonElement>("#settingsScanLibrary"); button.disabled = true; $("#settingsSyncStatus").textContent = "Library sync is running · checking analyzer output…"; try { catalogState = await window.playback.prep.scan(); renderLibraryStatus(await window.playback.prep.status()); $("#settingsSyncStatus").textContent = `Sync complete · ${catalogState.counts.ready} ready · ${catalogState.counts["needs-analysis"]} need analysis · ${catalogState.counts["missing-folder"]} missing folders.`; } catch (error) { renderLibraryStatus(await window.playback.prep.status()); $("#settingsSyncStatus").textContent = `Sync failed · ${error instanceof Error ? error.message : String(error)}`; } finally { button.disabled = false; } };
  window.playback.prep.onStatus((state:any)=>renderLibraryStatus(state));
  $("#copyRemoteUrl").onclick = async () => { const input = $("#remoteUrl") as HTMLInputElement; try { await navigator.clipboard.writeText(input.value); $("#remoteStatus").textContent = "REMOTE LINK COPIED"; } catch { input.select(); document.execCommand("copy"); $("#remoteStatus").textContent = "REMOTE LINK COPIED"; } };
  $("#toggleLanRemote").onclick = async () => { if (!control) return; $("#remoteStatus").textContent = "RESTARTING CONTROL ADAPTER…"; await window.playback.control.setSettings({ lanEnabled: !control.lanEnabled }); };
  $("#toggleOsc").onclick = async () => { if (!control) return; $("#remoteStatus").textContent = "RESTARTING CONTROL ADAPTER…"; await window.playback.control.setSettings({ oscEnabled: !control.oscEnabled }); };
  $("#applyMidiInput").onclick = async () => {const button=$("#applyMidiInput") as HTMLButtonElement;button.disabled=true;$("#midiInputStatus").textContent="ARMING MIDI INPUT…";try{const result=await window.playback.control.setMidiInput({name:($("#midiInputDevice") as HTMLSelectElement).value||null,profile:($("#footControllerProfile") as HTMLSelectElement).value});$("#midiInputStatus").textContent=result.enabled?`ARMED · ${result.selected}`:"MIDI input is disabled.";}catch(error){showError(error);$("#midiInputStatus").textContent="MIDI INPUT FAULT";}finally{button.disabled=false;}};
  window.playback.control.onMidiInput((event:any)=>{$("#midiInputStatus").textContent=`RECEIVED · ${event.status.toString(16).toUpperCase()} · ${event.data1} · ${event.data2}`;});
  $("#previewGld").onclick=async()=>{try{const preview=await window.playback.control.gldPreview({midiChannel:Number(($("#gldChannel") as HTMLInputElement).value),intent:{type:"mute",strip:{kind:"input",number:1},muted:true}});$("#gldHex").textContent=preview.hex;$("#gldStatus").textContent="PREVIEW ONLY · writes remain locked";}catch(error){showError(error);}};
  $("#testGld").onclick=async()=>{const button=$("#testGld") as HTMLButtonElement;button.disabled=true;$("#gldStatus").textContent="OPENING MIDI DEVICE · sending no data…";try{const result=await window.playback.control.gldTest({midiOutputName:($("#gldMidiOutput") as HTMLSelectElement).value,midiChannel:Number(($("#gldChannel") as HTMLInputElement).value)});$("#gldStatus").textContent=result.status==="connection-tested"?`READY · ${result.selected} · CH ${result.midiChannel} · writes locked`:"MIDI DEVICE NOT READY";}catch(error){$("#gldStatus").textContent="MIDI DEVICE TEST FAILED · no data sent";showError(error);}finally{button.disabled=false;}};
}

function setupReaperImport() {
  const dialog = $("#reaperImport") as HTMLDialogElement;
  let preview: any = null;
  $("#importReaper").onclick = async () => {
    try {
      preview = await window.playback.arrangements.previewReaper(); if (!preview) return;
      const a = preview.arrangement;
      $("#importSummary").textContent = `${a.name} · ${a.selectedKey ?? "Key unknown"} · ${a.selectedBpm} BPM · ${a.timeSignature.numerator}/${a.timeSignature.denominator} · ${a.regions.length} regions · ${a.proPresenterMidi.length} Slides MIDI events`;
      $("#importDifferences").innerHTML = preview.differences.length ? `<h3>Preview Differences</h3><ul>${preview.differences.map((item: any) => `<li>${escapeHtml(item.field)}: ${escapeHtml(JSON.stringify(item.original))} → ${escapeHtml(JSON.stringify(item.arrangement))}</li>`).join("")}</ul>` : "<p>No structural differences from Original Song.</p>";
      $("#importWarning").textContent = "Nothing is written until you choose an import action. Original Song remains unchanged.";
      dialog.showModal();
    } catch (error) { showError(error); }
  };
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-action]")) button.onclick = async () => {
    const action = button.dataset.action as "new" | "replace" | "cancel";
    try { const result = await window.playback.arrangements.commitReaper(action); dialog.close(); if (!result.cancelled) setEditorStatus("Reaper arrangement imported and cached. Reload it from the Arrangement selector."); }
    catch (error) { showError(error); }
  };
}

function setupPerformance() {
  $("#play").onclick = () => editMode ? window.playback.command("play") : void liveCommand({ action: "play" });
  $("#pause").onclick = () => editMode ? window.playback.command("pause") : void liveCommand({ action: "pause" });
  $("#stop").onclick = () => editMode ? window.playback.command("stop") : void liveCommand({ action: "stop" });
  $("#pad").onclick = () => void liveCommand({ action: "bus", bus: "pad", enabled: !liveState.channels.pad });
  $("#previousSection").onclick = () => navigateSection(-1);
  $("#nextSection").onclick = () => navigateSection(1);
  $("#loopSection").onclick = () => void liveCommand({ action: "loop" });
  $("#repeatOnce").onclick = () => void liveCommand({ action: "repeat-once", regionId: selectedRegionId });
  $("#panic").onclick = () => { if (!liveState.panicActive) void liveCommand({ action: "panic" }); };
  $("#clearFault").onclick = () => void liveCommand({ action: "clear-fault" });
  const cueNext = $("#cueNextSong") as HTMLButtonElement;
  cueNext.disabled = (data.activeSongIndex ?? 0) >= data.manifest.songs.length - 1;
  cueNext.textContent = cueNext.disabled ? "NO NEXT SONG" : data.ready.nextReady ? "CUE NEXT · READY" : "NEXT NOT READY";
  cueNext.onclick = async () => { await liveCommand({ action: "cue-next" }); location.reload(); };
  const mixerCollapsed=localStorage.getItem("playback.performance.mixerCollapsed")==="1";document.body.classList.toggle("mixer-collapsed",mixerCollapsed);$("#mixerCollapse").textContent=mixerCollapsed?"EXPAND":"COLLAPSE";$("#mixerCollapse").setAttribute("aria-expanded",String(!mixerCollapsed));
  $("#mixerCollapse").onclick=()=>{const collapsed=document.body.classList.toggle("mixer-collapsed");localStorage.setItem("playback.performance.mixerCollapsed",collapsed?"1":"0");$("#mixerCollapse").textContent=collapsed?"EXPAND":"COLLAPSE";$("#mixerCollapse").setAttribute("aria-expanded",String(!collapsed));};
  setupMixerResize();
  window.playback.performance.onState((state) => { liveState = state; renderLiveState(); });
  window.playback.performance.onMeters(updateMixerMeters);
  window.playback.onTransport((state) => {
    currentPosition = state.positionSeconds;
    if (editMode && loopAuditionRegionId && workspace) {
      const loopSection = workspace.draft.sections.find((section: any) => section.id === loopAuditionRegionId);
      if (loopSection && state.positionSeconds >= loopSection.sourceEndSeconds - 0.01) window.playback.command("seek", loopSection.sourceStartSeconds);
    }
    $("#clock").textContent = `${formatTime(currentPosition)} / -${formatTime(Math.max(0, (editMode ? workspace?.draft.durationSeconds : performanceDuration) - currentPosition))}`;
    const grid = editMode && workspace ? editorGrid() : performanceGrid;
    $("#position").textContent = formatGridLocation(currentPosition, grid);
    $("#playhead").style.left = `${(currentPosition / performanceDuration) * 100}%`;
    updatePerformanceProgress();
    if (workspace) { $("#editorPlayhead").style.left = `${(currentPosition / workspace.draft.durationSeconds) * 100}%`; $("#playheadLocation").textContent = formatGridLocation(currentPosition, editorGrid()); }
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

function setupEditorControls() {
  $("#closeSongLibrary").onclick = () => ($<HTMLDialogElement>("#songLibraryPicker")).close();
  $("#songLibrarySearch").oninput = () => renderSongLibraryResults();
  $("#songLibrarySpeed").onchange = () => renderSongLibraryResults();
  $("#editorSetlistName").onchange = (event) => void prepCommand({ action: "rename", name: (event.currentTarget as HTMLInputElement).value });
  $("#editorRefreshLibrary").onclick = async () => { prepState = await window.playback.prep.get(); renderEditorSetBuilder(); $("#editorSetlistStatus").textContent = "Library refreshed."; };
  $("#editorConfirmSet").onclick = async () => { const button = $<HTMLButtonElement>("#editorConfirmSet"); button.disabled = true; localStorage.setItem("playback.ui.mode", "edit"); $("#editorSetlistStatus").textContent = "Confirming and isolating the set…"; try { const selectedIndex = Math.max(0, prepState.setlist.items.findIndex((item: any) => item.itemId === selectedSetItemId)); const result = await window.playback.prep.confirm({ selectedIndex }); $("#editorSetlistStatus").textContent = `Confirmed ${result.songs} songs. Reloading Edit…`; } catch (error) { button.disabled = false; showError(error); } };
  $("#summaryView").onclick = () => { expandedStems = false; renderEditorViewMode(); };
  $("#stemsView").onclick = () => { expandedStems = true; renderEditorViewMode(); };
  $("#editorZoom").oninput = () => { localStorage.setItem("playback.editor.zoom", ($("#editorZoom") as HTMLInputElement).value); renderEditorTimeline(); };
  $("#widthDown").onclick = () => stepEditorWidth(-0.25); $("#widthUp").onclick = () => stepEditorWidth(0.25);
  $("#heightDown").onclick = () => stepStemHeight(-12); $("#heightUp").onclick = () => stepStemHeight(12);
  for (const button of document.querySelectorAll<HTMLButtonElement>("#editorSnap [data-snap]")) button.onclick = () => setEditorSnapMode(button.dataset.snap as EditorSnapMode);
  const updateKeyTempo = () => void arrange({ type: "set-key-tempo", key: ($("#arrangementKey") as HTMLInputElement).value, bpm: Number(($("#arrangementBpm") as HTMLInputElement).value) });
  $("#arrangementKey").onchange = updateKeyTempo; $("#arrangementBpm").onchange = updateKeyTempo;
  $("#sectionName").onchange = (event) => void arrange({ type: "rename-section", sectionId: selectedRegionId, name: (event.currentTarget as HTMLInputElement).value });
  $("#selectPrevious").onclick = () => selectRelative(-1); $("#selectNext").onclick = () => selectRelative(1);
  $("#moveEarlier").onclick = () => moveSelected(-1); $("#moveLater").onclick = () => moveSelected(1);
  $("#duplicateRegion").onclick = () => void arrange({ type: "duplicate-section", sectionId: selectedRegionId });
  $("#deleteRegion").onclick = () => void arrange({ type: "delete-section", sectionId: selectedRegionId });
  $("#splitRegion").onclick = () => void arrange({ type: "split-section", atSeconds: currentPosition });
  $("#trimStart").onclick = () => void arrange({ type: "trim-start", atSeconds: currentPosition });
  $("#trimEnd").onclick = () => void arrange({ type: "trim-end", atSeconds: currentPosition });
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
  $("#saveArrangement").onclick = async () => { const button = $("#saveArrangement") as HTMLButtonElement; button.disabled = true; setEditorStatus("Rendering every stem and preparing the confirmed cache…"); try { const saved = await window.playback.arrange.save(); setEditorStatus(`Saved ${saved.arrangement.name}. Select it from the Arrangement menu to audition the exact rendered result.`); await refreshWorkspace(); } catch (error) { showError(error); } finally { button.disabled = false; } };
}

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
  if (edit && !workspace) {
    $("#editorStatus").textContent = "Preparing stacked stem waveforms…";
    editorLoading ??= refreshWorkspace();
    await editorLoading;
  }
  if (edit && !prepState) prepState = await window.playback.prep.get();
  if (edit && workspace) {
    try {
      const pending = JSON.parse(localStorage.getItem("playback.editor.createNew") ?? "null");
      if (pending?.songId === String(song.song.id)) { await window.playback.arrange.command({ type: "set-name", name: pending.name }); localStorage.removeItem("playback.editor.createNew"); await refreshWorkspace(); setEditorStatus(`New arrangement ready: ${pending.name}`); }
    } catch { localStorage.removeItem("playback.editor.createNew"); }
  }
  if (edit) renderEditorSetBuilder();
  renderEditorSnapMode();
  renderPerformanceReadiness(liveState.readiness);
}

function setupPrep() {
  $("#scanLibrary").onclick = async () => { const button = $("#scanLibrary") as HTMLButtonElement; button.disabled = true; button.textContent = "SCANNING…"; try { catalogState = await window.playback.prep.scan(); renderCatalog(); } catch (error) { showError(error); } finally { button.disabled = false; button.textContent = "SCAN MASTER LIBRARY"; } };
  $("#libraryFilter").oninput = () => renderCatalog();
  $("#setlistName").onchange = () => void prepCommand({ action: "rename", name: ($("#setlistName") as HTMLInputElement).value });
  $("#clearSetlist").onclick = () => void prepCommand({ action: "clear" });
  $("#confirmSet").onclick = async () => { const button = $("#confirmSet") as HTMLButtonElement; button.disabled = true; $("#setlistStatus").textContent = "Copying and validating the isolated performance package…"; try { const result = await window.playback.prep.confirm(); $("#setlistStatus").textContent = `Confirmed ${result.songs} song${result.songs === 1 ? "" : "s"}. Loading Performance…`; } catch (error) { showError(error); button.disabled = false; $("#setlistStatus").textContent = "Confirm Set failed. Draft was preserved."; } };
}

async function setPrepMode() {
  prepModeActive = true; editMode = false; localStorage.setItem("playback.ui.mode","prep"); document.body.classList.remove("edit-mode", "performance-mode");
  $("#prepWorkspace").hidden = false; $("#performanceWorkspace").hidden = true; $("#editorWorkspace").hidden = true; $("#liveControls").hidden = true; $("#performanceMixer").hidden=true; $("#editorSnap").hidden = true; $(".transport").hidden = true;
  $("#prepMode").classList.add("active"); $("#editMode").classList.remove("active"); $("#performanceMode").classList.remove("active");
  $("#modeLabel").textContent = "PREP · LIBRARY + SETLIST + CONFIRM SET"; $("#title").textContent = "Production Preparation"; $("#facts").textContent = "Performance remains isolated while this lane scans, orders, copies, and validates.";
  if (!prepState) prepState = await window.playback.prep.get(); renderPrep();
}

async function prepCommand(command: any) { try { prepState = await window.playback.prep.command(command); renderPrep(); renderEditorSetBuilder(); } catch (error) { showError(error); } }
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
  $("#librarySummary").innerHTML = `<strong>${catalogState.songs.length} MASTER SONGS</strong><span>${counts.ready} ready</span><span>${counts["needs-analysis"]} need analysis</span><span>${counts["missing-folder"]} missing folder</span>`;
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
  const draft = workspace.draft;
  const selectedVersion = prepState?.setlist.items.find((item: any) => item.itemId === selectedSetItemId)?.arrangement ?? workspace.source.name;
  $("#editorSource").textContent = `${workspace.source.name} · ${workspace.source.kind.replaceAll("-", " ").toUpperCase()}`;
  $("#editorVersion").textContent = `${workspace.source.id} · ${workspace.source.hash.slice(0, 18)}`;
  $("#editorSelectedArrangementName").textContent = selectedVersion;
  ($("#arrangementKey") as HTMLInputElement).value = draft.selectedKey;
  ($("#arrangementBpm") as HTMLInputElement).value = String(draft.selectedBpm);
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
    row.innerHTML = `<button class="region-list-main" title="Select ${escapeHtml(section.name)}"><i class="region-drag-handle">⋮⋮</i><span class="region-order">${index + 1}</span><span class="region-list-copy"><strong>${escapeHtml(section.name)}</strong><small>${formatGridLocation(section.startSeconds, editorGrid())}–${formatGridLocation(section.endSeconds, editorGrid())}</small></span></button><div class="region-list-actions"><button data-action="rename" title="Rename region">RENAME</button><button data-action="duplicate" title="Duplicate region">DUPLICATE</button><button data-action="remove" title="Remove region and close its gap">REMOVE</button></div>`;
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
  ($("#sectionStart") as HTMLInputElement).value = formatGridLocation(section.startSeconds, editorGrid());
  ($("#sectionEnd") as HTMLInputElement).value = formatGridLocation(section.endSeconds, editorGrid());
  $("#sectionSource").textContent = `Source ${section.sourceRegionId} · ${formatTime(section.sourceStartSeconds)}–${formatTime(section.sourceEndSeconds)}`;
  $("#loopAudition").classList.toggle("active", loopAuditionRegionId === section.id);
  const cue = selectedCue();
  ($("#cueEnabled") as HTMLInputElement).checked = cue?.enabled ?? false;
  const target = $("#cueTarget") as HTMLSelectElement;
  target.replaceChildren(...workspace.draft.sections.map((item: any) => new Option(item.name, item.id)));
  target.value = cue?.targetRegionId ?? section.id;
  $("#cueDetail").textContent = cue ? `${cue.phrase} at ${formatGridLocation(cue.atSeconds, editorGrid())} → ${sectionById(cue.targetRegionId)?.name ?? "Missing"}` : "No cue for this region";
  const midi = $("#midiEvents"); midi.replaceChildren();
  const events = workspace.draft.midi.filter((event: any) => event.atSeconds >= section.startSeconds && event.atSeconds < section.endSeconds);
  if (!events.length) midi.textContent = "No Slides MIDI in this region.";
  for (const event of events) {
    const label = document.createElement("label"); label.className = "midi-event";
    const kind = midiKind(event.status, event.data2);
    label.innerHTML = `<input type="checkbox" ${event.enabled ? "checked" : ""}><span><strong>${kind}</strong><small>${formatGridLocation(event.atSeconds, editorGrid())} · CH ${(event.status & 15) + 1} · ${event.data1}/${event.data2}</small></span>`;
    (label.querySelector("input") as HTMLInputElement).onchange = (change) => void arrange({ type: "set-midi-enabled", eventId: event.id, enabled: (change.currentTarget as HTMLInputElement).checked });
    midi.append(label);
  }
}

function renderReadiness() {
  $("#readinessSummary").className = `readiness-summary ${workspace.readiness.status.toLowerCase().replaceAll(" ", "-")}`;
  $("#readinessSummary").textContent = workspace.readiness.status.toUpperCase();
  const checks = $("#readinessChecks"); checks.replaceChildren();
  for (const check of workspace.readiness.checks) { const row = document.createElement("div"); row.className = `readiness-check ${check.level}`; row.innerHTML = `<i></i><span><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></span>`; checks.append(row); }
  ($("#saveArrangement") as HTMLButtonElement).disabled = workspace.readiness.status === "Blocked";
}

function renderEditorViewMode() {
  document.body.classList.toggle("expanded-editor", expandedStems);
  $("#summaryView").classList.toggle("active", !expandedStems); $("#stemsView").classList.toggle("active", expandedStems);
  $("#summaryWaveform").hidden = expandedStems; $("#stemWaveforms").hidden = !expandedStems;
  $("#stemLabelGutter").hidden = !expandedStems;
  $("#expandedSizeControls").hidden = !expandedStems;
  renderEditorTimeline();
}

function renderEditorTimeline() {
  if (!workspace) return;
  const timeline = $("#editorTimeline");
  const zoom = Number(($<HTMLInputElement>("#editorZoom")).value);
  timeline.style.width = `${zoom * 100}%`;
  timeline.closest<HTMLElement>(".editor-timeline-shell")!.style.setProperty("--stem-row-height", `${stemRowHeight}px`);
  timeline.style.setProperty("--stem-row-height", `${stemRowHeight}px`);
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
  const stems = $("#stemWaveforms"); stems.replaceChildren();
  const labels = $("#stemLabelItems"); labels.replaceChildren();
  for (const [index, stem] of workspace.waveforms.stems.entries()) {
    const color = stemColor(index);
    const channel=liveState.mixer.channels[index]??{gain:1,muted:false,solo:false};
    const label = document.createElement("label"); label.className="stem-console";label.innerHTML = `<span class="stem-console-name"><i class="stem-identifier" style="--stem-color:${color}"></i><strong>${escapeHtml(stem.role)}</strong></span><span class="stem-console-faders"><em>L<input data-stem-fader="left" type="range" min="0" max="1.25" step=".01" value="${channel.gain}"></em><em>R<input data-stem-fader="right" type="range" min="0" max="1.25" step=".01" value="${channel.gain}"></em></span><span class="stem-console-switches"><button data-stem-switch="muted" class="${channel.muted?"active":""}">M</button><button data-stem-switch="solo" class="${channel.solo?"active":""}">S</button></span>`; labels.append(label);
    for(const button of label.querySelectorAll<HTMLButtonElement>("button"))button.onclick=async()=>{const latest=liveState.mixer.channels[index];liveState=await window.playback.performance.command({action:"mixer-channel",index,gain:latest.gain,muted:button.dataset.stemSwitch==="muted"?!latest.muted:latest.muted,solo:button.dataset.stemSwitch==="solo"?!latest.solo:latest.solo,iem:latest.iem});renderEditorTimeline();};
    for(const fader of label.querySelectorAll<HTMLInputElement>("input"))fader.onchange=async()=>{const latest=liveState.mixer.channels[index],gain=Number(fader.value);liveState=await window.playback.performance.command({action:"mixer-channel",index,gain,muted:latest.muted,solo:latest.solo,iem:latest.iem});renderEditorTimeline();};
    const row = document.createElement("div"); row.className = `stem-row ${index % 2 ? "alternate" : ""}`; row.innerHTML = `<canvas></canvas>`; stems.append(row);
    row.style.setProperty("--stem-color", color);
    drawWaveform(row.querySelector("canvas")!, stem.buckets, color);
  }
  const scroll = $("#editorTimelineScroll");
  scroll.onscroll = () => { labels.style.transform = `translateY(${-scroll.scrollTop}px)`; };
  updateSelectionOverlay();
  bindEditorTimelinePointer();
}

function renderMarkers() {
  const cueLane = $("#editorCueLane"); cueLane.querySelectorAll("i").forEach((item) => item.remove());
  for (const cue of workspace.draft.cues) { const marker = document.createElement("i"); marker.className = cue.enabled ? "" : "disabled"; marker.style.left = `${(cue.atSeconds / workspace.draft.durationSeconds) * 100}%`; marker.title = `${cue.phrase} → ${sectionById(cue.targetRegionId)?.name}`; marker.innerHTML = `<span>${escapeHtml(cue.phrase)}</span>`; marker.onclick = () => selectRegion(cue.targetRegionId); cueLane.append(marker); }
  const midiLane = $("#editorMidiLane"); midiLane.querySelectorAll("i").forEach((item) => item.remove());
  for (const event of workspace.draft.midi) { const marker = document.createElement("i"); marker.className = event.enabled ? "" : "disabled"; marker.style.left = `${(event.atSeconds / workspace.draft.durationSeconds) * 100}%`; marker.title = `${midiKind(event.status, event.data2)} · CH ${(event.status & 15) + 1} · ${event.data1}/${event.data2}`; midiLane.append(marker); }
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
  for (const region of song.regions) { const button = document.createElement("button"); button.className = `region ${regionClass(region.name)}`; button.dataset.regionId = region.id; button.style.left = `${(region.startSeconds / performanceDuration) * 100}%`; button.style.width = `${((region.endSeconds - region.startSeconds) / performanceDuration) * 100}%`; button.textContent = region.name; button.onclick = (event) => { event.stopPropagation(); if (liveState.panicActive) void liveCommand({ action: "recover", regionId: region.id }); else { const now = performance.now(); const last = Number(button.dataset.lastClick ?? 0); if (now - last <= 400) void liveCommand({ action: "jump", regionId: region.id }); button.dataset.lastClick = String(now); } }; regions.append(button); }
  const boundaries=$("#performanceBoundaryLines");boundaries.replaceChildren();
  for(const region of song.regions.slice(1)){const line=document.createElement("i");line.style.left=`${(region.startSeconds/performanceDuration)*100}%`;line.title=`${region.name} boundary`;boundaries.append(line);}
  const cues = $("#cueMarkers"); cues.replaceChildren();
  for (const cue of song.liveAssets?.cues ?? []) { const marker = document.createElement("i"); marker.style.left = `${(cue.atSeconds / performanceDuration) * 100}%`; marker.title = cue.label; marker.innerHTML = `<span>${escapeHtml(cue.label)}</span>`; cues.append(marker); }
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

function renderLiveState() {
  const currentRegion = song.regions.find((region: any) => region.id === liveState.currentRegionId);
  const transitionRegion = song.regions.find((region: any) => region.id === liveState.recoveryRegionId);
  const currentRegionIndex = song.regions.findIndex((region: any) => region.id === liveState.currentRegionId);
  const nextRegion = currentRegionIndex >= 0 ? song.regions[currentRegionIndex + 1] : null;
  $("#currentSection").textContent = currentRegion?.name ?? "—";
  $("#upNextSection").textContent = `NEXT · ${nextRegion?.name ?? "END OF SONG"}`;
  $("#pad").textContent = `PAD ${song.selectedKey}`; $("#pad").classList.toggle("active", liveState.channels.pad);
  for (const button of document.querySelectorAll<HTMLElement>("[data-bus]")) { const enabled = Boolean(liveState.channels[button.dataset.bus!]); button.classList.toggle("active", enabled); button.closest(".live-bus")?.classList.toggle("active", enabled); }
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-gain]")) { const bus = input.dataset.gain!; const gain = Number(liveState.gains?.[bus] ?? 1); if (document.activeElement !== input) input.value = String(gain); const output = document.querySelector<HTMLOutputElement>(`[data-gain-output="${bus}"]`); if (output) output.value = `${Math.round(gain * 100)}%`; }
  $("#loopSection").classList.toggle("active", liveState.loopRegionId !== null); $("#repeatOnce").classList.toggle("active", Boolean(liveState.repeatOnceRegionId));
  for (const region of document.querySelectorAll<HTMLElement>("#regions .region")) { region.classList.toggle("current", region.dataset.regionId === liveState.currentRegionId); region.classList.toggle("armed", region.dataset.regionId === liveState.recoveryRegionId); }
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

function renderDawMixer(){
  const mixer=liveState.mixer;if(!mixer)return;
  const signature=mixer.channels.map((channel:any)=>channel.kind).join(",")+"|"+(data.stemLabels??[]).join(","),container=$("#mixerChannels");
  if(signature!==mixerRenderSignature){
    mixerRenderSignature=signature;container.replaceChildren();
    const master=document.createElement("article");master.className="daw-channel master";master.innerHTML=`<div class="channel-head"><strong>MASTER +6 dB</strong><b data-meter-master-readout>−∞</b></div><div class="channel-console"><div class="meter-shell"><i class="meter-fill" data-meter-master></i></div><div class="console-controls"><div class="master-badge">+6</div><input id="masterFader" class="channel-fader" type="range" min="0" max="1.25" step="0.01" value="${mixer.masterGain}" aria-label="Master fader with global plus six decibel output trim"></div></div><output id="masterOutput">${Math.round(mixer.masterGain*100)}%</output><div class="channel-name">MASTER</div><small>MAIN OUT +6 dB</small>`;container.append(master);
    const masterFader=master.querySelector<HTMLInputElement>("#masterFader")!;masterFader.oninput=()=>{const requested=Number(masterFader.value);master.querySelector<HTMLOutputElement>("#masterOutput")!.value=`${Math.round(requested*100)}%`;const previous=mixerCommandTimers.get(-1);if(previous)clearTimeout(previous);mixerCommandTimers.set(-1,window.setTimeout(()=>void liveCommand({action:"mixer-master",gain:requested}),30));};
    for(const channel of mixer.channels){
      const label=channel.kind==="stem"?(data.stemLabels?.[channel.index]??song.stems[channel.index]?.role??`Stem ${channel.index+1}`):channel.kind.toUpperCase(),strip=document.createElement("article");strip.className=`daw-channel ${channel.kind}`;strip.dataset.mixerIndex=String(channel.index);strip.innerHTML=`<div class="channel-head"><strong title="${escapeHtml(label)}">${escapeHtml(label)}</strong><b data-meter-readout="${channel.index}">−∞</b></div><div class="channel-console"><div class="meter-shell"><i class="meter-fill" data-meter-channel="${channel.index}"></i></div><div class="console-controls"><div class="channel-switches"><button data-mixer-switch="muted" title="Mute ${escapeHtml(label)}">M</button><button data-mixer-switch="solo" title="Solo ${escapeHtml(label)}">S</button><button data-mixer-switch="iem" title="Send ${escapeHtml(label)} to IEM outputs 7–8">IEM</button></div><input class="channel-fader" data-mixer-fader="${channel.index}" type="range" min="0" max="1.25" step="0.01" value="${channel.gain}" aria-label="${escapeHtml(label)} fader"></div></div><output data-mixer-output="${channel.index}">${Math.round(channel.gain*100)}%</output><div class="channel-name">${escapeHtml(label)}</div><small>${String(channel.index+1).padStart(2,"0")} · ${channel.kind==="stem"?"MUSIC":channel.kind.toUpperCase()}</small>`;container.append(strip);
      for(const button of strip.querySelectorAll<HTMLButtonElement>("[data-mixer-switch]"))button.onclick=()=>{const active=liveState.mixer.channels[channel.index],key=button.dataset.mixerSwitch!;void liveCommand({action:"mixer-channel",index:active.index,gain:active.gain,muted:key==="muted"?!active.muted:active.muted,solo:key==="solo"?!active.solo:active.solo,iem:key==="iem"?!active.iem:active.iem});};
      const fader=strip.querySelector<HTMLInputElement>("[data-mixer-fader]")!;fader.oninput=()=>{const requested=Number(fader.value);strip.querySelector<HTMLOutputElement>("output")!.value=`${Math.round(requested*100)}%`;const previous=mixerCommandTimers.get(channel.index);if(previous)clearTimeout(previous);mixerCommandTimers.set(channel.index,window.setTimeout(()=>{const active=liveState.mixer.channels[channel.index];void liveCommand({action:"mixer-channel",index:active.index,gain:requested,muted:active.muted,solo:active.solo,iem:active.iem});},30));};
    }
  }
  for(const channel of mixer.channels){const strip=container.querySelector<HTMLElement>(`[data-mixer-index="${channel.index}"]`);if(!strip)continue;strip.querySelector<HTMLButtonElement>('[data-mixer-switch="muted"]')?.classList.toggle("active",channel.muted);strip.querySelector<HTMLButtonElement>('[data-mixer-switch="solo"]')?.classList.toggle("active",channel.solo);strip.querySelector<HTMLButtonElement>('[data-mixer-switch="iem"]')?.classList.toggle("active",channel.iem);strip.classList.toggle("muted",channel.muted);const fader=strip.querySelector<HTMLInputElement>("[data-mixer-fader]");if(fader&&document.activeElement!==fader){fader.value=String(channel.gain);strip.querySelector<HTMLOutputElement>("output")!.value=`${Math.round(channel.gain*100)}%`;}}
  const masterFader=$("#masterFader") as HTMLInputElement;if(document.activeElement!==masterFader){masterFader.value=String(mixer.masterGain);($("#masterOutput") as HTMLOutputElement).value=`${Math.round(mixer.masterGain*100)}%`;}
  const iemReady=Boolean(data.audio.iemReady);$("#mixerIemStatus").textContent=iemReady?"IEM SEND · OUTPUTS 7–8 READY":`IEM SEND ARMED · ${data.audio.outputChannels??0} OUTPUT DEVICE`;$("#performanceMixer").classList.toggle("iem-unavailable",!iemReady);
}

function updateMixerMeters(meters:{master:number;channels:readonly number[]}){setMeter(document.querySelector<HTMLElement>("[data-meter-master]"),document.querySelector<HTMLElement>("[data-meter-master-readout]"),meters.master);meters.channels.forEach((value,index)=>setMeter(document.querySelector<HTMLElement>(`[data-meter-channel="${index}"]`),document.querySelector<HTMLElement>(`[data-meter-readout="${index}"]`),value));}
function setMeter(fill:HTMLElement|null,readout:HTMLElement|null,amplitude:number){if(!fill||!readout)return;const safe=Math.max(0,Number(amplitude)||0),db=safe>0?20*Math.log10(safe):-Infinity,percent=Number.isFinite(db)?Math.max(0,Math.min(100,(db+60)/66*100)):0;fill.style.height=`${percent}%`;fill.classList.toggle("hot",db>=-6);readout.textContent=Number.isFinite(db)?`${Math.max(-60,db).toFixed(0)}`:"−∞";}

function renderPerformanceReadiness(report: any) {
  if (!report) return;
  const badge = $("#ready"), blocked = report.checks.filter((item: any) => item.level === "blocked").length, warnings = report.checks.filter((item: any) => item.level === "warning").length;
  badge.className = `ready ${report.status === "Blocked" ? "blocked" : report.status === "Ready with warnings" ? "warning" : ""}`;
  badge.textContent = report.status === "Blocked" ? `PERFORMANCE LOCKED · ${blocked}` : report.status === "Ready with warnings" ? `READY · ${warnings} WARNING${warnings === 1 ? "" : "S"}` : "PERFORMANCE READY";
  $("#performanceReadinessTitle").textContent = report.status.toUpperCase();
  const checks = $("#performanceReadinessChecks"); checks.replaceChildren();
  for (const item of report.checks) { const row = document.createElement("section"); row.className = `performance-readiness-check ${item.level}`; row.innerHTML = `<i></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>`; checks.append(row); }
  const faulted = Boolean(liveState.fault);
  if (faulted) { badge.classList.add("blocked"); badge.textContent = "PERFORMANCE LOCKED - ENGINE FAULT"; }
  const locked = (!report.ready || faulted) && !editMode;
  for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>("#liveControls button, #liveControls input, #performanceMixer button, #performanceMixer input, #play, #pause, #pad")) if (control.id !== "clearFault"&&control.id!=="mixerCollapse") control.disabled = locked;
  $("#performanceWorkspace").classList.toggle("performance-locked", locked);
}

async function liveCommand(command: any) { try { liveState = await window.playback.performance.command(command); renderLiveState(); } catch (error) { showError(error); } }
function navigateSection(offset: number) { if (!liveState.panicActive) { void liveCommand({ action: offset < 0 ? "previous-section" : "next-section" }); return; } const anchor = liveState.recoveryRegionId ?? liveState.currentRegionId; const index = song.regions.findIndex((item: any) => item.id === anchor); const target = song.regions[Math.max(0, Math.min(song.regions.length - 1, index + offset))]; if (target) void liveCommand({ action: "recover", regionId: target.id }); }
function moveSelected(offset: number) { const index = workspace.draft.sections.findIndex((item: any) => item.id === selectedRegionId); const destination = index + offset; if (destination >= 0 && destination < workspace.draft.sections.length) void arrange({ type: "move-section", sectionId: selectedRegionId, toIndex: destination }); }
function stepEditorWidth(amount: number) { const control = $("#editorZoom") as HTMLInputElement; control.value = String(Math.max(Number(control.min), Math.min(Number(control.max), Number(control.value) + amount))); localStorage.setItem("playback.editor.zoom", control.value); renderEditorTimeline(); }
function stepStemHeight(amount: number) { stemRowHeight = Math.max(38, Math.min(194, stemRowHeight + amount)); localStorage.setItem("playback.editor.stemHeight", String(stemRowHeight)); renderEditorTimeline(); }
function selectRegion(id: string) { selectedRegionId = id; renderRegionList(); renderSelectedInspector(); renderEditorTimeline(); }
function selectRelative(offset: number) { const index = workspace.draft.sections.findIndex((section: any) => section.id === selectedRegionId); const target = workspace.draft.sections[Math.max(0, Math.min(workspace.draft.sections.length - 1, index + offset))]; if (target) selectRegion(target.id); }
function selectedSection() { return workspace?.draft.sections.find((section: any) => section.id === selectedRegionId); }
function selectedCue() { return workspace?.draft.cues.find((cue: any) => cue.targetRegionId === selectedRegionId); }
function sectionById(id: string) { return workspace?.draft.sections.find((section: any) => section.id === id); }
function createRegionFromSelection() { if (selectionStart === null || selectionEnd === null || selectionEnd <= selectionStart) { setEditorStatus("Drag a selection inside one source section first."); return; } const name = prompt("New region name", "New Section"); if (name) void arrange({ type: "create-region-from-selection", startSeconds: selectionStart, endSeconds: selectionEnd, name }); }
function auditionSelectedSource() { const section = selectedSection(); if (!section) return; loopAuditionRegionId = null; $("#loopAudition").classList.remove("active"); window.playback.command("seek", section.sourceStartSeconds); window.playback.command("play"); setEditorStatus(`Auditioning source audio for ${section.name}. Render the arrangement to hear reordered boundaries exactly.`); }
function toggleLoopAudition() { const section = selectedSection(); if (!section) return; loopAuditionRegionId = loopAuditionRegionId === section.id ? null : section.id; $("#loopAudition").classList.toggle("active", loopAuditionRegionId !== null); if (loopAuditionRegionId) { window.playback.command("seek", section.sourceStartSeconds); window.playback.command("play"); setEditorStatus(`Looping the source slice for ${section.name}.`); } else setEditorStatus("Source audition loop released."); }
function auditionSelectedBoundary() { const section = selectedSection(); if (!section) return; const index = workspace.draft.sections.findIndex((item: any) => item.id === section.id), next = workspace.draft.sections[index + 1]; if (!next) { setEditorStatus("The selected region is the end of the arrangement."); return; } if (Math.abs(section.sourceEndSeconds - next.sourceStartSeconds) > .01) { setEditorStatus("This boundary is reordered. Render the arrangement to audition that exact transition."); return; } loopAuditionRegionId = null; window.playback.command("seek", Math.max(section.sourceStartSeconds, section.sourceEndSeconds - 2)); window.playback.command("play"); setEditorStatus(`Auditioning the ${section.name} → ${next.name} boundary.`); }
function editorGrid() { return buildZeroBasedGrid(workspace.draft.selectedBpm, workspace.draft.timeSignature, workspace.draft.durationSeconds); }
function snapToGrid(at: number) { return snapEditorPosition(editorGrid(), at, editorSnapMode); }
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
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height||!buckets.length)return;canvas.width=Math.ceil(rect.width*devicePixelRatio);canvas.height=Math.ceil(rect.height*devicePixelRatio);const context=canvas.getContext("2d")!;context.scale(devicePixelRatio,devicePixelRatio);context.clearRect(0,0,rect.width,rect.height);
  const performanceWaveform=canvas.id==="wave"||canvas.id==="waveProgress",magnitudes=performanceWaveform?buckets.map((bucket:any)=>Math.max(Math.abs(Number(bucket.min)||0),Math.abs(Number(bucket.max)||0))).sort((a:number,b:number)=>a-b):[],reference=performanceWaveform?magnitudes[Math.min(magnitudes.length-1,Math.floor(magnitudes.length*.985))]??1:1,visualGain=performanceWaveform?Math.max(1,Math.min(12,.92/Math.max(.02,reference))):1,mid=rect.height/2,verticalScale=performanceWaveform ? .485 : .86,shape=(value:number)=>{const normalized=Math.min(1,Math.abs(value)*visualGain),defined=performanceWaveform?Math.pow(normalized,.76):normalized;return Math.sign(value)*defined;};
  context.strokeStyle=color;context.globalAlpha=performanceWaveform ? .16 : .18;context.lineWidth=performanceWaveform?3:2;context.beginPath();for(const[index,bucket]of buckets.entries()){const x=(index/buckets.length)*rect.width;context.moveTo(x,mid+shape(bucket.min)*mid*verticalScale);context.lineTo(x,mid+shape(bucket.max)*mid*verticalScale);}context.stroke();
  context.globalAlpha=performanceWaveform ? .96 : .85;context.lineWidth=performanceWaveform?Math.max(1.1,rect.width/buckets.length):1;context.shadowColor=performanceWaveform?color:"transparent";context.shadowBlur=performanceWaveform?2:0;context.beginPath();for(const[index,bucket]of buckets.entries()){const x=(index/buckets.length)*rect.width;context.moveTo(x,mid+shape(bucket.min)*mid*verticalScale);context.lineTo(x,mid+shape(bucket.max)*mid*verticalScale);}context.stroke();context.shadowBlur=0;
  if(performanceWaveform){context.globalAlpha=.2;context.lineWidth=1;context.beginPath();context.moveTo(0,Math.round(mid)+.5);context.lineTo(rect.width,Math.round(mid)+.5);context.stroke();}
}
function formatTime(seconds: number) { const minutes = Math.floor(seconds / 60); return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`; }
function formatGridLocation(seconds: number, grid: readonly any[]) { if (!grid.length) return "1.1"; const closest = grid.reduce((best: any, item: any) => Math.abs(item.timeSeconds - seconds) < Math.abs(best.timeSeconds - seconds) ? item : best); return `${closest.measure}.${closest.beat}`; }
function stemColor(index: number) { return ["#63d8ff", "#74efb8", "#ffc76b", "#b69cff", "#ff78b3", "#84a9ff", "#ff9b71", "#64e0d2"][index % 8]!; }
function setEditorStatus(message: string) { $("#editorStatus").textContent = message; }
function showError(error: unknown) { const message = error instanceof Error ? error.message : String(error); if (editMode) setEditorStatus(message); else { const fault = $("#liveFault"); fault.hidden = false; fault.querySelector("span")!.textContent = message; } }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }

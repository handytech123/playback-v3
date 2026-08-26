export const REMOTE_CONTROL_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#081018">
<title>Playback V3 Remote</title>
<style>
html{font-family:"Segoe UI",Arial,sans-serif;background:#070b10;color:#edf6fc;-webkit-text-size-adjust:100%}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#0d1823,#05080d);color:#edf6fc}
button{font:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:rgba(99,216,255,.2)}
header{position:-webkit-sticky;position:sticky;top:0;z-index:30;padding:10px 14px;border-bottom:1px solid #223442;background:rgba(9,16,24,.98);display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-flex-wrap:wrap;flex-wrap:wrap}
.brand{-webkit-flex:1;flex:1;min-width:180px}.brand span,.label{display:block;color:#63d8ff;font-size:8px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.brand strong{display:block;font-size:17px;margin-top:3px}
.status{margin:4px 12px 4px 0;padding:8px 11px;border:1px solid #27775c;border-radius:30px;background:#102a21;color:#78efb7;font-size:10px;font-weight:900;white-space:nowrap}.status.off{border-color:#79333e;background:#32141a;color:#ff8798}
.transport-mini{display:-webkit-flex;display:flex}.transport-mini button{min-width:58px;min-height:44px;margin-left:7px;border:1px solid #364b5a;border-radius:8px;background:#14212b;color:#eef8fd;font-weight:900}.transport-mini .play{background:#48c7ee;color:#041018}.transport-mini .panic{border-color:#7e3340;background:#34141a;color:#ff9aaa}.transport-mini .panic.active{background:#bd3047;color:white}
main{padding:10px}.set-deck,.now-bar,.timeline-card{margin-bottom:10px}
.set-deck{height:92px;white-space:nowrap;border:2px solid #31485a;border-radius:10px;background:#081018;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
.set-label{display:inline-block;vertical-align:top;width:126px;height:86px;padding:24px 10px;border-right:1px solid #304453;background:#101c25}.set-label span{display:block;color:#8ca3b2;font-size:8px;font-weight:900;letter-spacing:.13em}.set-label strong{display:block;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.set-songs{display:inline-block;vertical-align:top;height:86px;padding:4px;white-space:nowrap}.song-card{display:inline-block;vertical-align:middle;width:165px;height:78px;margin-right:4px;padding:9px 8px;border:2px solid #2e4657;border-radius:7px;background:#101c25;color:#f2f8fb;text-align:left}.song-card b{float:left;width:24px;padding-top:14px;color:#7e99aa;font-size:10px}.song-card strong,.song-card small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.song-card strong{padding-top:10px;font-size:12px}.song-card small{margin-top:5px;color:#a3bac8;font-size:9px}.song-card.active{border-color:#b68cff;background:#1f293c;box-shadow:inset 0 -4px #b68cff}.song-card.active b{color:#b68cff}
.transition{display:inline-block;vertical-align:middle;width:72px;height:56px;margin-right:4px;padding:13px 3px;border:1px solid #684d80;border-radius:8px;background:#1d1428;color:#e7d7f6;text-align:center}.transition span{display:block;color:#bda5d4;font-size:7px;font-weight:900}.transition strong{display:block;overflow:hidden;font-size:8px;text-overflow:ellipsis;white-space:nowrap;margin-top:4px}
.now-bar{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center;padding:10px 12px;border:1px solid #263b4c;border-radius:10px;background:#0c151d}.now-card{-webkit-flex:1;flex:1;min-width:190px;padding:5px}.now-card span{display:block;color:#91a7b5;font-size:8px;font-weight:900;letter-spacing:.14em}.now-card strong{display:block;font-size:24px;margin:4px 0}.now-card small{display:block;color:#a4b9c6;font-size:11px}.clock{padding:5px 12px;text-align:center}.clock span{color:#91a7b5;font-size:8px;font-weight:900;letter-spacing:.13em}.clock strong{display:block;font:bold 26px/1.2 Menlo,Consolas,monospace}.clock small{display:block;margin-top:5px;color:#b7c7d1;font-size:11px}
.action-row{width:100%;margin-top:8px;display:-webkit-flex;display:flex}.action-row button{-webkit-flex:1;flex:1;min-height:46px;margin-right:7px;border:1px solid #3c5263;border-radius:8px;background:#14212b;color:#f2f8fb;font-weight:900;font-size:11px}.action-row button:last-child{margin-right:0}.action-row button.active,.transport-mini button.active{background:#234f3f;border-color:#45c993;color:#95ffd0}
.timeline-card{position:relative;border:2px solid #31495a;border-radius:12px;background:#090f15;overflow:hidden}.ruler,.cue-lane,.wave-wrap{position:relative}.ruler{height:28px;border-bottom:1px solid #263846;background:#0d151d;color:#9bb0be;overflow:hidden}.ruler i,.cue-lane i,.region-block{position:absolute}.ruler i{top:0;height:100%;border-left:1px solid #3a4c59}.ruler span{position:absolute;top:7px;font-size:9px;white-space:nowrap;margin-left:4px}.cue-lane{height:30px;border-bottom:1px solid #21313d;background:#0a1118;overflow:hidden}.cue-lane i{top:5px;width:8px;height:20px;-webkit-transform:translateX(-4px);transform:translateX(-4px);border-radius:3px;background:#ffc04f}.cue-lane i span{position:absolute;left:9px;top:-2px;max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:5px;padding:3px 5px;background:#4b3711;color:#fff0b8;font-size:8px;font-weight:900}
.wave-wrap{height:42vh;min-height:220px;max-height:430px;overflow:hidden;background:repeating-linear-gradient(90deg,rgba(255,255,255,.03) 0,rgba(255,255,255,.03) 1px,transparent 1px,transparent 2.5%);touch-action:none;-webkit-user-select:none;user-select:none}.wave-wrap canvas,.region-layer{position:absolute;left:0;right:0;top:0;bottom:0;width:100%;height:100%}
.region-block{padding:0;top:0;bottom:0;border:0;border-left:2px solid #ef4444;border-right:1px solid rgba(255,255,255,.14);background:rgba(72,84,95,.25);overflow:hidden;text-align:left;-webkit-appearance:none;appearance:none}.region-block.current{box-shadow:inset 0 0 0 2px rgba(255,255,255,.4)}.region-block.selected{outline:2px solid #ffcf5c;outline-offset:-3px}.region-block strong{position:absolute;left:7px;top:9px;max-width:calc(100% - 10px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:5px;padding:5px 7px;background:rgba(0,0,0,.7);color:white;font-size:10px}.region-block small{position:absolute;left:7px;top:40px;color:#d6e2e9;font-size:9px}
.verse{background:rgba(0,119,204,.25)}.chorus{background:rgba(204,0,78,.25)}.bridge{background:rgba(118,0,204,.25)}.pre-chorus{background:rgba(204,41,139,.25)}.tag{background:rgba(204,41,41,.25)}.intro{background:rgba(179,167,36,.25)}.ending,.end,.outro{background:rgba(153,143,31,.25)}.interlude,.turnaround,.vamp{background:rgba(32,175,84,.25)}.instrumental{background:rgba(138,15,136,.25)}.breakdown{background:rgba(187,107,33,.25)}
.playhead{position:absolute;top:0;bottom:0;left:0;z-index:8;width:3px;background:#ffcf5c;box-shadow:0 0 10px #ffcf5c;pointer-events:none}.playhead:before{content:"";position:absolute;top:0;left:-5px;border:7px solid transparent;border-top-color:#ffcf5c}
.timeline-footer{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;padding:5px 10px;border-top:1px solid #263846;background:#0c151d;min-height:52px}.timeline-footer strong{color:#ffcf5c;font-size:13px;margin-right:12px}.timeline-footer span{-webkit-flex:1;flex:1;color:#a5bbc9;font-size:10px;margin-right:10px}.timeline-footer button{min-height:44px;padding:0 10px;border:1px solid #3b5060;border-radius:7px;background:#14212b;color:#f4fbff;font-weight:900;font-size:10px}
.hint{min-height:36px;margin:0;padding:10px 12px;border:1px solid #2c3e4b;border-radius:7px;background:#0b141b;color:#a5bbc9;font-size:11px}.hint.error{border-color:#79333e;color:#ff8798}
@media(max-width:800px){.transport-mini{width:100%;margin-top:8px}.transport-mini button{-webkit-flex:1;flex:1;margin-left:0;margin-right:7px}.transport-mini button:last-child{margin-right:0}.set-label{display:none}.now-card strong{font-size:21px}.clock strong{font-size:24px}.song-card{width:145px}.wave-wrap{height:40vh}}
@media(max-width:560px){main{padding:7px}.now-card,.clock{width:100%;text-align:left}.clock{padding-left:5px}.clock strong{font-size:23px}.song-card{width:128px}.transition{width:58px}.action-row button{font-size:10px;margin-right:4px}.timeline-footer span{font-size:9px}.region-block strong{font-size:9px}}
</style>
</head>
<body>
<header>
  <div class="brand"><span>PLAYBACK V3</span><strong>Performance Remote</strong></div>
  <span id="status" class="status off">OFFLINE</span>
  <div class="transport-mini">
    <button data-command="transport.stop">STOP</button>
    <button class="play" data-command="transport.play">PLAY</button>
    <button data-command="transport.pause">PAUSE</button>
    <button id="pad">PAD</button>
    <button id="panic" class="panic" data-command="panic.enter">PANIC</button>
  </div>
</header>
<main>
  <section class="set-deck"><div class="set-label"><span>CONFIRMED SET</span><strong id="set">Connecting...</strong></div><div id="setSongs" class="set-songs"></div></section>
  <section class="now-bar">
    <article class="now-card"><span>NOW PLAYING</span><strong id="song">Connecting...</strong><small id="section">No section</small></article>
    <div class="clock"><span>ELAPSED / REMAINING</span><strong id="clock">0:00.000 / -0:00.000</strong><small id="songFacts">No song armed</small></div>
    <div class="action-row"><button data-command="section.previous">PREV</button><button data-command="section.next">NEXT</button><button data-command="song.cue-next">CUE NEXT</button><button id="loop">LOOP</button><button id="repeat">REPEAT</button></div>
  </section>
  <section class="timeline-card">
    <div id="ruler" class="ruler"></div>
    <div id="cueLane" class="cue-lane"></div>
    <div id="waveWrap" class="wave-wrap"><canvas id="wave"></canvas><div id="regionLayer" class="region-layer"></div><i id="playhead" class="playhead"></i></div>
    <footer class="timeline-footer"><strong id="touchPosition">1.1</strong><span id="touchHint">Drag or tap the waveform to move the playhead. Tap a region to select. Double-tap a region to jump.</span><button id="centerPlayhead">CENTER</button></footer>
  </section>
  <p id="hint" class="hint">Remote mirrors Performance Mode controls for stage use.</p>
</main>
<script>
(function () {
  'use strict';
  var token = queryValue('token'), state = null, selected = null, lastTap = { id: null, at: 0 };
  var waveform = { key: '', buckets: [], loading: false, error: '' }, setKey = '', timelineKey = '';
  var events = null, lastEventAt = 0, polling = false, stopped = false, connected = false;
  var gesture = null, lastSeekAt = 0, suppressClickUntil = 0, lastTouchAt = 0;
  function $(id) { return document.getElementById(id); }
  function queryValue(name) {
    var pairs = location.search.substring(1).split('&'), i, pair;
    for (i = 0; i < pairs.length; i++) {
      pair = pairs[i].split('=');
      try { if (decodeURIComponent(pair[0]) === name) return decodeURIComponent((pair.slice(1).join('=') || '').replace(/\+/g, ' ')); } catch (ignore) {}
    }
    return '';
  }
  function toggle(node, name, enabled) { if (enabled) node.classList.add(name); else node.classList.remove(name); }
  function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function find(items, predicate) { for (var i = 0; i < items.length; i++) if (predicate(items[i])) return items[i]; return null; }
  function finite(value) { return typeof value === 'number' && isFinite(value); }
  function pad(value, length) { value = String(value); while (value.length < length) value = '0' + value; return value; }
  function hint(message, error) { $('hint').textContent = message; toggle($('hint'), 'error', !!error); }
  function connection(ok) {
    connected = ok;
    $('status').textContent = ok ? (state && state.performance.ready ? 'READY' : 'CONNECTED') : 'OFFLINE';
    toggle($('status'), 'off', !ok);
  }
  function request(method, path, value, callback) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error, payload) { if (finished) return; finished = true; callback(error, payload); }
    xhr.open(method, path, true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    if (method === 'POST') xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 10000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var payload;
      try { payload = JSON.parse(xhr.responseText || '{}'); } catch (error) { finish(new Error('Invalid response from Playback.')); return; }
      if (xhr.status === 401) {
        stopped = true; if (events) events.close(); events = null; connection(false);
        hint('This remote link is not authorized. Open a fresh remote link from Playback Settings.', true);
      }
      finish(xhr.status >= 200 && xhr.status < 300 ? null : new Error(payload.error || (xhr.status ? 'Request failed (' + xhr.status + ')' : 'Playback is unreachable. Check Wi-Fi.')), payload);
    };
    xhr.onerror = function () { finish(new Error('Playback is unreachable. Check Wi-Fi.')); };
    xhr.ontimeout = function () { finish(new Error('Playback did not respond. Check Wi-Fi.')); };
    try { xhr.send(value === null ? null : JSON.stringify(value)); } catch (error) { finish(error); }
  }
  function command(value) {
    if (stopped) return;
    // Never retry a transport command: a lost acknowledgement must not replay an action.
    request('POST', '/api/command', value, function (error) {
      if (error) { hint(error.message, true); return; }
      pollState();
    });
  }
  var buttons = document.querySelectorAll('[data-command]');
  for (var bi = 0; bi < buttons.length; bi++) buttons[bi].onclick = function () { command({ type: this.getAttribute('data-command') }); };
  $('loop').onclick = function () { if (selected) command({ type: 'section.loop', regionId: selected }); else hint('Select a region before enabling Loop.'); };
  $('repeat').onclick = function () { if (selected) command({ type: 'section.repeat-once', regionId: selected }); else hint('Select the region to repeat once.'); };
  $('pad').onclick = function () { if (state) command({ type: 'bus.set', bus: 'pad', enabled: !state.performance.channels.pad }); };
  $('centerPlayhead').onclick = scrollPlayheadIntoView;
  function choose(region) {
    if (!state || Date.now() < suppressClickUntil) return;
    var now = Date.now(); selected = region.id;
    if (state.performance.panicActive) { command({ type: 'panic.recover', regionId: region.id }); hint('Recovery armed for ' + region.name); }
    else if (lastTap.id === region.id && now - lastTap.at < 550) { command({ type: 'section.jump', regionId: region.id }); hint('Jump armed for ' + region.name); lastTap = { id: null, at: 0 }; }
    else { lastTap = { id: region.id, at: now }; hint(state.performance.playing ? 'Tap again to jump to ' + region.name : 'Selected ' + region.name); }
    render(state);
  }
  function regionTarget(node) { while (node && node !== $('waveWrap')) { if (node.classList && node.classList.contains('region-block')) return true; node = node.parentNode; } return false; }
  function seekAt(clientX, commit) {
    var song = currentSong(), rect = $('waveWrap').getBoundingClientRect();
    if (!song || !rect.width) return;
    var seconds = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * song.durationSeconds;
    $('touchPosition').textContent = gridTime(seconds, song);
    if (commit || Date.now() - lastSeekAt > 120) { lastSeekAt = Date.now(); command({ type: 'transport.seek', seconds: seconds }); }
  }
  function begin(x, target, id) { gesture = { start: x, last: x, region: regionTarget(target), moved: false, id: id }; if (!gesture.region) seekAt(x, true); }
  function move(x, event) { if (!gesture) return; gesture.last = x; if (Math.abs(x - gesture.start) > 8) gesture.moved = true; if (gesture.moved || !gesture.region) { if (event.cancelable !== false) event.preventDefault(); seekAt(x, false); } }
  function end(x, event) { if (!gesture) return; if (gesture.moved || !gesture.region) { if (event.cancelable !== false) event.preventDefault(); suppressClickUntil = Date.now() + 700; seekAt(x, true); } gesture = null; }
  var wrap = $('waveWrap');
  if (window.PointerEvent && wrap.setPointerCapture) {
    wrap.addEventListener('pointerdown', function (event) { if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return; begin(event.clientX, event.target, event.pointerId); if (!gesture.region) wrap.setPointerCapture(event.pointerId); }, false);
    wrap.addEventListener('pointermove', function (event) { if (gesture && gesture.id === event.pointerId) { move(event.clientX, event); if (gesture.moved) wrap.setPointerCapture(event.pointerId); } }, false);
    wrap.addEventListener('pointerup', function (event) { if (!gesture || gesture.id !== event.pointerId) return; end(event.clientX, event); if (wrap.hasPointerCapture && wrap.hasPointerCapture(event.pointerId)) wrap.releasePointerCapture(event.pointerId); }, false);
    wrap.addEventListener('pointercancel', function () { gesture = null; }, false);
  } else {
    wrap.addEventListener('touchstart', function (event) { lastTouchAt = Date.now(); if (event.touches.length !== 1) { gesture = null; return; } var touch = event.touches[0]; begin(touch.clientX, event.target, touch.identifier); if (!gesture.region) event.preventDefault(); }, false);
    wrap.addEventListener('touchmove', function (event) { if (gesture && event.touches.length === 1 && event.touches[0].identifier === gesture.id) move(event.touches[0].clientX, event); }, false);
    wrap.addEventListener('touchend', function (event) { lastTouchAt = Date.now(); if (!gesture) return; var touch = find(event.changedTouches, function (item) { return item.identifier === gesture.id; }); if (touch) end(touch.clientX, event); }, false);
    wrap.addEventListener('touchcancel', function () { gesture = null; }, false);
    wrap.addEventListener('mousedown', function (event) { if (event.button !== 0 || Date.now() - lastTouchAt < 800) return; begin(event.clientX, event.target, 'mouse'); }, false);
    window.addEventListener('mousemove', function (event) { if (gesture && gesture.id === 'mouse') move(event.clientX, event); }, false);
    window.addEventListener('mouseup', function (event) { if (gesture && gesture.id === 'mouse') end(event.clientX, event); }, false);
  }
  function render(next) {
    if (!next || !next.performance || !next.songs) return;
    if (state && next.updatedAt && state.updatedAt && next.updatedAt < state.updatedAt) return;
    var oldSong = currentSong(); state = next;
    var p = next.performance, song = currentSong(), current = song && find(song.regions || [], function (region) { return region.id === p.currentRegionId; });
    if (!oldSong || !song || oldSong.index !== song.index || oldSong.waveformPath !== song.waveformPath) { selected = null; lastTap = { id: null, at: 0 }; }
    var duration = song ? Math.max(0.001, song.durationSeconds) : 1, position = Math.min(duration, Math.max(0, p.positionSeconds));
    $('set').textContent = next.setName; $('song').textContent = song ? song.title : 'No song armed'; $('section').textContent = current ? current.name : 'No section';
    $('clock').textContent = format(position) + ' / -' + format(Math.max(0, duration - position));
    $('songFacts').textContent = song ? (song.arrangement || 'Original Song') + ' | ' + song.key + ' | ' + song.bpm + ' BPM' : 'No song armed';
    $('status').textContent = p.ready ? 'READY' : 'CHECK PLAYBACK'; toggle($('status'), 'off', !p.ready);
    $('panic').textContent = p.panicActive ? 'PANIC ACTIVE' : 'PANIC'; toggle($('panic'), 'active', p.panicActive);
    $('pad').textContent = song ? 'PAD ' + song.key : 'PAD'; toggle($('pad'), 'active', !!p.channels.pad);
    toggle($('loop'), 'active', !!p.loopRegionId); toggle($('repeat'), 'active', !!p.recoveryRegionId && !p.loopRegionId);
    $('playhead').style.left = position / duration * 100 + '%'; if (!gesture) $('touchPosition').textContent = gridTime(position, song);
    renderSet(next); renderTimeline(song, p); loadWaveform(song);
  }
  function renderSet(next) {
    var key = JSON.stringify([next.setName, next.songs, next.transitions, next.performance.songIndex]); if (key === setKey) return; setKey = key;
    var holder = $('setSongs'), scroll = holder.parentNode.scrollLeft; empty(holder);
    for (var index = 0; index < next.songs.length; index++) (function (song, songIndex) {
      if (songIndex) { var transition = find(next.transitions || [], function (item) { return item.fromSongIndex === songIndex - 1; }), card = document.createElement('div'); card.className = 'transition'; card.innerHTML = '<span>TRANSITION</span><strong>' + escapeHtml(transition ? transitionName(transition.type) : 'CUE NEXT') + '</strong>'; holder.appendChild(card); }
      var button = document.createElement('button'); button.className = 'song-card' + (songIndex === next.performance.songIndex ? ' active' : '');
      button.innerHTML = '<b>' + pad(songIndex + 1, 2) + '</b><strong>' + escapeHtml(song.title) + '</strong><small>' + escapeHtml(song.key) + ' | ' + song.bpm + ' BPM</small>';
      button.onclick = function () { command({ type: 'song.select', index: songIndex }); }; holder.appendChild(button);
    }(next.songs[index], index));
    holder.parentNode.scrollLeft = scroll;
  }
  function renderTimeline(song, p) {
    var key = JSON.stringify([song, p.currentRegionId, selected]); if (key === timelineKey) return; timelineKey = key;
    empty($('ruler')); empty($('cueLane')); empty($('regionLayer')); if (!song) return;
    var duration = Math.max(0.001, song.durationSeconds), i, mark, label, cues = song.cues || [], regions = song.regions || [];
    for (i = 0; i <= 10; i++) { mark = document.createElement('i'); label = document.createElement('span'); mark.style.left = i * 10 + '%'; label.style.left = i * 10 + '%'; label.textContent = gridTime(duration * i / 10, song); $('ruler').appendChild(mark); $('ruler').appendChild(label); }
    for (i = 0; i < cues.length; i++) { var cue = cues[i]; mark = document.createElement('i'); mark.style.left = cue.atSeconds / duration * 100 + '%'; mark.title = cue.phrase + ' ' + positionLabel(cue.position); mark.innerHTML = '<span>' + escapeHtml(cue.phrase) + '</span>'; $('cueLane').appendChild(mark); }
    for (i = 0; i < regions.length; i++) (function (region) {
      var block = document.createElement('button'); block.className = 'region-block ' + regionClass(region.name) + (region.id === p.currentRegionId ? ' current' : '') + (region.id === selected ? ' selected' : '');
      block.style.left = region.startSeconds / duration * 100 + '%'; block.style.width = Math.max(0.25, (region.endSeconds - region.startSeconds) / duration * 100) + '%';
      block.innerHTML = '<strong>' + escapeHtml(region.name) + '</strong><small>' + positionLabel(region.startPosition, gridTime(region.startSeconds, song)) + '</small>';
      block.onclick = function (event) { event.stopPropagation(); choose(region); }; $('regionLayer').appendChild(block);
    }(regions[i]));
  }
  function loadWaveform(song) {
    if (!song) return;
    var key = (song.waveformPath || '') + '|' + song.index + '|' + song.durationSeconds;
    if (waveform.key === key) return;
    waveform = { key: key, buckets: [], loading: true, error: '' }; drawWaveform();
    request('GET', '/api/waveform?index=' + song.index, null, function (error, payload) {
      if (waveform.key !== key) return;
      waveform = { key: key, buckets: !error && Array.isArray(payload.buckets) ? payload.buckets : [], loading: false, error: error ? error.message : '' }; drawWaveform();
    });
  }
  function drawWaveform() {
    var canvas = $('wave'), rect = canvas.getBoundingClientRect(), scale = Math.min(2, window.devicePixelRatio || 1), context = canvas.getContext('2d'); if (!context) return;
    canvas.width = Math.max(1, Math.floor(rect.width * scale)); canvas.height = Math.max(1, Math.floor(rect.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, rect.width, rect.height);
    var mid = rect.height / 2, buckets = waveform.buckets, i;
    if (!buckets.length) { context.strokeStyle = 'rgba(99,216,255,0.33)'; context.beginPath(); context.moveTo(0, mid); context.lineTo(rect.width, mid); context.stroke(); context.fillStyle = waveform.error ? '#ff8798' : '#91a7b5'; context.font = 'bold 11px Arial,sans-serif'; context.textAlign = 'center'; context.fillText(waveform.loading ? 'LOADING WAVEFORM' : waveform.error || 'WAVEFORM NOT PREPARED', rect.width / 2, mid - 12); return; }
    var magnitudes = [], reference, gain;
    for (i = 0; i < buckets.length; i++) magnitudes.push(Math.max(Math.abs(Number(buckets[i].min) || 0), Math.abs(Number(buckets[i].max) || 0)));
    magnitudes.sort(function (a, b) { return a - b; }); reference = magnitudes[Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * 0.985))] || 1; gain = Math.max(1, Math.min(12, 0.92 / Math.max(0.02, reference)));
    context.strokeStyle = '#63d8ff'; context.lineWidth = Math.max(1, rect.width / buckets.length); context.beginPath();
    for (i = 0; i < buckets.length; i++) { var bucket = buckets[i], x = i / buckets.length * rect.width, min = Math.max(-1, Math.min(1, (Number(bucket.min) || 0) * gain)), max = Math.max(-1, Math.min(1, (Number(bucket.max) || 0) * gain)); context.moveTo(x, mid + min * mid * 0.84); context.lineTo(x, mid + max * mid * 0.84); } context.stroke();
  }
  function scrollPlayheadIntoView() { var wrap = $('waveWrap'), head = $('playhead').getBoundingClientRect(), box = wrap.getBoundingClientRect(); if (head.left < box.left || head.right > box.right) wrap.scrollLeft += head.left - box.left - box.width * 0.45; }
  function currentSong() { return state && state.songs[state.performance.songIndex]; }
  function transitionName(value) { return { 'cue-next': 'CUE NEXT', 'stay-in-song': 'STAY', 'auto-link': 'AUTO LINK', overlap: 'OVERLAP', crossfade: 'CROSSFADE' }[value] || String(value).toUpperCase(); }
  function regionClass(name) { var value = String(name).toLowerCase().replace(/[_-]+/g, ' '), types = ['chorus','verse','bridge','instrumental','turnaround','interlude','breakdown','vamp','outro','intro','tag','ending','end']; if (value.indexOf('pre chorus') >= 0 || value.indexOf('prechorus') >= 0) return 'pre-chorus'; for (var i = 0; i < types.length; i++) if (value.indexOf(types[i]) >= 0) return types[i]; return 'other'; }
  function gridTime(seconds, song) {
    if (!song) return '1.1'; var perMeasure = Math.max(1, Number((song.timeSignature || {}).numerator) || 4), anchors = gridAnchors(song);
    if (anchors.length) { var previous = anchors[0], next = anchors[anchors.length - 1]; for (var i = 0; i < anchors.length; i++) { if (anchors[i].seconds <= seconds + 0.0001) previous = anchors[i]; if (anchors[i].seconds >= seconds - 0.0001) { next = anchors[i]; break; } } var beat = previous.gridBeat; if (next.seconds > previous.seconds) beat += (next.gridBeat - previous.gridBeat) * Math.max(0, Math.min(1, (seconds - previous.seconds) / (next.seconds - previous.seconds))); else if (seconds > previous.seconds && song.durationSeconds > previous.seconds) beat += (seconds - previous.seconds) / Math.max(0.001, song.durationSeconds - previous.seconds) * (Math.max(0, next.gridBeat - previous.gridBeat) || perMeasure); return gridBeatLabel(beat, perMeasure); }
    return gridBeatLabel(Math.max(0, Math.round(seconds / (60 / Math.max(1, Number(song.bpm) || 120)))), perMeasure);
  }
  function gridAnchors(song) { var anchors = [], regions = song.regions || [], cues = song.cues || [], i; for (i = 0; i < regions.length; i++) { addAnchor(anchors, regions[i].startSeconds, regions[i].startPosition, song.timeSignature); addAnchor(anchors, regions[i].endSeconds, regions[i].endPosition, song.timeSignature); } for (i = 0; i < cues.length; i++) addAnchor(anchors, cues[i].atSeconds, cues[i].position, song.timeSignature); return anchors.sort(function (a, b) { return a.seconds - b.seconds; }); }
  function addAnchor(anchors, seconds, position, meter) { if (!position || !finite(seconds)) return; var perMeasure = Math.max(1, Number(meter && meter.numerator) || 4), measure = Number(position.measure), beat = Number(position.beat); if (finite(measure) && finite(beat)) anchors.push({ seconds: seconds, gridBeat: (measure - 1) * perMeasure + beat - 1 + (Number(position.tick) || 0) / 960 }); }
  function gridBeatLabel(beat, perMeasure) { var whole = Math.max(0, Math.round(beat)); return Math.floor(whole / perMeasure) + 1 + '.' + (whole % perMeasure + 1); }
  function positionLabel(position, fallback) { return position && finite(position.measure) && finite(position.beat) ? position.measure + '.' + position.beat : fallback || ''; }
  function format(value) { var minutes = Math.floor(value / 60); return minutes + ':' + pad((value - minutes * 60).toFixed(3), 6); }
  function escapeHtml(value) { var node = document.createElement('div'); node.textContent = String(value); return node.innerHTML; }
  function pollState() {
    if (polling || stopped || document.hidden) return; polling = true;
    request('GET', '/api/state', null, function (error, next) { polling = false; if (error) { connection(false); if (!stopped) hint(error.message, true); return; } connected = true; render(next); });
  }
  function connectEvents() {
    if (stopped || document.hidden || !window.EventSource || events) return;
    try { events = new EventSource('/api/events?token=' + encodeURIComponent(token)); events.addEventListener('state', function (event) { try { var next = JSON.parse(event.data); lastEventAt = Date.now(); connected = true; render(next); } catch (error) { hint('Could not read an update from Playback.', true); } }, false); events.onerror = function () { connection(false); pollState(); }; } catch (ignore) { events = null; }
  }
  function wake() { gesture = null; if (document.hidden) { if (events) events.close(); events = null; return; } if (waveform.error) waveform.key = ''; pollState(); connectEvents(); drawWaveform(); }
  window.addEventListener('resize', drawWaveform, false); window.addEventListener('orientationchange', function () { setTimeout(drawWaveform, 250); }, false);
  window.addEventListener('online', wake, false); window.addEventListener('pageshow', wake, false); document.addEventListener('visibilitychange', wake, false);
  window.addEventListener('pagehide', function () { if (events) events.close(); events = null; gesture = null; }, false);
  if (!token) { stopped = true; hint('Open the complete remote link from Playback Settings, including its access token.', true); }
  else { pollState(); connectEvents(); setInterval(function () { if (Date.now() - lastEventAt > 4500) pollState(); }, 2000); }
}());
</script>
</body>
</html>`;

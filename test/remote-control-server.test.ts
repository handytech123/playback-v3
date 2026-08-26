import test from "node:test";
import assert from "node:assert/strict";
import { RemoteControlServer } from "../src/control/remote-server.js";
import { PlaybackCommandBus } from "../src/control/command-bus.js";
import { PerformanceSession, type PerformanceEffects } from "../src/live/performance-session.js";
import type { ConfirmedSetManifest } from "../src/confirmed-set/manifest.js";
import { songId } from "../src/domain/song.js";
import { createSocket } from "node:dgram";
import { encodeOscMessage } from "../src/control/osc.js";
import { connect, createServer as createTcpServer } from "node:net";
import { request as httpRequest, type ServerResponse } from "node:http";
import { EventEmitter, once } from "node:events";
import { mkdtemp, writeFile, rm, utimes, stat, rename } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import type { RemoteControlOptions } from "../src/control/remote-server.js";

test("remote server requires a token and returns command/state acknowledgements", async () => {
  const calls: string[] = [], effects: PerformanceEffects = { play: () => calls.push("play"), pause: () => {}, stop: () => calls.push("stop"), seek: () => {}, panic: () => {}, announceRecovery: () => {}, cancelTransition: () => {}, recover: () => {}, setBus: () => {}, selectSong: async () => {} };
  const manifest: ConfirmedSetManifest = { schemaVersion: 1, id: "set", name: "Sunday", confirmedAt: "now", songs: [{ song: { id: songId("song"), title: "Song", artist: "Artist", vendor: "Vendor", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } }, selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 4, stems: [{ role: "music", sourcePath: "cache/audio.wav", durationSeconds: 4 }], regions: [{ id: "verse", name: "Verse", startSeconds: 0, endSeconds: 4 }], cues: [], cacheFingerprint: "hash", liveAssets: { click: { regularPath: "click", accentPath: "accent", events: [{ atSeconds: 0, accent: true }] }, repeatCuePath: "repeat", cues: [], pad: { key: "C", audioPath: "pad" } } }] };
  const bus = new PlaybackCommandBus(new PerformanceSession(manifest, effects), manifest.name), server = new RemoteControlServer(bus, { token: "0123456789abcdef", enableOsc: false }); const address = await server.start(), base = `http://${address.host}:${address.httpPort}`;
  try { assert.equal((await fetch(`${base}/api/state`)).status, 401); const page = await fetch(`${base}/?token=0123456789abcdef`); assert.equal(page.status, 200); const html=await page.text();assert.match(html,/Double-tap a region/);assert.match(html,/Performance Remote/);assert.match(html,/id="setSongs"/);assert.doesNotMatch(html,/mixer/i); const headers = { Authorization: "Bearer 0123456789abcdef", "Content-Type": "application/json" }; const response = await fetch(`${base}/api/command`, { method: "POST", headers, body: JSON.stringify({ type: "transport.play" }) }); assert.equal(response.status, 200); const result = await response.json() as { ok: boolean; state: { playing: boolean } }; assert.equal(result.ok, true); assert.equal(result.state.playing, true); const state = await (await fetch(`${base}/api/state`, { headers })).json() as { revision: number; songs:{durationSeconds:number;key:string;bpm:number}[];performance: { playing: boolean } }; assert.equal(state.revision, 1);assert.deepEqual(state.songs.map(song=>[song.durationSeconds,song.key,song.bpm]),[[4,"C",120]]); assert.equal(state.performance.playing, true); assert.deepEqual(calls, ["play"]); } finally { await server.close(); }
});

test("OSC dispatches through the command bus and requires its token on LAN", async () => {
  const calls:string[]=[],effects:PerformanceEffects={play:()=>calls.push("play"),pause:()=>{},stop:()=>{},seek:()=>{},panic:()=>{},announceRecovery:()=>{},cancelTransition:()=>{},recover:()=>{},setBus:()=>{},selectSong:async()=>{}};
  const manifest:ConfirmedSetManifest={schemaVersion:1,id:"set",name:"Set",confirmedAt:"now",songs:[{song:{id:songId("s"),title:"S",artist:"A",vendor:"V",originalKey:"C",originalBpm:120,originalTimeSignature:{numerator:4,denominator:4}},selectedKey:"C",selectedBpm:120,timeSignature:{numerator:4,denominator:4},durationSeconds:1,stems:[{role:"music",sourcePath:"x",durationSeconds:1}],regions:[{id:"r",name:"R",startSeconds:0,endSeconds:1}],cues:[],cacheFingerprint:"x",liveAssets:{click:{regularPath:"x",accentPath:"x",events:[{atSeconds:0,accent:true}]},repeatCuePath:"x",cues:[],pad:{key:"C",audioPath:"x"}}}]};
  const bus=new PlaybackCommandBus(new PerformanceSession(manifest,effects),"Set"),server=new RemoteControlServer(bus,{token:"0123456789abcdef",enableOsc:true,oscTokenRequired:true});const address=await server.start(),socket=createSocket("udp4");
  try{await send(socket,encodeOscMessage({address:"/playback/play",args:[]}),address.oscPort!);await delay(20);assert.deepEqual(calls,[]);const done=new Promise<void>(resolve=>{const off=bus.onResult(()=>{off();resolve();});});await send(socket,encodeOscMessage({address:"/playback/play",args:["0123456789abcdef"]}),address.oscPort!);await done;assert.deepEqual(calls,["play"]);}finally{socket.close();await server.close();}
});

function send(socket:ReturnType<typeof createSocket>,packet:Buffer,port:number):Promise<void>{return new Promise((resolve,reject)=>socket.send(packet,port,"127.0.0.1",error=>error?reject(error):resolve()));}
function delay(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}

const token = "hardening-test-token-only";
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
function fixture(options: Partial<RemoteControlOptions> = {}, waveformPaths: string[] = []) {
  const calls: string[] = [];
  const effects: PerformanceEffects = {
    play: () => calls.push("play"), pause: () => calls.push("pause"), stop: () => calls.push("stop"),
    seek: () => calls.push("seek"), panic: () => calls.push("panic"), setBus: () => {},
    announceRecovery: () => {}, cancelTransition: () => {}, recover: () => {}, selectSong: async index => { calls.push(`song:${index}`); },
  };
  const songs = Array.from({ length: Math.max(2, waveformPaths.length) }, (_, index) => ({
    song: { id: songId(`song-${index}`), title: `Song ${index}`, artist: "Test", vendor: "Test", originalKey: "C", originalBpm: 120, originalTimeSignature: { numerator: 4, denominator: 4 } },
    selectedKey: "C", selectedBpm: 120, timeSignature: { numerator: 4, denominator: 4 }, durationSeconds: 8,
    stems: [{ role: "music", sourcePath: "test-only.wav", durationSeconds: 8 }],
    regions: [{ id: "verse", name: "Verse", startSeconds: 0, endSeconds: 8 }], cues: [], cacheFingerprint: "test",
    ...(waveformPaths[index] ? { waveformPath: waveformPaths[index] } : {}),
  }));
  const manifest: ConfirmedSetManifest = { schemaVersion: 1, id: "test", name: "Test only", confirmedAt: "now", songs };
  const bus = new PlaybackCommandBus(new PerformanceSession(manifest, effects), manifest.name);
  return { server: new RemoteControlServer(bus, { token, enableOsc: false, ...options }), bus, calls, effects };
}
const urlFor = (address: { host: string; httpPort: number }) => `http://${address.host}:${address.httpPort}`;
const command = (base: string, value: unknown) => fetch(`${base}/api/command`, { method: "POST", headers: auth, body: JSON.stringify(value) });
async function until(condition: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) { if (Date.now() > deadline) throw new Error("Condition timed out"); await delay(5); }
}

test("UDP bind failure releases HTTP and permits retrying the same server instance", { timeout: 5000 }, async t => {
  const occupied = createSocket("udp4"); occupied.bind(0, "127.0.0.1"); await once(occupied, "listening");
  const { server, calls } = fixture({ enableOsc: true, oscPort: occupied.address().port });
  t.after(() => server.close());
  await assert.rejects(server.start(), /EADDRINUSE/);
  assert.equal(server["http"], null);
  await new Promise<void>(resolve => occupied.close(() => resolve()));
  const address = await server.start();
  assert.equal((await fetch(`${urlFor(address)}/api/state`, { headers: auth })).status, 200);
  assert.deepEqual(calls, []);
});

test("HTTP bind failure rolls back lifecycle and does not strand close", { timeout: 5000 }, async t => {
  const occupied = createTcpServer(); occupied.listen(0, "127.0.0.1"); await once(occupied, "listening");
  const port = (occupied.address() as { port: number }).port;
  const { server } = fixture({ httpPort: port }); t.after(() => server.close());
  await assert.rejects(server.start(), /EADDRINUSE/);
  await server.close();
  await new Promise<void>(resolve => occupied.close(() => resolve()));
  assert.equal((await server.start()).httpPort, port);
});

test("close during startup cancels safely and repeated close calls are harmless", { timeout: 5000 }, async () => {
  const { server, calls } = fixture({ enableOsc: true });
  const starting = server.start(); const rejection = assert.rejects(starting, /cancelled/);
  await Promise.all([server.close(), server.close(), rejection]);
  await server.start(); await server.close(); await server.close();
  assert.deepEqual(calls, []);
});

test("shutdown disconnects unfinished HTTP requests instead of waiting for their bodies", { timeout: 5000 }, async t => {
  const { server, calls } = fixture(), address = await server.start(); t.after(() => server.close());
  const socket = connect(address.httpPort, address.host); socket.on("error", () => {}); await once(socket, "connect");
  socket.write(`POST /api/command HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Length: 1000\r\n\r\n{`);
  await until(() => server["connections"].size === 1);
  const start = Date.now(); await server.close(); assert.ok(Date.now() - start < 1000);
  socket.destroy(); assert.deepEqual(calls, []);
});

test("malformed URLs, JSON, oversized bodies, and wrong tokens do not reach playback", { timeout: 5000 }, async t => {
  const { server, calls } = fixture(), address = await server.start(), base = urlFor(address); t.after(() => server.close());
  const malformed = await new Promise<number>(resolve => {
    const request = httpRequest({ host: address.host, port: address.httpPort, path: "http://[", headers: auth }, response => { response.resume(); resolve(response.statusCode!); });
    request.end();
  });
  assert.equal(malformed, 400);
  assert.equal((await fetch(`${base}/api/command`, { method: "POST", headers: auth, body: "{" })).status, 400);
  assert.equal((await fetch(`${base}/api/command`, { method: "POST", headers: auth, body: "x".repeat(70_000) })).status, 413);
  assert.equal((await fetch(`${base}/api/command`, { method: "POST", headers: { Authorization: "Bearer wrong" }, body: '{"type":"transport.play"}' })).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: auth })).status, 200); assert.deepEqual(calls, []);
});

test("a stalled command body expires without being dispatched", { timeout: 5000 }, async t => {
  const { server, calls } = fixture({ limits: { commandBodyTimeoutMs: 40 } }), address = await server.start(); t.after(() => server.close());
  const socket = connect(address.httpPort, address.host); let reply = "";
  socket.on("data", data => { reply += data; }); socket.on("error", () => {});
  await once(socket, "connect");
  socket.write(`POST /api/command HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Length: 1000\r\n\r\n{`);
  await until(() => reply.includes("408")); socket.destroy();
  assert.match(reply, /no command was queued/); assert.deepEqual(calls, []);
});

test("aborting a partial request leaves the remote usable and dispatches nothing", { timeout: 5000 }, async t => {
  const { server, calls } = fixture(), address = await server.start(); t.after(() => server.close());
  const socket = connect(address.httpPort, address.host); socket.on("error", () => {}); await once(socket, "connect");
  socket.write(`POST /api/command HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Length: 1000\r\n\r\n{`);
  await delay(10); socket.destroy(); await delay(10);
  assert.equal((await fetch(`${urlFor(address)}/api/state`, { headers: auth })).status, 200); assert.deepEqual(calls, []);
});

class FakeEventResponse extends EventEmitter {
  destroyed = false; writableEnded = false; blocked = false; throws = false;
  events: string[] = [];
  writeHead() { return this; }
  write(event: string) { if (this.throws) throw new Error("broken tablet socket"); this.events.push(event); return !this.blocked; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } return this; }
  asResponse() { return this as unknown as ServerResponse; }
}

test("slow event consumers keep only the latest update and recover on drain", async t => {
  const { server, bus } = fixture(); t.after(() => server.close());
  const response = new FakeEventResponse(); response.blocked = true;
  server["openEvents"](response.asResponse());
  for (let n = 0; n < 200; n++) server["broadcast"]({ ...bus.state(), revision: n });
  assert.equal(response.events.length, 1); assert.equal(server["streams"].size, 1);
  response.blocked = false; response.emit("drain");
  assert.equal(response.events.length, 2); assert.match(response.events[1]!, /"revision":199/);
  assert.equal(server["streams"].get(response.asResponse())!.pending, null);
});

test("a broken event stream cannot fail an applied command or another tablet's update", async t => {
  const { server, bus, calls } = fixture(); await server.start(); t.after(() => server.close());
  const broken = new FakeEventResponse(), healthy = new FakeEventResponse();
  server["openEvents"](broken.asResponse()); server["openEvents"](healthy.asResponse()); broken.throws = true;
  const result = await bus.dispatch({ type: "transport.play" });
  assert.equal(result.ok, true); assert.deepEqual(calls, ["play"]); assert.equal(broken.destroyed, true);
  assert.equal(healthy.events.length, 2); assert.match(healthy.events[1]!, /"playing":true/);
});

test("a tablet that never drains is disconnected without touching playback", async t => {
  const { server, calls } = fixture({ limits: { eventDrainTimeoutMs: 20 } }); t.after(() => server.close());
  const response = new FakeEventResponse(); response.blocked = true; server["openEvents"](response.asResponse());
  await until(() => response.destroyed); assert.equal(server["streams"].size, 0); assert.deepEqual(calls, []);
});

test("event connection limits preserve state polling and free slots on disconnect", { timeout: 5000 }, async t => {
  const { server } = fixture({ limits: { maxEventStreams: 1 } }), base = urlFor(await server.start()); t.after(() => server.close());
  const stream = await fetch(`${base}/api/events`, { headers: auth }); assert.equal(stream.status, 200);
  assert.equal((await fetch(`${base}/api/events`, { headers: auth })).status, 503);
  assert.equal((await fetch(`${base}/api/state`, { headers: auth })).status, 200);
  await stream.body!.cancel(); await until(() => server["streams"].size === 0);
  const next = await fetch(`${base}/api/events`, { headers: auth }); assert.equal(next.status, 200); await next.body!.cancel();
});

test("the remote command queue is bounded and rejected actions are never replayed", { timeout: 5000 }, async t => {
  const { server, effects, calls } = fixture({ limits: { maxPendingCommands: 2 } });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(effects, "selectSong", async () => { calls.push("select"); await gate; });
  const base = urlFor(await server.start()); t.after(() => { release(); return server.close(); });
  const selection = command(base, { type: "song.select", index: 1 });
  await until(() => calls.includes("select"));
  const play = command(base, { type: "transport.play" }); await until(() => server["pendingCommands"] === 2);
  assert.equal((await command(base, { type: "transport.pause" })).status, 429);
  release(); assert.equal((await selection).status, 200); assert.equal((await play).status, 200);
  assert.ok(!calls.includes("pause")); assert.equal(server["pendingCommands"], 0);
  assert.equal((await command(base, { type: "transport.pause" })).status, 200);
});

test("waveform reads use bounded LRU caching, refresh changed data, and isolate corrupt files", { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "remote-wave-test-"));
  t.after(async () => { const rel = relative(tmpdir(), root); if (rel.startsWith("remote-wave-test-") && !rel.includes(sep)) await rm(root, { recursive: true, force: true }); });
  const paths = [0, 1, 2].map(index => join(root, `${index}.json`));
  for (const path of paths) await writeFile(path, JSON.stringify({ buckets: [{ min: -.2, max: .3 }] }));
  const { server, calls } = fixture({ limits: { maxCachedWaveforms: 2, maxWaveformCacheBytes: 500, maxWaveformBytes: 1024 } }, paths);
  const base = urlFor(await server.start()); t.after(() => server.close());
  for (const index of [0, 1, 0, 2]) assert.equal((await fetch(`${base}/api/waveform?index=${index}`, { headers: auth })).status, 200);
  assert.deepEqual([...server["waveformCache"].keys()], [paths[0], paths[2]]);
  await writeFile(paths[0]!, JSON.stringify({ buckets: [{ min: -.7, max: .8 }] })); await utimes(paths[0]!, new Date(), new Date(Date.now() + 2000));
  const updated = await (await fetch(`${base}/api/waveform?index=0`, { headers: auth })).json() as { buckets: { min: number }[] }; assert.equal(updated.buckets[0]!.min, -.7);
  await writeFile(paths[1]!, "{"); assert.equal((await fetch(`${base}/api/waveform?index=1`, { headers: auth })).status, 404);
  await writeFile(paths[1]!, JSON.stringify({ notBuckets: [] })); assert.equal((await fetch(`${base}/api/waveform?index=1`, { headers: auth })).status, 422);
  for (const buckets of [[null], [{ min: "-0.2", max: .3 }], [{ min: 0 }]]) {
    await writeFile(paths[1]!, JSON.stringify({ buckets })); assert.equal((await fetch(`${base}/api/waveform?index=1`, { headers: auth })).status, 422);
  }
  await writeFile(paths[1]!, " ".repeat(1025)); assert.equal((await fetch(`${base}/api/waveform?index=1`, { headers: auth })).status, 413);
  assert.equal((await fetch(`${base}/api/waveform?index=-1`, { headers: auth })).status, 400);
  assert.equal((await fetch(`${base}/api/state`, { headers: auth })).status, 200); assert.deepEqual(calls, []);
});

test("simultaneous waveform requests share work and cache bytes remain bounded", { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "remote-wave-test-"));
  t.after(async () => { const rel = relative(tmpdir(), root); if (rel.startsWith("remote-wave-test-") && !rel.includes(sep)) await rm(root, { recursive: true, force: true }); });
  const paths = [0, 1, 2].map(index => join(root, `${index}.json`));
  const payload = JSON.stringify({ buckets: Array.from({ length: 2400 }, () => ({ min: -.5, max: .4 })) });
  for (const path of paths) await writeFile(path, payload);
  const { server } = fixture({ limits: { maxWaveformCacheBytes: Buffer.byteLength(payload) + 1 } }, paths), base = urlFor(await server.start()); t.after(() => server.close());
  const responses = await Promise.all(Array.from({ length: 32 }, () => fetch(`${base}/api/waveform?index=0`, { headers: auth })));
  assert.ok(responses.every(response => response.status === 200)); await Promise.all(responses.map(response => response.arrayBuffer()));
  for (const index of [1, 2]) { const response = await fetch(`${base}/api/waveform?index=${index}`, { headers: auth }); assert.equal(response.status, 200); await response.arrayBuffer(); }
  assert.equal(server["waveformCache"].size, 1); assert.equal(server["waveformCacheBytes"], Buffer.byteLength(payload));
  assert.equal(server["waveformReads"].size, 0);
});

test("atomic waveform replacement with preserved size and modification time is not stale", { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "remote-wave-test-"));
  t.after(async () => { const rel = relative(tmpdir(), root); if (rel.startsWith("remote-wave-test-") && !rel.includes(sep)) await rm(root, { recursive: true, force: true }); });
  const waveform = join(root, "wave.json"), replacement = join(root, "replacement.json");
  await writeFile(waveform, JSON.stringify({ buckets: [{ min: -.1, max: .2 }] })); const info = await stat(waveform);
  const { server } = fixture({}, [waveform]), base = urlFor(await server.start()); t.after(() => server.close());
  await (await fetch(`${base}/api/waveform`, { headers: auth })).arrayBuffer();
  await writeFile(replacement, JSON.stringify({ buckets: [{ min: -.8, max: .9 }] })); await utimes(replacement, info.atime, info.mtime);
  await rename(replacement, waveform);
  const next = await (await fetch(`${base}/api/waveform`, { headers: auth })).json() as { buckets: { min: number }[] };
  assert.equal(next.buckets[0]!.min, -.8);
});

test("post-start socket errors are contained, diagnosed once, and do not stop playback", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  const { server, bus, calls } = fixture({ enableOsc: true }), base = urlFor(await server.start()); t.after(() => server.close());
  assert.equal((await bus.dispatch({ type: "transport.play" })).ok, true);
  for (let n = 0; n < 4; n++) { server["http"]!.emit("error", new Error("test HTTP error")); server["udp"]!.emit("error", new Error("test OSC error")); }
  assert.equal(warning.mock.callCount(), 2); assert.deepEqual(calls, ["play"]);
  const state = await (await fetch(`${base}/api/state`, { headers: auth })).json() as { performance: { playing: boolean } };
  assert.equal(state.performance.playing, true);
});

test("a remote settings restart preserves active mock playback and pending command results", { timeout: 5000 }, async t => {
  const { server, bus, calls } = fixture(); await server.start(); t.after(() => server.close());
  assert.equal((await bus.dispatch({ type: "transport.play" })).ok, true);
  await server.close(); await server.start();
  assert.equal(bus.state().performance.playing, true); assert.deepEqual(calls, ["play"]);
});

test("a failed queued action releases capacity without hiding its error", { timeout: 5000 }, async t => {
  const { server, calls } = fixture({ limits: { maxPendingCommands: 1 } }), base = urlFor(await server.start()); t.after(() => server.close());
  assert.equal((await command(base, { type: "song.select", index: 100 })).status, 409);
  assert.equal(server["pendingCommands"], 0);
  assert.equal((await command(base, { type: "transport.play" })).status, 200);
  assert.deepEqual(calls, ["play"]);
});

test("access tokens are not used as referrers and event paths still require authentication", async t => {
  const { server } = fixture(), base = urlFor(await server.start()); t.after(() => server.close());
  const page = await fetch(`${base}/?token=${token}`);
  assert.equal(page.headers.get("referrer-policy"), "no-referrer"); assert.equal(page.headers.get("x-frame-options"), "DENY"); await page.text();
  assert.equal((await fetch(`${base}/api/events`)).status, 401);
  assert.equal((await fetch(`${base}/api/state?token=${token}`, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${base}/api/state?token=${encodeURIComponent("é".repeat(token.length))}`)).status, 401);
});

test("a real live-event connection continues receiving updates after its initial response", { timeout: 5000 }, async t => {
  const { server, bus, calls } = fixture(), base = urlFor(await server.start()); t.after(() => server.close());
  const response = await fetch(`${base}/api/events`, { headers: auth }), reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: state/);
  await delay(30);
  const next = reader.read(); assert.equal((await bus.dispatch({ type: "transport.play" })).ok, true);
  assert.match(new TextDecoder().decode((await next).value), /"playing":true/);
  await reader.cancel(); assert.deepEqual(calls, ["play"]);
});

test("real slow socket output stays bounded during a burst of live-state updates", { timeout: 5000 }, async t => {
  const { server, bus, calls } = fixture(), address = await server.start(); t.after(() => server.close());
  const socket = connect(address.httpPort, address.host); socket.on("error", () => {}); await once(socket, "connect");
  socket.write(`GET /api/events HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\n\r\n`); socket.pause();
  await until(() => server["streams"].size === 1);
  const large = "x".repeat(200_000);
  for (let revision = 0; revision < 100; revision++) server["broadcast"]({ ...bus.state(), setName: large, revision });
  const stream = [...server["streams"].values()][0]!;
  assert.ok(stream.response.writableLength < 500_000);
  assert.match(stream.pending!, /"revision":99/);
  socket.destroy(); await until(() => server["streams"].size === 0); assert.deepEqual(calls, []);
});

test("chunked and multibyte oversized requests are rejected before dispatch", { timeout: 5000 }, async t => {
  const { server, calls } = fixture(), address = await server.start(), base = urlFor(address); t.after(() => server.close());
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest({ host: address.host, port: address.httpPort, path: "/api/command", method: "POST", headers: auth }, response => { response.resume(); resolve(response.statusCode!); });
    request.on("error", reject); request.write('{"type":"transport.play"}'); request.end(" ".repeat(70_000));
  });
  assert.equal(status, 413);
  assert.equal((await command(base, { type: "transport.play", extra: "é".repeat(35_000) })).status, 413);
  assert.deepEqual(calls, []);
});

test("closing while a waveform is loading cannot repopulate a retired server cache", { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "remote-wave-test-"));
  t.after(async () => { const rel = relative(tmpdir(), root); if (rel.startsWith("remote-wave-test-") && !rel.includes(sep)) await rm(root, { recursive: true, force: true }); });
  const path = join(root, "wave.json"); await writeFile(path, JSON.stringify({ buckets: [{ min: -.1, max: .2 }] }));
  const { server } = fixture({}, [path]); await server.start(); t.after(() => server.close());
  let started!: () => void; const began = new Promise<void>(resolve => { started = resolve; }), reads = server["waveformReads"];
  t.mock.method(reads, "set", (key: string, value: Parameters<typeof reads.set>[1]) => { const result = Map.prototype.set.call(reads, key, value); started(); return result; });
  const loading = server["loadWaveform"](path); await began; await server.close(); await loading;
  assert.equal(server["waveformCache"].size, 0); assert.equal(server["waveformReads"].size, 0);
  await server.start(); await server["loadWaveform"](path); assert.equal(server["waveformCache"].size, 1);
});

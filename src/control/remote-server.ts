import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo, Socket } from "node:net";
import { open, stat } from "node:fs/promises";
import { PlaybackCommandBus, parsePlaybackCommand, type ControlState, type PlaybackCommand } from "./command-bus.js";
import { decodeOscMessage, oscToPlaybackCommand } from "./osc.js";
import { REMOTE_CONTROL_PAGE } from "./remote-page.js";

export interface RemoteControlLimits {
  readonly commandBodyTimeoutMs: number;
  readonly eventDrainTimeoutMs: number;
  readonly maxEventStreams: number;
  readonly maxPendingCommands: number;
  readonly maxWaveformBytes: number;
  readonly maxCachedWaveforms: number;
  readonly maxWaveformCacheBytes: number;
}
export interface RemoteControlOptions {
  readonly host?: string; readonly httpPort?: number; readonly oscPort?: number;
  readonly token: string; readonly enableOsc?: boolean; readonly oscTokenRequired?: boolean;
  readonly limits?: Partial<RemoteControlLimits>;
}
export interface RemoteControlAddress { readonly host: string; readonly httpPort: number; readonly oscPort: number | null; }
interface EventStream { readonly response: ServerResponse; blocked: boolean; pending: string | null; timer: NodeJS.Timeout | null; }
interface WaveformEntry { readonly mtimeMs: number; readonly ctimeMs: number; readonly ino: number; readonly size: number; readonly payload: unknown; }
const MAX_COMMAND_BYTES = 64 * 1024;
const DEFAULT_LIMITS: RemoteControlLimits = {
  commandBodyTimeoutMs: 10_000, eventDrainTimeoutMs: 10_000, maxEventStreams: 32,
  maxPendingCommands: 32, maxWaveformBytes: 8 * 1024 * 1024,
  maxCachedWaveforms: 16, maxWaveformCacheBytes: 16 * 1024 * 1024,
};

export class RemoteControlServer {
  private http: Server | null = null;
  private udp: DatagramSocket | null = null;
  private starting: Promise<RemoteControlAddress> | null = null;
  private closing: Promise<void> | null = null;
  private running = false;
  private generation = 0;
  private readonly connections = new Set<Socket>();
  private readonly streams = new Map<ServerResponse, EventStream>();
  private unsubscribe: (() => void) | null = null;
  private readonly waveformCache = new Map<string, WaveformEntry>();
  private readonly waveformReads = new Map<string, Promise<WaveformEntry>>();
  private waveformCacheBytes = 0;
  private pendingCommands = 0;
  private readonly reportedNetworkErrors = new Set<string>();
  private readonly limits: RemoteControlLimits;

  constructor(private readonly bus: PlaybackCommandBus, private readonly options: RemoteControlOptions) {
    if (typeof options.token !== "string" || options.token.length < 16) throw new Error("Remote control token must contain at least 16 characters");
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 256 * 1024 * 1024) throw new Error(`Invalid remote limit: ${name}`);
    }
  }

  async start(): Promise<RemoteControlAddress> {
    if (this.http || this.starting || this.closing) throw new Error("Remote control server is already running or changing state");
    this.generation += 1;
    this.reportedNetworkErrors.clear();
    const http = createServer({ maxHeaderSize: 16 * 1024, headersTimeout: 10_000, requestTimeout: 15_000 }, (request, response) => { void this.handle(request, response); });
    http.maxConnections = this.limits.maxEventStreams + 128;
    http.on("connection", socket => { this.connections.add(socket); socket.once("close", () => this.connections.delete(socket)); });
    // Listen/bind helpers reject startup errors; permanent listeners contain later socket errors.
    http.on("error", error => this.reportNetworkError("HTTP", error));
    this.http = http;
    const task = this.open(http);
    this.starting = task;
    try { return await task; }
    finally { if (this.starting === task) this.starting = null; }
  }

  private async open(http: Server): Promise<RemoteControlAddress> {
    const host = this.options.host ?? "127.0.0.1";
    let udp: DatagramSocket | null = null;
    try {
      await listen(http, this.options.httpPort ?? 0, host);
      if (this.closing) throw new Error("Remote startup was cancelled");
      if (this.options.enableOsc !== false) {
        udp = createSocket("udp4"); this.udp = udp;
        udp.on("error", error => this.reportNetworkError("OSC", error));
        udp.on("message", packet => this.handleOsc(packet));
        await bind(udp, this.options.oscPort ?? 0, host);
        if (this.closing) throw new Error("Remote startup was cancelled");
      }
      this.unsubscribe = this.bus.onState(state => this.broadcast(state));
      this.running = true;
      const httpAddress = http.address() as AddressInfo, udpAddress = udp?.address() as AddressInfo | undefined;
      return { host, httpPort: httpAddress.port, oscPort: udpAddress?.port ?? null };
    } catch (error) {
      this.running = false;
      for (const socket of this.connections) socket.destroy();
      await Promise.all([closeServer(http), closeSocket(udp)]);
      if (this.http === http) this.http = null;
      if (this.udp === udp) this.udp = null;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.running = false; this.generation += 1;
    const task = this.shutdown(); this.closing = task;
    try { await task; } finally { if (this.closing === task) this.closing = null; }
  }

  private async shutdown(): Promise<void> {
    if (this.starting) await this.starting.catch(() => {});
    this.unsubscribe?.(); this.unsubscribe = null;
    for (const stream of this.streams.values()) this.dropStream(stream);
    // Do not wait indefinitely for a tablet that stopped sending a request body.
    for (const socket of this.connections) socket.destroy();
    await Promise.all([closeServer(this.http), closeSocket(this.udp)]);
    this.connections.clear(); this.http = null; this.udp = null;
    this.waveformCache.clear(); this.waveformCacheBytes = 0;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      response.setHeader("Access-Control-Allow-Origin", "null");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Frame-Options", "DENY");
      if (request.method === "OPTIONS") { response.writeHead(204, { "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }); response.end(); return; }
      let url: URL;
      try { url = new URL(request.url ?? "/", "http://playback.local"); } catch { throw new HttpError(400, "Invalid request URL"); }
      if (!this.authorized(request, url)) throw new HttpError(401, "Unauthorized");
      if (!this.running) throw new HttpError(503, "Remote control is restarting");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" }); response.end(REMOTE_CONTROL_PAGE); return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") { json(response, 200, this.bus.state()); return; }
      if (request.method === "GET" && url.pathname === "/api/waveform") {
        const index = Number(url.searchParams.get("index") ?? 0);
        if (!Number.isSafeInteger(index) || index < 0) throw new HttpError(400, "Waveform index must be a non-negative integer");
        const song = this.bus.state().songs[index];
        if (!song?.waveformPath) throw new HttpError(404, "Waveform is not prepared for this song");
        try { json(response, 200, await this.loadWaveform(song.waveformPath)); }
        catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(404, "Waveform could not be loaded"); }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/events") { this.openEvents(response); return; }
      if (request.method === "POST" && url.pathname === "/api/command") {
        let command: PlaybackCommand;
        try { command = parsePlaybackCommand(JSON.parse(await body(request, this.limits.commandBodyTimeoutMs))); }
        catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, error instanceof Error ? error.message : "Invalid command"); }
        const result = await this.dispatch(command, "remote");
        json(response, result.ok ? 200 : 409, result); return;
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      try {
        if (response.headersSent) { response.destroy(); return; }
        response.setHeader("Connection", "close");
        json(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "Remote request failed" });
      } catch { response.destroy(); }
    }
  }

  private authorized(request: IncomingMessage, url: URL): boolean {
    const header = request.headers.authorization;
    return safeToken(header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token"), this.options.token);
  }

  private reportNetworkError(transport: string, error: unknown): void {
    if (!this.running || this.reportedNetworkErrors.has(transport)) return;
    this.reportedNetworkErrors.add(transport);
    try { console.warn(`Remote ${transport} connection error; playback continues.`, error); } catch {}
  }

  private handleOsc(packet: Buffer): void {
    if (!this.running) return;
    try {
      const decoded = decodeOscMessage(packet);
      if (this.options.oscTokenRequired && !safeToken(decoded.args[0], this.options.token)) return;
      const message = this.options.oscTokenRequired ? { ...decoded, args: decoded.args.slice(1) } : decoded;
      void this.dispatch(oscToPlaybackCommand(message), "osc").catch(() => {});
    } catch {}
  }

  private async dispatch(command: PlaybackCommand, source: "remote" | "osc") {
    if (!this.running) throw new HttpError(503, "Remote control is restarting");
    if (this.pendingCommands >= this.limits.maxPendingCommands) throw new HttpError(429, "Remote command queue is busy; no command was queued");
    this.pendingCommands += 1;
    try { return await this.bus.dispatch(command, source); }
    finally { this.pendingCommands -= 1; }
  }

  private openEvents(response: ServerResponse): void {
    if (this.streams.size >= this.limits.maxEventStreams) throw new HttpError(503, "Too many live remote connections; state polling remains available");
    const stream: EventStream = { response, blocked: false, pending: null, timer: null };
    response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
    response.on("close", () => this.dropStream(stream));
    response.on("error", () => this.dropStream(stream));
    response.on("drain", () => {
      if (!this.streams.has(response)) return;
      stream.blocked = false; if (stream.timer) clearTimeout(stream.timer); stream.timer = null;
      const pending = stream.pending; stream.pending = null;
      if (pending) this.writeEvent(stream, pending);
    });
    this.streams.set(response, stream);
    this.writeEvent(stream, stateEvent(this.bus.state()));
  }

  private broadcast(state: ControlState): void {
    if (!this.streams.size) return;
    const event = stateEvent(state);
    for (const stream of this.streams.values()) this.writeEvent(stream, event);
  }

  private writeEvent(stream: EventStream, event: string): void {
    if (stream.response.destroyed || stream.response.writableEnded) { this.dropStream(stream); return; }
    if (stream.blocked) { stream.pending = event; return; }
    try {
      if (!stream.response.write(event)) {
        stream.blocked = true;
        stream.timer = setTimeout(() => this.dropStream(stream), this.limits.eventDrainTimeoutMs);
        stream.timer.unref();
      }
    } catch { this.dropStream(stream); }
  }

  private dropStream(stream: EventStream): void {
    this.streams.delete(stream.response); stream.pending = null;
    if (stream.timer) clearTimeout(stream.timer); stream.timer = null;
    if (!stream.response.destroyed) stream.response.destroy();
  }

  private async loadWaveform(path: string): Promise<unknown> {
    const info = await stat(path), cached = this.waveformCache.get(path);
    if (!info.isFile() || info.size > this.limits.maxWaveformBytes) throw new HttpError(413, "Prepared waveform exceeds the remote size limit");
    if (cached && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs && cached.ino === info.ino && cached.size === info.size) {
      this.waveformCache.delete(path); this.waveformCache.set(path, cached); return cached.payload;
    }
    const key = `${path}\0${info.mtimeMs}\0${info.ctimeMs}\0${info.ino}\0${info.size}`;
    let pending = this.waveformReads.get(key);
    if (!pending) {
      if (this.waveformReads.size >= 8) throw new HttpError(503, "Waveform reader is busy");
      const generation = this.generation;
      pending = readWaveform(path, this.limits.maxWaveformBytes).then(entry => {
        if (generation === this.generation && entry.size <= this.limits.maxWaveformCacheBytes) {
          const old = this.waveformCache.get(path); if (old) this.waveformCacheBytes -= old.size;
          this.waveformCache.delete(path); this.waveformCache.set(path, entry); this.waveformCacheBytes += entry.size;
          while (this.waveformCache.size > this.limits.maxCachedWaveforms || this.waveformCacheBytes > this.limits.maxWaveformCacheBytes) {
            const oldest = this.waveformCache.keys().next().value!;
            this.waveformCacheBytes -= this.waveformCache.get(oldest)!.size; this.waveformCache.delete(oldest);
          }
        }
        return entry;
      }).finally(() => this.waveformReads.delete(key));
      this.waveformReads.set(key, pending);
    }
    return (await pending).payload;
  }
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function safeToken(value: unknown, expectedValue: string): boolean {
  if (typeof value !== "string") return false;
  const expected = Buffer.from(expectedValue), actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function stateEvent(state: ControlState): string { return `event: state\ndata: ${JSON.stringify(state)}\n\n`; }
function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value));
}
function body(request: IncomingMessage, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, finished = false;
    const finish = (error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timer);
      request.off("data", data); request.off("end", end); request.off("aborted", aborted);
      if (error) { request.resume(); reject(error); } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > MAX_COMMAND_BYTES) finish(new HttpError(413, "Request body is too large")); else chunks.push(chunk); };
    const end = () => finish();
    const aborted = () => finish(new HttpError(400, "Request was aborted"));
    const failed = () => finish(new HttpError(400, "Request could not be read"));
    const timer = setTimeout(() => finish(new HttpError(408, "Command body timed out; no command was queued")), timeoutMs); timer.unref();
    request.on("data", data); request.once("end", end); request.once("aborted", aborted); request.once("error", failed);
    if (Number(request.headers["content-length"]) > MAX_COMMAND_BYTES) finish(new HttpError(413, "Request body is too large"));
    else if (request.destroyed) aborted();
  });
}
async function readWaveform(path: string, maximumBytes: number): Promise<WaveformEntry> {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > maximumBytes) throw new HttpError(413, "Prepared waveform exceeds the remote size limit");
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - size));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead; if (size > maximumBytes) throw new HttpError(413, "Prepared waveform exceeds the remote size limit");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const buckets = payload && typeof payload === "object" ? (payload as { buckets?: unknown }).buckets : null;
    if (!Array.isArray(buckets) || buckets.length > 100_000 || !buckets.every(bucket => bucket && typeof bucket === "object" && Number.isFinite(bucket.min) && Number.isFinite(bucket.max))) throw new HttpError(422, "Prepared waveform has invalid data");
    const after = await file.stat();
    if (before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || size !== after.size) throw new HttpError(409, "Prepared waveform changed while loading; retry the waveform request");
    return { mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, ino: after.ino, size: after.size, payload };
  } finally { await file.close(); }
}
function listen(server: Server, port: number, host: string): Promise<void> { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); }); }
function bind(socket: DatagramSocket, port: number, host: string): Promise<void> { return new Promise((resolve, reject) => { socket.once("error", reject); socket.bind(port, host, () => { socket.off("error", reject); resolve(); }); }); }
function closeServer(server: Server | null): Promise<void> { return !server ? Promise.resolve() : new Promise(resolve => { try { server.close(() => resolve()); server.closeAllConnections(); } catch { resolve(); } }); }
function closeSocket(socket: DatagramSocket | null): Promise<void> { return !socket ? Promise.resolve() : new Promise(resolve => { try { socket.close(() => resolve()); } catch { resolve(); } }); }

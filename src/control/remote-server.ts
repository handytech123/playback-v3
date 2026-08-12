import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createSocket, type Socket } from "node:dgram";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { PlaybackCommandBus, parsePlaybackCommand, type ControlState } from "./command-bus.js";
import { decodeOscMessage, oscToPlaybackCommand } from "./osc.js";
import { REMOTE_CONTROL_PAGE } from "./remote-page.js";

export interface RemoteControlOptions { readonly host?: string; readonly httpPort?: number; readonly oscPort?: number; readonly token: string; readonly enableOsc?: boolean; readonly oscTokenRequired?: boolean; }
export interface RemoteControlAddress { readonly host: string; readonly httpPort: number; readonly oscPort: number | null; }

export class RemoteControlServer {
  private http: Server | null = null; private udp: Socket | null = null; private readonly streams = new Set<ServerResponse>(); private unsubscribe: (() => void) | null = null;
  constructor(private readonly bus: PlaybackCommandBus, private readonly options: RemoteControlOptions) { if (options.token.length < 16) throw new Error("Remote control token must contain at least 16 characters"); }
  async start(): Promise<RemoteControlAddress> {
    if (this.http) throw new Error("Remote control server is already running");
    this.http = createServer((request, response) => void this.handle(request, response));
    const host = this.options.host ?? "127.0.0.1";
    await listen(this.http, this.options.httpPort ?? 0, host);
    if (this.options.enableOsc !== false) { this.udp = createSocket("udp4"); this.udp.on("message", packet => { try { const decoded=decodeOscMessage(packet),message=this.options.oscTokenRequired?{...decoded,args:decoded.args.slice(1)}:decoded;if(this.options.oscTokenRequired&&!safeToken(decoded.args[0],this.options.token))return;void this.bus.dispatch(oscToPlaybackCommand(message), "osc"); } catch {} }); await bind(this.udp, this.options.oscPort ?? 0, host); }
    this.unsubscribe = this.bus.onState(state => this.broadcast(state));
    const httpAddress = this.http.address() as AddressInfo, udpAddress = this.udp?.address() as AddressInfo | undefined;
    return { host, httpPort: httpAddress.port, oscPort: udpAddress?.port ?? null };
  }
  async close(): Promise<void> { this.unsubscribe?.(); this.unsubscribe = null; for (const stream of this.streams) stream.end(); this.streams.clear(); await Promise.all([closeServer(this.http), closeSocket(this.udp)]); this.http = null; this.udp = null; }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Access-Control-Allow-Origin", "null"); response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") { response.writeHead(204, { "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }); response.end(); return; }
    if (!this.authorized(request)) { json(response, 401, { error: "Unauthorized" }); return; }
    const url = new URL(request.url ?? "/", "http://playback.local");
    if (request.method === "GET" && url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" }); response.end(REMOTE_CONTROL_PAGE); return; }
    if (request.method === "GET" && url.pathname === "/api/state") { json(response, 200, this.bus.state()); return; }
    if (request.method === "GET" && url.pathname === "/api/waveform") { try { const index=Number(url.searchParams.get("index")??0),song=this.bus.state().songs[index]; if(!song?.waveformPath)throw new Error("Waveform is not prepared for this song"); json(response,200,JSON.parse(await readFile(song.waveformPath,"utf8"))); } catch(error) { json(response,404,{error:error instanceof Error?error.message:String(error),buckets:[]}); } return; }
    if (request.method === "GET" && url.pathname === "/api/events") { response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" }); response.write(`event: state\ndata: ${JSON.stringify(this.bus.state())}\n\n`); this.streams.add(response); request.on("close", () => this.streams.delete(response)); return; }
    if (request.method === "POST" && url.pathname === "/api/command") { try { const command = parsePlaybackCommand(JSON.parse(await body(request))); const result = await this.bus.dispatch(command, "remote"); json(response, result.ok ? 200 : 409, result); } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }); } return; }
    json(response, 404, { error: "Not found" });
  }
  private authorized(request: IncomingMessage): boolean { const header = request.headers.authorization, candidate = header?.startsWith("Bearer ") ? header.slice(7) : new URL(request.url ?? "/", "http://playback.local").searchParams.get("token") ?? ""; const expected = Buffer.from(this.options.token), actual = Buffer.from(candidate); return expected.length === actual.length && timingSafeEqual(expected, actual); }
  private broadcast(state: ControlState): void { const event = `event: state\ndata: ${JSON.stringify(state)}\n\n`; for (const stream of this.streams) stream.write(event); }
}

function safeToken(value: unknown, expectedValue: string): boolean { if(typeof value!=="string")return false;const expected=Buffer.from(expectedValue),actual=Buffer.from(value);return expected.length===actual.length&&timingSafeEqual(expected,actual); }

function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<string> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 64 * 1024) throw new Error("Request body is too large"); chunks.push(bytes); } return Buffer.concat(chunks).toString("utf8"); }
function listen(server: Server, port: number, host: string): Promise<void> { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); }); }
function bind(socket: Socket, port: number, host: string): Promise<void> { return new Promise((resolve, reject) => { socket.once("error", reject); socket.bind(port, host, () => { socket.off("error", reject); resolve(); }); }); }
function closeServer(server: Server | null): Promise<void> { return !server ? Promise.resolve() : new Promise(resolve => server.close(() => resolve())); }
function closeSocket(socket: Socket | null): Promise<void> { return !socket ? Promise.resolve() : new Promise(resolve => { socket.close(() => resolve()); }); }

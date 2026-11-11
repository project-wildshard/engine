// J178, J182: the one world's door. One process, a fixed table of cell workers, and one address. Sockets, caps, saves and the grace stay on
// the main thread, out of every tick; each cell runs on the worker the table gives it, and never moves. If a worker fails the process ends
// and systemd starts it again (Q77). `NetRoom` does not change: it hears the same `hello` the door read, once the client has loaded.
// oxlint-disable-next-line import/no-nodejs-modules -- The server's own door.
import type { IncomingMessage } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- The server's own door.
import type { Duplex } from 'node:stream';
// oxlint-disable-next-line import/no-nodejs-modules -- Canonical network identity at the trusted proxy boundary.
import { isIP } from 'node:net';
import * as v from 'valibot';
import { WebSocketServer, type WebSocket } from 'ws';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { cleanName } from '@wildshard/engine/net/chatFilter';
import { NetIdentitySchema } from '@wildshard/engine/net/identity';
import { decodeFirstMessage } from '@wildshard/wire/handshake';
import { WIRE_MINOR } from '@wildshard/wire/major';
import { encodeCountdown } from '@wildshard/engine/net/socketFrames';
import {CorrectionSchema} from '@wildshard/engine/net/measurements';
import type {PlaytestRow} from './playtest';
import type { ChatReport } from '@wildshard/engine/net/chat';
import type { CellOrder, ResumeAt, SavedCheckpoint, SeatEntry, WorkerNews, WorkerReading } from './cellProtocol';
import { bodyId } from './seats';
import type { PlayerDoc } from './playerDoc';
import { LEAVE_FLAG, LEFT, pumpSocket } from './socketPump';
import { SOCKET_SERVER_OPTIONS, SocketTransport } from './socketTransport';
import { SaveQuarantinedError, type SaveReceipt, type SaveWrite } from './saves/saveStore';
import { workerTable } from './workerTable';
import { cellName, cellShard } from './gridCells';
import { VoiceRelay, type VoiceIceServer } from './voiceRelay';
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_TRUST_PROXY, originAllowed, trustedAddress, type TrustProxy } from './doorTrust';

/** J174: what a deploy gives everyone before they move together. */
export const GRACE_MS = 60_000;
/** E7.7: what one address may hold and open. */
const SOCKETS_PER_IP = 4, CONNECTS_PER_MINUTE = 10, MINUTE_MS = 60_000;
const MAX_TRACKED_IPS = 4096;
/** A hello's and a load's wait (E7.7). */
const HELLO_MS = 5000, READY_MS = 120_000;
/** How long a stop gives each worker, and then the save queue. */
const DRAIN_MS = 10_000;
/** J177: one address, and no slug on it. */
const WORLD_PATH = /^\/(?:\?.*)?$/u;
/** GO7: the cell a page asks to be seated in (`/?chunk=<instance>`, `gotoSocket` in the online shell: the page's own `?chunk=` turned into
 *  a goto, ZS5), or null. Only a name shaped like a grid instance is kept; whether this world opens it is the door's question (`cellFor`). */
export function gotoCell(path: string | undefined): string | null {
  const query = path?.indexOf('?') ?? -1, cell = query < 0 ? null : new URLSearchParams(path?.slice(query + 1)).get('chunk');
  return cell !== null && /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(cell) && cell.length <= 64 ? cell : null;
}

/** IPv6 privacy addresses share their household /64; mapped IPv4 keeps its IPv4 bucket. */
function connectionKey(address: string): string {
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return 'unknown';
  let source = address.split('%')[0] ?? address;
  if (source.includes('.')) {
    const colon = source.lastIndexOf(':'), octets = source.slice(colon + 1).split('.').map(Number);
    source = `${source.slice(0, colon)}:${((octets[0] ?? 0) * 256 + (octets[1] ?? 0)).toString(16)}:${((octets[2] ?? 0) * 256 + (octets[3] ?? 0)).toString(16)}`;
  }
  const [left = '', right] = source.split('::'), head = left === '' ? [] : left.split(':'), tail = right === undefined || right === '' ? [] : right.split(':');
  const words = (right === undefined ? head : [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => '0'), ...tail]).map(word => Number.parseInt(word, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 65535) return `${(words[6] ?? 0) >> 8}.${(words[6] ?? 0) & 255}.${(words[7] ?? 0) >> 8}.${(words[7] ?? 0) & 255}`;
  return `${words.slice(0, 4).map(word => word.toString(16)).join(':')}/64`;
}

/** What the door holds of one worker. */
export interface WorkerLink {
  send: (order: CellOrder, transfer?: readonly Transferable[]) => void;
  /** The worker's news, and an end nobody asked for. */
  listen: (news: (row: WorkerNews) => void, ended: (reason: string) => void) => void;
  stop: () => void;
}
/** What a read of a player's save answers. */
export interface SavedPlayer { readonly doc: PlayerDoc | null; readonly seq: number; readonly recovery?: readonly SaveReceipt[]; readonly previous?: SavedCheckpoint }
/** Where a player's save lives. */
export interface PlayerSaves {
  /** The cell this player last stood in, this epoch: a grid instance (ZS7's place row), or an older save's shard. */
  where: (device: string) => Promise<string | null>;
  /** A player's doc on one shard: a cell's progress is kept under its shard's slug. */
  read: (device: string, shard: string) => Promise<SavedPlayer>;
  /** Promote a previous copy only after a room imports it, and only while its sequence is unchanged. */
  recover?: (device: string, shard: string, seq: number) => Promise<void>;
  write: (write: SaveWrite) => void;
  report: (report: ChatReport, shard: string) => boolean;
  /** MP2.4: claim a cleaned Name for this device and answer what everyone reads (`Name#1234`). Left out, the Name goes as typed. */
  name?: (device: string, name: string) => Promise<string>;
  /** Wait for what is on its way, at most `ms`. */
  drain: (ms: number) => Promise<boolean>;
  /** How writes are going: E7.8's numbers. */
  stats?: () => Readonly<Record<string, number>>;
}
/** How the world is built. */
export interface WorldOptions {
  readonly build: string;
  /** The cells it opens, by grid instance (GO3), fixed at startup. A player with no save lands in the first. */
  readonly cells: readonly string[];
  /** C4's key. */
  readonly secret: string;
  /** J182, J185: workers, and the most players the grid holds, a held body counted, in every cell together. Startup settings. */
  readonly workers: number; readonly seats: number;
  /** Start one worker on one row of the table. */
  readonly boot: (slugs: readonly string[]) => WorkerLink;
  readonly saves: PlayerSaves;
  readonly log: (line: Record<string, unknown>) => void;
  /** A worker failed: nothing here can go on, and the process should end (Q77). */
  readonly crashed: (error: unknown) => void;
  /** The grace ran out: stop, and let systemd start what is on disk. */
  readonly restart: () => void;
  /** One worker's 10 s reading, for what leaves the box (E7.8a). */
  readonly reading?: (index: number, reading: WorkerReading) => void;
  readonly playtest?:(row:PlaytestRow)=>void;
  /** J218: the ICE servers voice chat hands a player who joins; public STUN when absent. */
  readonly voiceIce?: () => Promise<readonly VoiceIceServer[]>;
  /** VH10: which forwarded header a loopback proxy may set (`doorTrust`); `caddy` when absent. */
  readonly trustProxy?: TrustProxy;
  /** VH10: the pages a browser may open a socket from; `null` is any. The game's own hosts when absent. */
  readonly allowedOrigins?: readonly string[] | null;
  /** A proof's overrides. */
  readonly helloMs?: number; readonly readyMs?: number; readonly connectsPerMinute?: number; readonly socketsPerIp?: number; readonly graceMs?: number;
  /** Monotonic connection-budget clock, overridable by local boundary tests. */
  readonly now?: () => number;
}
interface PendingSeat { readonly end: SocketTransport }
interface ConnectAttempt { readonly at: number }
/** Every reason a socket was turned away, counted: the row E7.7 asks for. */
export type Refusals = Record<string, number>;

/** The one world's door. */
export class World {
  readonly refusals: Refusals = {};
  private readonly options: WorldOptions;
  private readonly now: () => number;
  private readonly server: WebSocketServer;
  private readonly scope = new Scope('dedicated.world');
  /** The static table: which worker each cell is on (J182). */
  private readonly links = new Map<string, WorkerLink>();
  private readonly workers: WorkerLink[] = [];
  private readonly sockets = new Map<string, number>();
  private readonly connects = new Map<string, ConnectAttempt[]>();
  private readonly ends = new Set<SocketTransport>();
  /** Links whose player quit (`ready` with `LEAVE_FLAG`) before a body was theirs. */
  private readonly quits = new WeakSet<SocketTransport>();
  /** Clients loading: each holds a seat, and has no body yet. */
  private readonly pending = new Map<string, PendingSeat>();
  /** Who has a body, by link or by hold, and in which cell. */
  private readonly seated = new Map<string, string>();
  /** MP2.4: the Name each body was seated with, which a held body keeps when its player comes back. */
  private readonly names = new Map<string, string>();
  private readonly finds = new Map<number, (found: { held: boolean; spawn: ResumeAt }) => void>();
  private readonly drains = new Map<number, () => void>();
  private asked = 0;
  private draining = false;
  private grace: { readonly endsAt: number; readonly build: string } | null = null;
  /** J218: who is on voice in each cell, and their signalling. */
  private readonly voice: VoiceRelay;
  private constructor(options: WorldOptions) {
    this.options = options;
    this.voice = new VoiceRelay(options.voiceIce);
    this.now = options.now ?? diagnosticNow;
    this.server = new WebSocketServer({ noServer: true, ...SOCKET_SERVER_OPTIONS });
    this.scope.interval(MINUTE_MS, () => { this.sweepConnects(this.now()); });
  }
  /** Start every worker on its row and wait for all of them. Nothing changes after this. */
  static async open(options: WorldOptions): Promise<World> {
    const world = new World(options);
    await Promise.all(workerTable(options.cells, options.workers).map(slugs => world.bootWorker(slugs)));
    return world;
  }
  private bootWorker(slugs: readonly string[]): Promise<void> {
    const link = this.options.boot(slugs), index = this.workers.push(link) - 1;
    for (const slug of slugs) this.links.set(slug, link);
    return new Promise((resolve, reject) => {
      const ended = (reason: string): void => { this.options.log({ at: 'worker.ended', index, slugs, reason }); reject(new Error(reason)); this.options.crashed(new Error(reason)); };
      link.listen(news => { if (news.kind === 'booted') { this.options.log({ at: 'worker.booted', index, slugs, ms: news.ms }); resolve(); } else if (news.kind === 'failed') ended(news.reason); else this.heard(index, news); }, ended);
    });
  }
  private heard(index: number, news: WorkerNews): void {
    if (news.kind === 'found') { this.finds.get(news.id)?.(news); this.finds.delete(news.id); }
    // GO7: a late `left` from the cell a goto moved them out of must not unseat them (or free their Name) in the new one.
    else if (news.kind === 'left') { const from = 'slug' in news ? news.slug : undefined; if (from === undefined || this.seated.get(news.device) === from) { this.seated.delete(news.device); this.names.delete(news.device); } }
    else if (news.kind === 'refused') this.refuse(news.reason);
    else if (news.kind === 'recovered') void this.recover(news.device, cellShard(news.slug), news.seq);
    else if (news.kind === 'save') this.options.saves.write(news.write);
    else if (news.kind === 'report') { if (!this.options.saves.report(news.report, cellShard(news.slug))) this.refuse('report-backlog'); }
    else if (news.kind === 'chat') { for (const link of this.workers) link.send({ kind: 'chat', from: news.slug, line: news.line }); }
    else if(news.kind==='playtest')this.options.playtest?.(news.row);
    else if (news.kind === 'cell') this.options.log({ at: 'cell.booted', index, slug: news.slug, ms: news.ms });
    else if (news.kind === 'reading') { this.options.log({ at: 'worker', index, ...news.reading, refusals: this.refusals, connections: this.connectionStats, saves: this.options.saves.stats?.() }); this.options.reading?.(index, news.reading); }
    else if (news.kind === 'drained') { this.drains.get(index)?.(); this.drains.delete(index); }
  }
  private refuse(reason: string): void { this.refusals[reason] = (this.refusals[reason] ?? 0) + 1; }
  private async recover(device: string, slug: string, seq: number): Promise<void> {
    try { await this.options.saves.recover?.(device, slug, seq); }
    catch (error) { this.options.log({ at: 'save.recovery', error: String(error) }); }
  }
  /** An upgrade. There is one address, and nothing else gets a socket. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => { socket.destroy(); });
    if (!WORLD_PATH.test(request.url ?? '')) { this.refuse('wrong-address'); socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    if (!originAllowed(request.headers.origin, this.options.allowedOrigins === undefined ? DEFAULT_ALLOWED_ORIGINS : this.options.allowedOrigins)) {
      this.refuse('origin'); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    if (this.draining) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const ip = connectionKey(trustedAddress(request.socket.remoteAddress ?? '', request.headers, this.options.trustProxy ?? DEFAULT_TRUST_PROXY));
    const attempt = this.attempt(ip);
    if (attempt === null) { this.refuse('connections'); socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const goto = gotoCell(request.url);
    this.server.handleUpgrade(request, socket, head, ws => { this.opened(ws, ip, attempt, goto); });
  }
  /** Actual retained limiter state, also recorded in the worker operational log. */
  get connectionStats(): { readonly addresses: number; readonly attempts: number } {
    this.sweepConnects(this.now());
    return { addresses: this.connects.size, attempts: [...this.connects.values()].reduce((sum, times) => sum + times.length, 0) };
  }
  private attempt(ip: string): ConnectAttempt | null {
    const now = this.now(), recent = (this.connects.get(ip) ?? []).filter(row => now - row.at < MINUTE_MS);
    if (recent.length >= (this.options.connectsPerMinute ?? CONNECTS_PER_MINUTE)) return null;
    if (!this.connects.has(ip) && this.connects.size >= MAX_TRACKED_IPS) {
      const oldest = this.connects.keys().next().value;
      if (oldest !== undefined) this.connects.delete(oldest);
    }
    const attempt = { at: now }; recent.push(attempt); this.connects.set(ip, recent);
    return (this.sockets.get(ip) ?? 0) >= (this.options.socketsPerIp ?? SOCKETS_PER_IP) ? null : attempt;
  }
  private sweepConnects(now: number): void {
    for (const [ip, times] of this.connects) if (now - (times.at(-1)?.at ?? -Infinity) >= MINUTE_MS) this.connects.delete(ip);
  }
  private opened(socket: WebSocket, ip: string, attempt: ConnectAttempt, goto: string | null): void {
    const end = new SocketTransport(socket);
    this.sockets.set(ip, (this.sockets.get(ip) ?? 0) + 1); this.ends.add(end);
    end.onClose(reason => {
      if (reason === 'retry') { const kept = (this.connects.get(ip) ?? []).filter(row => row !== attempt); if (kept.length === 0) this.connects.delete(ip); else this.connects.set(ip, kept); }
      this.ends.delete(end); const left = (this.sockets.get(ip) ?? 1) - 1; if (left === 0) this.sockets.delete(ip); else this.sockets.set(ip, left);
    });
    // QA row 16: a clean quit counts from the first byte, not only once seated (`pumpSocket`'s own). A quit that lands while the door
    // still admits this link (in the same read as its `ready`, or before a held body is handed back) ends it with no seat and no hold.
    end.onControl((control, bytes) => { if (control === 'ready' && new Uint8Array(bytes)[0] === LEAVE_FLAG) { this.quits.add(end); end.close(LEFT); } });
    const timer = this.scope.timeout(this.options.helloMs ?? HELLO_MS, () => { this.refuse('hello-timeout'); end.close('refused'); });
    const off = end.onMessage((_channel, bytes) => { off(); this.scope.cancelTimer(timer); void this.joining(end, bytes, goto); });
    end.onClose(() => { off(); this.scope.cancelTimer(timer); });
  }
  private async joining(end: SocketTransport, bytes: ArrayBuffer, goto: string | null): Promise<void> {
    try { await this.hello(end, bytes, goto); }
    catch (error) { if (!end.isOpen) return; this.options.log({ at: 'world.join', error: String(error) }); this.refuse('join-failed'); end.close(error instanceof SaveQuarantinedError ? 'refused' : 'retry'); }
  }
  /** Everyone in the grid or on their way: the cap counts all of them, whichever cell they stand in (J182). */
  private get taken(): number { return this.seated.size + this.pending.size; }
  private link(slug: string): WorkerLink {
    const link = this.links.get(slug);
    if (link === undefined) throw new Error(`No worker has ${slug}`);
    return link;
  }
  /** Ask a cell, waking it if it sleeps, whether this device holds a seat there and where a stranger stands. */
  private async ask(slug: string, device: string, end: SocketTransport): Promise<{ held: boolean; spawn: ResumeAt }> {
    const id = ++this.asked, scope = new Scope('dedicated.find');
    try {
      return await new Promise((resolve, reject) => {
        this.finds.set(id, resolve);
        scope.timeout(this.options.helloMs ?? HELLO_MS, () => { reject(new Error('Worker lookup timed out')); });
        // A player who quit still gets the answer: a held body of theirs is let go (`leaveHeld`).
        scope.onDispose(end.onClose(() => { if (!this.quits.has(end)) reject(new Error('Admission closed')); }));
        if (end.isOpen || this.quits.has(end)) this.link(slug).send({ kind: 'find', id, slug, device });
      });
    } finally { this.finds.delete(id); scope.dispose(); }
  }
  /** The join: check, find where they stand, let them load, seat them. */
  private async hello(end: SocketTransport, bytes: ArrayBuffer, goto: string | null): Promise<void> {
    const view = new Uint8Array(bytes);
    // WR5 (5.5, J54 replaced): the door reads the v1 bootstrap. A v0.1.x hello or an older major reloads, a newer major
    // retries, and the minor window is one either way; builds no longer have to match.
    const first = decodeFirstMessage(view);
    if (first.kind === 'refuse') { this.refuse('not-hello'); end.close('refused'); return; }
    if (first.kind !== 'hello') { this.refuse('stale-build'); end.close(first.kind); return; }
    const { hello } = first;
    if (hello.minor !== WIRE_MINOR && Math.abs(hello.minor - WIRE_MINOR) > 1) { this.refuse('stale-build'); end.close(hello.minor > WIRE_MINOR ? 'retry' : 'reload'); return; }
    const said = v.safeParse(NetIdentitySchema, { player: hello.player, name: hello.name });
    if (!said.success) { this.refuse('identity'); end.close('refused'); return; }
    const device = said.output.player, typed = cleanName(said.output.name), body = bodyId(this.options.secret, device), { saves } = this.options, holding = this.seated.get(device);
    if (holding !== undefined) {
      // MP2.4: a body the room holds keeps the Name it was seated with; a new Name is claimed on the next fresh join, never here,
      // so the reservation and what everyone reads can't part.
      const found = await this.ask(holding, device, end), name = this.names.get(device) ?? typed;
      if (found.held && this.quits.has(end)) { this.leaveHeld(holding, { device, name, body, doc: null, seq: 0, held: true }, bytes); return; }
      if (!end.isOpen || this.draining) return;
      // GO7: Shard select chose another cell this world opens. The held body leaves cleanly (saved), and the door admits them there.
      const moving = goto !== null && cellName(goto) !== holding && this.links.has(cellName(goto));
      // `leaveHeld` transfers the hello it is given, and this hello still seats them in the new cell: it gets a copy.
      if (found.held && moving) this.leaveHeld(holding, { device, name, body, doc: null, seq: 0, held: true }, bytes.slice(0));
      else if (found.held) { this.seat(holding, end, { device, name, body, doc: null, seq: 0, held: true }, bytes); return; }
    }
    if (!end.isOpen || this.draining) return;
    this.pending.get(device)?.end.close('replaced');
    if (this.taken >= this.options.seats) { this.refuse('full'); end.close('full'); return; }
    this.pending.set(device, { end });
    end.onClose(() => { if (this.pending.get(device)?.end === end) this.pending.delete(device); });
    // MP2.4: the Name everyone reads is the claimed one, never the hello's, so a refused or duplicate Name reaches no client.
    const name = saves.name === undefined ? typed : await saves.name(device, typed);
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    const last = await saves.where(device);
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    const slug = this.cellFor(last, goto), saved = await saves.read(device, cellShard(slug));
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    const { spawn } = await this.ask(slug, device, end);
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    // GO3: `shard` is what a one-shard page loads, `cell` the grid instance a grid page stands in.
    end.control('resume', new TextEncoder().encode(JSON.stringify({ shard: cellShard(slug), cell: slug, at: saved.doc?.at ?? spawn })).buffer);
    this.sayCountdown(end);
    await new Promise<void>(resolve => {
      const timer = this.scope.timeout(this.options.readyMs ?? READY_MS, () => { this.refuse('ready-timeout'); end.close('refused'); resolve(); });
      const off = end.onControl((control, flag) => { if (control === 'ready' && new Uint8Array(flag)[0] !== LEAVE_FLAG) { off(); this.scope.cancelTimer(timer); resolve(); } });
      end.onClose(() => { off(); this.scope.cancelTimer(timer); resolve(); });
    });
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    this.pending.delete(device);
    this.seat(slug, end, { device, name, body, doc: saved.doc, seq: saved.seq, ...(saved.recovery === undefined ? {} : { recovery: saved.recovery }), ...(saved.previous === undefined ? {} : { previous: saved.previous }) }, bytes);
  }
  /** GO7: a page Shard select sent to a cell this world opens is seated there; otherwise where the player last stood, else the first. */
  private cellFor(last: string | null, goto: string | null = null): string {
    const first = this.options.cells[0];
    if (first === undefined) throw new Error('A world has at least one cell');
    const asked = goto === null ? null : cellName(goto);
    if (asked !== null && this.links.has(asked)) return asked;
    const cell = last === null ? null : cellName(last);
    return cell !== null && this.links.has(cell) ? cell : first;
  }
  private seat(slug: string, end: SocketTransport, entry: SeatEntry, hello: ArrayBuffer): void {
    if (!end.isOpen || this.draining) return;
    const { port1, port2 } = new MessageChannel();
    this.seated.set(entry.device, slug); this.names.set(entry.device, entry.name);
    if(this.options.playtest!==undefined){
      const off=end.onControl((control,bytes)=>{
        if(control!=='playtest')return;
        try{const parsed=v.safeParse(CorrectionSchema,JSON.parse(new TextDecoder().decode(bytes)) as unknown);if(parsed.success)this.options.playtest?.(parsed.output);else this.refuse('playtest-record');}
        catch{this.refuse('playtest-record');}
      });
      end.onClose(off);end.control('playtest');
    }
    pumpSocket(end, port1);
    this.voice.attach(end, slug, entry.name, entry.body);
    this.link(slug).send({ kind: 'seat', slug, port: port2, hello, ...entry }, [port2, hello]);
  }
  /** A held body whose player quit on the link that came back for it: the cell takes it as a seat whose link has already left. */
  private leaveHeld(slug: string, entry: SeatEntry, hello: ArrayBuffer): void {
    const { port1, port2 } = new MessageChannel();
    this.link(slug).send({ kind: 'seat', slug, port: port2, hello, ...entry }, [port2, hello]);
    port1.postMessage({ close: LEFT, silentMs: 0 }); port1.close();
  }
  private sayCountdown(end: SocketTransport): void {
    if (this.grace === null) return;
    end.control('countdown', encodeCountdown(Math.max(0, Math.ceil((this.grace.endsAt - diagnosticNow()) / 1000)), this.grace.build));
  }
  /** J174: `build` is due. Everyone hears the countdown and plays on while it preloads; at zero everyone is saved and sent `restart`. */
  beginGrace(build: string): void {
    if (this.grace !== null || this.draining) return;
    const ms = this.options.graceMs ?? GRACE_MS;
    this.grace = { endsAt: diagnosticNow() + ms, build };
    this.options.log({ at: 'grace', build, ms });
    for (const end of this.ends) this.sayCountdown(end);
    this.scope.timeout(ms, () => { this.options.restart(); });
  }
  /** What `/health` says: no player data. `table` is each open cell and the worker it runs on (GO3, MP1.4). */
  health(): { readonly build: string; readonly cells: number; readonly workers: number; readonly awake: number; readonly players: number; readonly table: Readonly<Record<string, number>> } {
    const table = Object.fromEntries([...this.links].map(([cell, link]) => [cell, this.workers.indexOf(link)]));
    return { build: this.options.build, cells: this.links.size, workers: this.workers.length, awake: new Set(this.seated.values()).size, players: this.seated.size, table };
  }
  /** Stop: everyone is saved and told `restart`, and the queue gets its time. */
  async drain(): Promise<boolean> {
    this.draining = true;
    for (const { end } of this.pending.values()) end.close('restart');
    await Promise.all(this.workers.map((link, index) => new Promise<void>(resolve => {
      const timer = this.scope.timeout(DRAIN_MS, resolve);
      this.drains.set(index, () => { this.scope.cancelTimer(timer); resolve(); });
      link.send({ kind: 'drain' });
    })));
    return this.options.saves.drain(DRAIN_MS);
  }
  dispose(): void { this.scope.dispose(); for (const link of this.workers) link.stop(); this.links.clear(); this.server.close(); }
}

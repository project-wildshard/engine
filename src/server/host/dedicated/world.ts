// J178, J182: the one world's door. One process, a fixed table of cell workers, and one address. Sockets, caps, saves and the grace stay on
// the main thread, out of every tick; each cell runs on the worker the table gives it, and never moves. If a worker fails the process ends
// and systemd starts it again (Q77). `NetRoom` does not change: it hears the same `hello` the door read, once the client has loaded.
// oxlint-disable-next-line import/no-nodejs-modules -- The server's own door.
import type { IncomingMessage } from 'node:http';
import type { DevAnswer } from './devControl';
// oxlint-disable-next-line import/no-nodejs-modules -- The server's own door.
import type { Duplex } from 'node:stream';
// oxlint-disable-next-line import/no-nodejs-modules -- Canonical network identity at the proxy boundary.
import { isIP } from 'node:net';
import * as v from 'valibot';
import { WebSocketServer, type WebSocket } from 'ws';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { cleanName } from '@wildshard/engine/net/chatFilter';
import { NetIdentitySchema } from '@wildshard/engine/net/identity';
import { PLAYER_TICKET_PUBLIC_KEY, admit, passOf } from './ticket';
import { decodeFirstMessage, encodeHello, type Hello } from '@wildshard/wire/handshake';
import { WIRE_MINOR } from '@wildshard/wire/major';
import { decodeEnter, decodeSavesAsk, decodeWhereAsk, encodeArrive, encodeCountdown, encodeEnter, encodeSaves, encodeWhere, type RoomSave, type WorldWord } from '@wildshard/engine/net/socketFrames';
import { deviceLine, readDeviceWord, type DeviceSnapshot, type DeviceWho } from '@wildshard/engine/net/deviceWord';
import { AGENT_HEADER, classifyActor, type ActorMark, type ActorTags } from '@wildshard/engine/app/actor';
import {CorrectionSchema} from '@wildshard/engine/net/measurements';
import type {PlaytestRow} from './playtest';
import type { ChatReport } from '@wildshard/engine/net/chat';
import type { CellOrder, ResumeAt, SavedCheckpoint, SeatEntry, WorkerNews, WorkerReading, WorkerResident } from './cellProtocol';
import type { MotionSnapshot } from '@wildshard/engine/game/grid/simulation';
import { bodyId } from './seats';
import { roomSaveOf, SaveNewerError, type PlayerDoc } from './playerDoc';
import { LEAVE_FLAG, LEFT, pumpSocket } from './socketPump';
import { SOCKET_SERVER_OPTIONS, SocketTransport } from './socketTransport';
import { SaveQuarantinedError, type SaveReceipt, type SaveWrite } from './saves/saveStore';
import type { ClaimResult } from './saves/claim';
import type { AccountExport } from './saves/account';
import { workerTable, type DeclaredCells } from './workerTable';
import { cellName, cellShard, gridAssembly, placedCells, placedHash, roadHome, worldRevisions } from './gridCells';
import { VoiceRelay, type VoiceIceServer } from './voiceRelay';
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_TRUST_PROXY, originAllowed, clientAddress, type TrustProxy } from './doorTrust';
import {checkpointWord,type CheckpointCertificate} from './checkpointWitness';
import type { PersistenceStatus } from './saves/persistenceStatus';
import { persistenceEnvelope } from '@wildshard/engine/net/persistenceWord';
import { SeatQueue } from './seatQueue';
import type { ZoneEntryStore } from './saves/zoneEntries';
import type { RoomSessions, RoomSessionStore } from './roomSessions';
import type { RoomGameStore } from './roomGameMetrics';
import { MarkerSeats, type MarkerReading } from './markerSeats';
import type { ReadRoomMetricDay } from './saves/metricsDailyStore';

interface SocketActor {
  mark: ActorMark;
  claimed?: ActorTags['actor'];
  seatMinute?: number;
  leaked?: boolean;
}

export interface LivePlayers {
  readonly humans: number;
  readonly agents: number;
  readonly zones: Readonly<Record<string, Readonly<Record<ActorTags['actor'], number>>>>;
}

/** J174: what a deploy gives everyone before they move together. */
export const GRACE_MS = 60_000;
/** E7.7: what one address may hold and open. */
const SOCKETS_PER_IP = 4, CONNECTS_PER_MINUTE = 10, MINUTE_MS = 60_000;
/** SB42: a socket the page closed having only read the door's word (no hello) moves to this budget, so a zone entry's word and its
 *  join cost one connect, not two. A stranger's word sockets still meet a cap: this one, then the connects again. */
const WORDS_PER_MINUTE = 10;
/** SB42: a proof pass's own budget (`ticket.ts` `passOf`), apart from every address's; and how many bad passes an address may try
 *  in a minute before the door stops reading its passes (each read is a signature check). */
const PASS_SOCKETS = 16, PASS_CONNECTS_PER_MINUTE = 120, BAD_PASSES_PER_MINUTE = 5, MAX_KEPT_PASSES = 64;
const MAX_TRACKED_IPS = 4096;
/** A hello's and a load's wait (E7.7). */
const HELLO_MS = 5000, READY_MS = 120_000;
/** How long a stop gives each worker, and then the save queue. */
const DRAIN_MS = 10_000;
/** Review 2 M1: how long the door refuses a deleted account's tickets: longer than any join ticket lives (an hour). */
const GONE_MS = 2 * 60 * 60 * 1000;
/** MP2.2g: how many settled accounts the door remembers; one it forgot is asked once more, which moves nothing. */
const SETTLED_ACCOUNTS = 65_536;
/** J177: one address, and no slug on it. */
const WORLD_PATH = /^\/(?:\?.*)?$/u;
/** GO7: the cell a page asks to be seated in (`/?chunk=<instance>`, `gotoSocket` in the online shell: the page's own `?chunk=` turned into
 *  a goto, ZS5), or null. Only a name shaped like a grid instance is kept; whether this world opens it is the door's question (`cellFor`). */
export function gotoCell(path: string | undefined): string | null {
  const query = path?.indexOf('?') ?? -1, cell = query < 0 ? null : new URLSearchParams(path?.slice(query + 1)).get('chunk');
  return cell !== null && /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(cell) && cell.length <= 64 ? cell : null;
}
/** QA 11-19 row 52: a goto a fresh ZONE SELECT pick made (`&at=spawn`, `gotoSocket`) seats the player at the cell's spawn, never where
 *  its save last stood (the step out onto the road, which handed them straight back to it). Only until the page is first seated: a
 *  redial of the same page asks without it and comes back where it stood. An older page never says it. `at` is the harness's own
 *  spawn-pose name (lint/url-params.json), read here on the world's socket only, never on a page. */
export function gotoSpawn(path: string | undefined): boolean {
  const query = path?.indexOf('?') ?? -1;
  return query >= 0 && gotoCell(path) !== null && new URLSearchParams(path?.slice(query + 1)).get('at') === 'spawn';
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

/** SB42: a proof pass the page offers as a WebSocket subprotocol (`wspass.<lane>.<expires>.<signature>`, a header token cannot hold
 *  `:`), in `ticket.ts`'s `pass:` form; null when none is offered. */
function passText(header: string | undefined): string | null {
  const offered = header?.split(',').map(word => word.trim()).find(word => word.startsWith('wspass.'));
  return offered === undefined ? null : `pass:${offered.slice('wspass.'.length)}`;
}

/** What the door holds of one worker. */
export interface WorkerLink {
  send: (order: CellOrder, transfer?: readonly Transferable[]) => void;
  /** The worker's news, and an end nobody asked for. */
  listen: (news: (row: WorkerNews) => void, ended: (reason: string) => void) => void;
  stop: () => void;
}
/** What a read of a player's save answers. */
export interface SavedPlayer { readonly doc: PlayerDoc | null; readonly seq: number; readonly recovery?: readonly SaveReceipt[]; readonly previous?: SavedCheckpoint;readonly checkpoint?:CheckpointCertificate }
/** Where a player's save lives. */
export interface PlayerSaves {
  /** The cell this player last stood in, this epoch: a grid instance (ZS7's place row), or an older save's shard. */
  where: (device: string) => Promise<string | null>;
  /** A player's doc on one shard: a cell's progress is kept under its shard's slug. */
  read: (device: string, shard: string) => Promise<SavedPlayer>;
  /** Optional database-backed admission read. In-memory/legacy adapters cannot attest durability. */
  readWitness?: (device:string,shard:string)=>Promise<SavedPlayer>;
  /** Promote a previous copy only after a room imports it, and only while its sequence is unchanged. */
  recover?: (device: string, shard: string, seq: number) => Promise<void>;
  write: (write: SaveWrite) => void;
  /** Actual durable transaction observations. Memory-only stores omit this capability. */
  onSave?: (listener: (status: PersistenceStatus) => void) => () => void;
  report: (report: ChatReport, shard: string) => boolean;
  /** MP2.2d: move a device's guest progress to an account with none (`saves/claim.ts`'s answer). Left out, nothing is claimed. */
  claim?: (device: string, account: string) => Promise<ClaimResult>;
  /** MP2.3: delete guests unseen for this many days (`saves/expiry.ts`); how many went. Left out (memory saves), none expire. */
  expire?: (days: number) => Promise<number>;
  /** MP2.5a: an account's data, or undefined (`saves/account.ts`). Left out (memory saves), the door has no account routes. */
  exportAccount?: (account: string) => Promise<AccountExport | undefined>;
  /** MP2.5a: delete an account, leaving anonymous ledger rows; whether there was one. */
  deleteAccount?: (account: string) => Promise<boolean>;
  /** QA-FEEDBACK-2026-11-20-mini row 9: New Game. Forget this player's save on one shard, once its writes on the way have landed;
   *  whether there was one. Left out, the door never offers the `saves` word. */
  reset?: (device: string, shard: string) => Promise<boolean>;
  /** MP2.4: claim a cleaned Name for this device and answer what everyone reads (`Name#1234`). Left out, the Name goes as typed. */
  name?: (device: string, name: string) => Promise<string>;
  /** Wait for what is on its way, at most `ms`. */
  drain: (ms: number) => Promise<boolean>;
  /** How writes are going: E7.8's numbers. */
  stats?: () => Readonly<Record<string, number>>;
  readonly zoneEntries?: ZoneEntryStore;
  readonly metricSessions?: RoomSessionStore;
  readonly roomGame?: RoomGameStore;
  readonly metricsDaily?: ReadRoomMetricDay;
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
  /** ONE-FORMAT OF31h2: what each cell's own shard file declares about its worker; a cell with none keeps the table's measured row. */
  readonly declared?: DeclaredCells;
  /** Start one worker on one row of the table. */
  readonly boot: (slugs: readonly string[]) => WorkerLink;
  readonly saves: PlayerSaves;
  readonly log: (line: Record<string, unknown>) => void;
  /** A worker failed: nothing here can go on, and the process should end (Q77). */
  readonly crashed: (error: unknown) => void;
  /** The grace ran out: stop, and let systemd start what is on disk. */
  readonly restart: () => void;
  /** One worker's 10 s reading, for what leaves the box (E7.8a) and `/metrics` (SC1). */
  readonly reading?: (index: number, reading: WorkerReading) => void;
  /** SERVER-CELLS SC1: a cell (or a worker's road) opened in `ms`, as `cell.booted` logs it. */
  readonly booted?: (index: number, slug: string, ms: number) => void;
  /** SC1: a crossing's time from its source's ask to its worker's answer, and whether the seat moved. */
  readonly crossed?: (ms: number, moved: boolean) => void;
  /** METRICS MT4: a confirmed Zone Select or walking arrival. The seat id stays inside the world process. */
  readonly entered?: (seat: string, slug: string, actor: ActorTags) => void;
  readonly sessions?: RoomSessions;
  readonly playtest?:(row:PlaytestRow)=>void;
  /** J218: the ICE servers voice chat hands a player who joins; public STUN when absent. */
  readonly voiceIce?: () => Promise<readonly VoiceIceServer[]>;
  /** VH10: which forwarded header a loopback proxy may set (`doorTrust`); `caddy` when absent. */
  readonly trustProxy?: TrustProxy;
  /** MP2.2c: the api-server's join-ticket key, SPKI DER hex; the pinned `PLAYER_TICKET_PUBLIC_KEY` when absent. */
  readonly ticketKey?: string;
  /** VH10: the pages a browser may open a socket from; `null` is any. The game's own hosts when absent. */
  readonly allowedOrigins?: readonly string[] | null;
  /**
   * J353: each worker hosts a road. SA34a: a placed cell then opens on the worker of its nearest open cell, whose
   * road hands a seat into it, and every worker's road is told of it; without roads it boots on a worker of its own (SA33).
   */
  readonly roads?: boolean;
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
  /** The row each worker owns, retained for a planned replacement. */
  private readonly workerSlugs = new Map<WorkerLink, readonly string[]>();
  /** A replacement's old worker may exit without taking the whole server down. */
  private readonly replacing = new Set<WorkerLink>();
  private readonly sockets = new Map<string, number>();
  private readonly connects = new Map<string, ConnectAttempt[]>();
  /** SB42: when each address's word-only sockets closed, this minute; and its bad passes. */
  private readonly words = new Map<string, number[]>();
  private readonly badPasses = new Map<string, number[]>();
  /** SB42: passes read this run, by their text: the budget key and expiry, so a lane's next socket skips the signature check. */
  private readonly passes = new Map<string, { readonly key: string; readonly expiresMs: number }>();
  private readonly ends = new Set<SocketTransport>();
  /** Links whose player quit (`ready` with `LEAVE_FLAG`) before a body was theirs. */
  private readonly quits = new WeakSet<SocketTransport>();
  /** FM7b2: a full world's waiting line (seatQueue.ts). */
  private readonly queue = new SeatQueue();
  /** DEVICE-TELEMETRY DT4: each socket's device word and the player its hello named, until the one `client.device` line is written. */
  private readonly devices = new WeakMap<SocketTransport, { said?: DeviceSnapshot; who?: DeviceWho; done: boolean }>();
  private readonly actors = new WeakMap<SocketTransport, SocketActor>();
  private readonly seatActors = new Map<string, SocketActor>();
  private readonly markerSeats = new MarkerSeats();
  /** Clients loading: each holds a seat, and has no body yet. */
  private readonly pending = new Map<string, PendingSeat>();
  /** Who has a body, by link or by hold, and in which cell. */
  private readonly seated = new Map<string, string>();
  /** MP2.2g: accounts a claim found with progress (`moved` or `kept`): no later claim can move anything into them. Oldest go first. */
  private readonly settled = new Set<string>();
  /** Review M1: seats inside a join between the ticket's read and their seat, and seats mid-delete, so neither starts beside the other. */
  private readonly joiners = new Map<string, number>();
  private readonly deleting = new Set<string>();
  /** QA-FEEDBACK-2026-11-20-mini row 9: seats whose New Game is under way: the door seats them again only once it is done. */
  private readonly resets = new Set<string>();
  /** Sockets with a `saves` read under way: one at a time each. */
  private readonly savesReading = new WeakSet<SocketTransport>();
  /** Review 2 M1: accounts deleted here, until every join ticket they could hold has expired (api-server's tickets last an hour). */
  private readonly gone = new Map<string, number>();
  /** MP2.4: the Name each body was seated with, which a held body keeps when its player comes back. */
  private readonly names = new Map<string, string>();
  /** Each seated device's voice seat, renamed to the body its cell seated it in (`seated`). */
  private readonly voiceBodies = new Map<string, (body: string) => void>();
  private readonly finds = new Map<number, (found: { held: boolean; spawn: ResumeAt }) => void>();
  /** MEMORY-STRUCTURE STR4: dev controls waiting on their worker's answer (DEVSERVER builds only). */
  private readonly devs = new Map<number, (answer: DevAnswer) => void>();
  private readonly drains = new Map<number, () => void>();
  /** GC15: devices whose crossing the door is reading a save for, or whose `cross` order a worker has not answered, and when it began (SC1). */
  private readonly crossings = new Map<string, number>();
  /** GC15 (3): each seated device's socket and a copy of the hello it was seated with, so a crossing onto another worker can move both. */
  private readonly seatSockets = new Map<string, { readonly end: SocketTransport; readonly hello: ArrayBuffer; readonly admission: number; entering: boolean; confirmed: boolean }>();
  private admission=0;
  /** GC15 (3): a crossing onto another worker, between the source's `handOut` and the socket's `out`: where it arrives and with what save. */
  private readonly outs = new Map<string, { readonly from: string; readonly to: string; readonly at: ResumeAt; readonly entry: SeatEntry }>();
  /** GC15 (3): each worker's grid cells whose entryways stand, as its `booted` said. */
  private readonly stands = new Map<WorkerLink, readonly string[]>();
  /** GC15: devices whose source said `left` while their crossing was in flight: applied if the crossing is abandoned before `cross`. */
  private readonly leftCrossing = new Set<string>();
  /** ZE9b (J352): seats frozen at a gate whose page was told `arrive` and is loading the cell: the road, the cell and the pose past the gate. */
  private readonly entries = new Map<string, { readonly from: string; readonly to: string; readonly at: ResumeAt }>();
  /** ZE9c: entries whose socket went mid-load: a redial while the road still holds the frozen body is seated in the cell past its gate. */
  private readonly redials = new Map<string, { readonly from: string; readonly to: string; readonly at: ResumeAt }>();
  /** ZE9b: entries whose page said `ready` and whose move is under way: the cell, so a move the worker refuses is answered to the page. */
  private readonly moving = new Map<string, string>();
  private asked = 0;
  /** SA33: cells whose late worker is booting, so a second open of the same cell boots nothing. */
  private readonly booting = new Set<string>();
  /** SA34a: workers that have said `booted`, the only ones a `place` order may reach. */
  private readonly up = new Set<WorkerLink>();
  /** RR2: what each booted worker holds (its `booted` news, then each `placed`), for `/health`. */
  private readonly resident = new Map<WorkerLink, WorkerResident>();
  /** SA34a: `place` orders waiting on the worker that opens their cells. */
  private readonly placings = new Map<number, (news: { readonly opened: readonly string[]; readonly error?: string }) => void>();
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
    const offSave = options.saves.onSave?.(status => { this.saved(status); });
    if (offSave !== undefined) this.scope.onDispose(offSave);
  }
  /** Only this player's current live socket hears its actual persistence outcome. No device flag on later words. */
  private saved(fact: PersistenceStatus): void {
    const end = this.seatSockets.get(fact.player)?.end;
    if (end === undefined || !end.isOpen || this.draining) return;
    const status = persistenceEnvelope({ v: 1, persistence: { code: fact.code, sequence: fact.sequence, scope: fact.shard } });
    if (status === null) return;
    end.control('world', new TextEncoder().encode(JSON.stringify({ cells: this.links.size,
      shards: [...new Set([...this.links.keys()].map(cellShard))], status } satisfies WorldWord)).buffer);
  }
  /** Start every worker on its row and wait for all of them. Nothing changes after this. */
  static async open(options: WorldOptions): Promise<World> {
    const world = new World(options);
    await Promise.all(workerTable(options.cells, options.workers, options.declared).map(slugs => world.bootWorker(slugs)));
    return world;
  }
  /** A worker on its row. At startup its cells are in the table at once, and any failure ends the process (Q77). SA33: a `late` worker's cells
   *  join the table only once it has booted, and one that fails to boot is let go with nobody seated on it; after its boot it is like any. */
  private bootWorker(slugs: readonly string[], late = false, slot?: number): Promise<void> {
    const link = this.options.boot(slugs), index = slot ?? this.workers.push(link) - 1;
    if (slot !== undefined) this.workers[slot] = link;
    this.workerSlugs.set(link, slugs);
    if (!late) for (const slug of slugs) this.links.set(slug, link);
    let up = false;
    return new Promise((resolve, reject) => {
      const ended = (reason: string): void => {
        this.options.log({ at: 'worker.ended', index, slugs, reason }); reject(new Error(reason)); this.up.delete(link); this.resident.delete(link); this.stands.delete(link); this.workerSlugs.delete(link);
        if (this.replacing.delete(link)) return;
        if (late && !up) { link.stop(); if (this.workers.at(-1) === link) this.workers.pop(); return; }
        this.options.crashed(new Error(reason));
      };
      link.listen(news => {
        if (news.kind === 'booted') { up = true; this.up.add(link); if (news.resident !== undefined) this.resident.set(link, news.resident); if (news.stands !== undefined) { this.stands.set(link, news.stands); this.openRoads(); } if (late) for (const slug of slugs) this.links.set(slug, link); this.options.log({ at: 'worker.booted', index, slugs, ms: news.ms }); resolve(); }
        else if (news.kind === 'failed') ended(news.reason); else this.heard(index, news);
      }, ended);
    });
  }
  /** MP1.3: replace an idle worker without exposing a process or host control surface. Seats need the drain/reconnect half first. */
  async restartWorker(index: number): Promise<void> {
    const old = this.workers[index], slugs = old === undefined ? undefined : this.workerSlugs.get(old);
    if (old === undefined || slugs === undefined) throw new Error(`No worker ${String(index)}`);
    if ([...this.seated.values()].some(slug => this.linkOf(slug) === old)) throw new Error('A worker with seated players needs drain and reconnect');
    this.options.log({ at: 'worker.restarting', index, slugs });
    this.replacing.add(old); this.up.delete(old); this.resident.delete(old); this.stands.delete(old); old.stop();
    await this.bootWorker(slugs, false, index);
    this.openRoads();
  }
  /** MP1.3: drain one worker's seats through their normal save-and-redial path, then replace only that worker. */
  async restartDrainedWorker(index: number): Promise<void> {
    const old = this.workers[index], slugs = old === undefined ? undefined : this.workerSlugs.get(old);
    if (old === undefined || slugs === undefined) throw new Error(`No worker ${String(index)}`);
    this.options.log({ at: 'worker.draining', index, slugs });
    const drained = new Promise<void>(resolve => {
      const timer = this.scope.timeout(DRAIN_MS, resolve);
      this.drains.set(index, () => { this.scope.cancelTimer(timer); resolve(); });
      old.send({ kind: 'drain', leave: true });
    });
    await drained;
    if (!await this.options.saves.drain(DRAIN_MS)) throw new Error('Worker save drain timed out');
    if ([...this.seated.values()].some(slug => this.linkOf(slug) === old)) throw new Error('Worker drain left seated players');
    this.replacing.add(old); this.up.delete(old); this.resident.delete(old); this.stands.delete(old); old.stop();
    await this.bootWorker(slugs, false, index);
    this.openRoads();
  }
  /** SP20: publish the new placement hashes to every live worker before acknowledging activation.
   * F48: each worker starts an open room of a moved hash over on it once no live player is in it (`cellHost.ts`). */
  async activateCells(cells: readonly string[]): Promise<readonly string[]> {
    if (this.draining) throw new Error('The world is draining');
    const updates = [...this.up].map(link => {
      const id = ++this.asked;
      const answer = new Promise<{readonly opened: readonly string[]; readonly error?: string}>(resolve => {this.placings.set(id, resolve);});
      link.send({kind: 'place', id, cells: placedCells(), open: []});
      return answer.then(row => {if (row.error !== undefined) throw new Error(row.error); return undefined;});
    });
    await Promise.all(updates);
    return this.openCells(cells);
  }
  /**
   * SA33: open cells on a running world (a placement the API made, J314) on a worker of their own. No other worker is told anything, so every
   * player in another cell stays where they are, and the door seats a player in a new cell only once its worker has booted. A cell this world
   * already opens is skipped. Rejects, with nothing opened, when the worker fails to boot. The next restart deals them out with the rest.
   */
  async openCells(cells: readonly string[]): Promise<readonly string[]> {
    const fresh = [...new Set(cells)].filter(cell => !this.links.has(cell) && !this.booting.has(cell));
    if (fresh.length === 0 || this.draining) return [];
    for (const cell of fresh) this.booting.add(cell);
    let opened: readonly string[] = fresh;
    try {
      if (this.options.roads !== true) await this.bootWorker(fresh, true);
      else { const done: string[] = []; for (const cell of fresh) done.push(...await this.placeOnRoads(cell)); opened = done; }
    } finally { for (const cell of fresh) this.booting.delete(cell); }
    this.options.log({ at: 'cells.opened', cells: opened, total: this.links.size });
    return opened;
  }
  /**
   * SA34a: with roads, a placed cell opens on the worker of the open cell nearest it, so that worker's road hands a seat in (GC15 crosses
   * only inside one worker), and every booted worker's road lays it out. Every order carries the door's whole placed list, in its order, so
   * each worker numbers the placed cells' frames as the door does. Rejects, with nothing opened, when its worker can't open it.
   */
  private async placeOnRoads(fresh: string): Promise<readonly string[]> {
    const grid = gridAssembly(), spot = (cell: string): readonly [number, number] | undefined => grid.cells.find(row => row.instance === cell)?.cell;
    const [fx, fz] = spot(fresh) ?? [0, 0];
    const distance = (cell: string): number => { const at = spot(cell); return at === undefined ? Infinity : Math.abs(at[0] - fx) + Math.abs(at[1] - fz); };
    const nearest = [...this.links.keys()].reduce<string | undefined>((best, cell) => best === undefined || distance(cell) < distance(best) ? cell : best, undefined);
    const host = nearest === undefined ? undefined : this.links.get(nearest);
    if (host === undefined) throw new Error('No worker to open a placed cell on');
    const id = ++this.asked, cells = placedCells();
    const answer = new Promise<{ readonly opened: readonly string[]; readonly error?: string }>(resolve => { this.placings.set(id, resolve); });
    for (const link of this.up) link.send({ kind: 'place', id: link === host ? id : 0, cells, open: link === host ? [fresh] : [] });
    const { opened, error } = await answer;
    for (const cell of opened) this.links.set(cell, host);
    if (error !== undefined) throw new Error(error);
    return opened;
  }
  private heard(index: number, news: WorkerNews): void {
    if (news.kind === 'devAnswer') { this.devs.get(news.id)?.(news.answer); this.devs.delete(news.id); return; }
    // ZE9c review: the road let a held body go: no redial can arrive for it now
    if (news.kind === 'left') { const from = 'slug' in news ? news.slug : undefined; if (from !== undefined && this.redials.get(news.device)?.from === from) this.redials.delete(news.device); }
    if (news.kind === 'found') { this.finds.get(news.id)?.(news); this.finds.delete(news.id); }
    // GO7: a late `left` from the cell a goto moved them out of must not unseat them (or free their Name) in the new one.
    // GC15: a crossing's source lets the seat go before `crossed` says where it went: the seat stays counted until then.
    else if (news.kind === 'left') { const from = 'slug' in news ? news.slug : undefined; if (from !== undefined && this.crossings.has(news.device)) { if (this.seated.get(news.device) === from) this.leftCrossing.add(news.device); return; } if (from === undefined || this.seated.get(news.device) === from) this.forgetSeat(news.device); }
    // A voice is named for the body its cell seated (a room's first seat is its lead body), from the cell they now stand in.
    else if (news.kind === 'seated') {
      const {device,body,slug:from}=news;
      if(this.seated.get(device)===from){
        this.voiceBodies.get(device)?.(body);
        const socket=this.seatSockets.get(device);
        if (socket !== undefined && socket.admission === news.admission) {
          if (!socket.confirmed) {
            const observed = this.seatActors.get(device);
            const minute = this.markerSeats.seated();
            if (observed !== undefined) {
              observed.seatMinute = minute;
              this.markLeak(observed);
            }
          }
          socket.confirmed = true;
          const actor = this.seatActors.get(device)?.mark;
          if (actor !== undefined) this.options.sessions?.seated(device, roadHome(from) === null ? cellShard(from) : null, actor);
          if (socket.entering) {
            socket.entering = false;
            this.countEntry(device, from);
          }
        }
        if(news.checkpoint!==undefined&&socket!==undefined&&socket.admission===news.admission){
          const bytes=checkpointWord(this.discovery(),news.checkpoint);
          if(bytes!==undefined)socket.end.control('world',bytes);
        }
      }
    }
    else if (news.kind === 'metric-event') {
      const { device, slug: cell, metric } = news;
      if (this.seated.get(device) === cell) this.options.sessions?.event(device, metric);
    }
    else if (news.kind === 'refused') this.refuse(news.reason);
    else if (news.kind === 'recovered') void this.recover(news.device, cellShard(news.slug), news.seq);
    else if (news.kind === 'save') this.options.saves.write(news.write);
    else if (news.kind === 'report') { if (!this.options.saves.report(news.report, cellShard(news.slug))) this.refuse('report-backlog'); }
    else if (news.kind === 'chat') { for (const link of this.workers) link.send({ kind: 'chat', from: news.slug, line: news.line }); }
    else if(news.kind==='playtest')this.options.playtest?.(news.row);
    else if (news.kind === 'cell') { this.options.log({ at: 'cell.booted', index, slug: news.slug, ms: news.ms }); this.options.booted?.(index, news.slug, news.ms); }
    else if (news.kind === 'reading') { this.options.log({ at: 'worker', index, ...news.reading, refusals: this.refusals, connections: this.connectionStats, saves: this.options.saves.stats?.() }); this.options.reading?.(index, news.reading); }
    else if (news.kind === 'placed') {
      const link = this.workers[index];
      if (news.resident !== undefined && link !== undefined) this.resident.set(link, news.resident);
      // QA 11-23-b row 38: a cell opened on a running world tells every other worker's road it can be crossed into, as a booted cell
      // does; without it a seat on another worker's road was refused at the placed cell's gate (the road's `handOut` never opened it)
      if (news.stands !== undefined && news.stands.length > 0 && link !== undefined) {
        this.stands.set(link, [...new Set([...this.stands.get(link) ?? [], ...news.stands])]);
        this.openRoads();
      }
      const answer = this.placings.get(news.id);
      if (answer !== undefined) { this.placings.delete(news.id); answer(news); }
      if (news.error !== undefined) this.options.log({ at: 'cells.place-refused', index, error: news.error });
    }
    else if (news.kind === 'drained') { this.drains.get(index)?.(); this.drains.delete(index); }
    else if (news.kind === 'crossing') void this.crossing(news.slug, news.device, news.to, news.at);
    else if (news.kind === 'entering') void this.entering(news.slug, news.device, news.to, news.at);
    else if (news.kind === 'handedOut') { if (!news.out && this.outs.get(news.device)?.from === news.from) { this.outs.delete(news.device); this.abandon(news.device, news.from); this.thaw(news.from, news.device, this.moving.get(news.device), 'refused'); this.moving.delete(news.device); } }
    else if (news.kind === 'crossed') {
      const begun = this.crossings.get(news.device);
      if (begun !== undefined) this.options.crossed?.(diagnosticNow() - begun, news.moved);
      this.crossings.delete(news.device); this.leftCrossing.delete(news.device);
      // A moved seat stands in the target, on the same link; one the target refused after the source let it go is in neither.
      if (this.seated.get(news.device) === news.from) {
        if (news.moved) {
          this.seated.set(news.device, news.to); this.names.set(news.device, news.name); this.voiceBodies.get(news.device)?.(news.body);
          if (news.from !== news.to) {
            this.options.sessions?.crossed(news.device, roadHome(news.to) === null ? cellShard(news.to) : null);
            this.countEntry(news.device, news.to);
          }
        }
        else if (!news.stays) this.forgetSeat(news.device);
        else this.thaw(news.from, news.device, this.moving.get(news.device), 'refused');
      }
      this.moving.delete(news.device);
      this.options.log({ at: 'cell.crossed', index, device: news.device, from: news.from, to: news.to, moved: news.moved });
    }
  }
  private forgetSeat(device: string): void {
    this.options.sessions?.left(device);
    this.seated.delete(device); this.names.delete(device); this.seatActors.delete(device);
  }
  private countEntry(device: string, cell: string): void {
    const actor = this.seatActors.get(device)?.mark;
    if (actor !== undefined && roadHome(cell) === null) this.options.entered?.(device, cellShard(cell), actor);
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
    const ip = connectionKey(clientAddress(request.socket.remoteAddress ?? '', request.headers, this.options.trustProxy ?? DEFAULT_TRUST_PROXY));
    const pass = passText(request.headers['sec-websocket-protocol']);
    if (pass === null) { this.admitUpgrade(request, socket, head, ip, false); return; }
    void this.passKey(pass, ip).then(key => { if (!socket.destroyed) this.admitUpgrade(request, socket, head, key ?? ip, key !== null); return undefined; });
  }
  private admitUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, key: string, passed: boolean): void {
    const attempt = this.attempt(key, passed);
    if (attempt === null) { this.refuse('connections'); socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const goto = gotoCell(request.url), spawn = gotoSpawn(request.url);
    const queryAt = request.url?.indexOf('?') ?? -1;
    const header = request.headers[AGENT_HEADER];
    const actor = classifyActor({ userAgent: request.headers['user-agent'] ?? '',
      header: (Array.isArray(header) ? header[0] : header) ?? null,
      query: queryAt < 0 ? null : new URLSearchParams(request.url?.slice(queryAt + 1)).get('agent'),
      doorPass: passed ? passText(request.headers['sec-websocket-protocol']) : undefined });
    this.server.handleUpgrade(request, socket, head, ws => { this.opened(ws, key, attempt, goto, spawn, actor); });
  }
  /** SB42: the budget a live proof pass draws on (`pass:<lane>`), or null: no pass, a bad one, or an address past its bad passes. */
  private async passKey(text: string, ip: string): Promise<string | null> {
    const now = this.now(), kept = this.passes.get(text);
    if (kept !== undefined && kept.expiresMs > Date.now()) return kept.key;
    const bad = (this.badPasses.get(ip) ?? []).filter(at => now - at < MINUTE_MS);
    if (bad.length >= BAD_PASSES_PER_MINUTE) return null;
    const pass = await passOf(text, this.options.ticketKey ?? PLAYER_TICKET_PUBLIC_KEY, Date.now());
    if (pass === undefined) {
      if (!this.badPasses.has(ip) && this.badPasses.size >= MAX_TRACKED_IPS) { const oldest = this.badPasses.keys().next().value; if (oldest !== undefined) this.badPasses.delete(oldest); }
      bad.push(now); this.badPasses.set(ip, bad); this.refuse('bad-pass'); return null;
    }
    if (this.passes.size >= MAX_KEPT_PASSES) { const oldest = this.passes.keys().next().value; if (oldest !== undefined) this.passes.delete(oldest); }
    const key = `pass:${pass.lane}`; this.passes.set(text, { key, expiresMs: pass.expiresMs });
    return key;
  }
  /** Actual retained limiter state, also recorded in the worker operational log. */
  get connectionStats(): { readonly addresses: number; readonly attempts: number } {
    this.sweepConnects(this.now());
    return { addresses: this.connects.size, attempts: [...this.connects.values()].reduce((sum, times) => sum + times.length, 0) };
  }
  /** One connect against `key`'s minute and its open sockets, or null (429). SB42: a socket refused for the open-socket cap is not
   *  counted in the minute: counting it let a page's redials behind a full address keep that address shut for a minute more. */
  private attempt(key: string, passed = false): ConnectAttempt | null {
    const now = this.now(), recent = (this.connects.get(key) ?? []).filter(row => now - row.at < MINUTE_MS);
    if (recent.length >= (passed ? PASS_CONNECTS_PER_MINUTE : this.options.connectsPerMinute ?? CONNECTS_PER_MINUTE)) return null;
    if ((this.sockets.get(key) ?? 0) >= (passed ? PASS_SOCKETS : this.options.socketsPerIp ?? SOCKETS_PER_IP)) return null;
    if (!this.connects.has(key) && this.connects.size >= MAX_TRACKED_IPS) {
      const oldest = this.connects.keys().next().value;
      if (oldest !== undefined) this.connects.delete(oldest);
    }
    const attempt = { at: now }; recent.push(attempt); this.connects.set(key, recent);
    return attempt;
  }
  private sweepConnects(now: number): void {
    for (const [ip, times] of this.connects) if (now - (times.at(-1)?.at ?? -Infinity) >= MINUTE_MS) this.connects.delete(ip);
    for (const [ip, times] of this.words) if (now - (times.at(-1) ?? -Infinity) >= MINUTE_MS) this.words.delete(ip);
    for (const [ip, times] of this.badPasses) if (now - (times.at(-1) ?? -Infinity) >= MINUTE_MS) this.badPasses.delete(ip);
  }
  /** Take `attempt` out of `key`'s connects this minute. */
  private refund(key: string, attempt: ConnectAttempt): void {
    const kept = (this.connects.get(key) ?? []).filter(row => row !== attempt);
    if (kept.length === 0) this.connects.delete(key); else this.connects.set(key, kept);
  }
  /** SB42: a word-only socket's connect moves to the word budget while that has room this minute. */
  private wordOnly(key: string, attempt: ConnectAttempt): void {
    const now = this.now(), words = (this.words.get(key) ?? []).filter(at => now - at < MINUTE_MS);
    if (words.length >= WORDS_PER_MINUTE) return;
    if (!this.words.has(key) && this.words.size >= MAX_TRACKED_IPS) { const oldest = this.words.keys().next().value; if (oldest !== undefined) this.words.delete(oldest); }
    words.push(now); this.words.set(key, words); this.refund(key, attempt);
  }
  private opened(socket: WebSocket, ip: string, attempt: ConnectAttempt, goto: string | null, spawn: boolean, actor: ActorMark): void {
    const end = new SocketTransport(socket);
    this.actors.set(end, { mark: actor });
    this.sockets.set(ip, (this.sockets.get(ip) ?? 0) + 1); this.ends.add(end);
    // SB42: whether a hello came, and whether the door closed it for want of one
    let spoke = false, timedOut = false;
    end.onClose(reason => {
      if (reason === 'retry') this.refund(ip, attempt);
      // the page read the door's word and closed (GO4 `worldWord`), cleanly and before any hello: its own budget
      else if (reason === 'closed' && !spoke && !timedOut) this.wordOnly(ip, attempt);
      this.ends.delete(end); const left = (this.sockets.get(ip) ?? 1) - 1; if (left === 0) this.sockets.delete(ip); else this.sockets.set(ip, left);
    });
    // QA row 16: a clean quit counts from the first byte, not only once seated (`pumpSocket`'s own). A quit that lands while the door
    // still admits this link (in the same read as its `ready`, or before a held body is handed back) ends it with no seat and no hold.
    end.onControl((control, bytes) => { if (control === 'ready' && new Uint8Array(bytes)[0] === LEAVE_FLAG) { this.quits.add(end); end.close(LEFT); } });
    // GO4: the door's first word, before any hello: how many cells it hosts, and (opus-route2) the shard each runs, so a one-shard
    // page joins only a world that opens its shard. D7 keeps `/health` private on the rooms address, and a
    // grid page asks this on a socket of its own (`worldWord`). No build, serial or player data.
    // DEVICE-TELEMETRY DT3: `device: 1` says this door reads the client's device word; a client sends it only then.
    // FM4 deploy-blocked: while a deploy is due, the seconds left before the move (a title's Enter world holds in the last 15 s)
    const moving = this.grace === null ? {} : { moving: { inS: Math.max(0, Math.ceil((this.grace.endsAt - diagnosticNow()) / 1000)) } };
    // row 9: `saves: 1` says this door answers a seated page's `saves` word (its saves here, and New Game)
    const saves = this.options.saves.reset === undefined ? {} : { saves: 1 as const };
    // QA 11-23-b row 19: `where: 1` says this door answers a title's `where` word (the cell it would seat that player in), before any hello
    end.control('world', new TextEncoder().encode(JSON.stringify({...this.discovery(),device:1,...moving,...saves,where:1} satisfies WorldWord)).buffer);
    let whereAsked = false;
    end.onControl((control, bytes) => {
      if (control === 'device') this.deviceWord(end, bytes);
      else if (control === 'saves') void this.savesWord(end, bytes);
      else if (control === 'where' && !spoke && !whereAsked) { whereAsked = true; void this.whereWord(end, bytes); }
    });
    const timer = this.scope.timeout(this.options.helloMs ?? HELLO_MS, () => { timedOut = true; this.refuse('hello-timeout'); end.close('refused'); });
    const off = end.onMessage((_channel, bytes) => { spoke = true; off(); this.scope.cancelTimer(timer); void this.joining(end, bytes, goto, spawn); });
    end.onClose(() => { off(); this.scope.cancelTimer(timer); });
  }
  /** DT4: a client's device word, untrusted: one per socket, read and bounded by `readDeviceWord`. A junk or oversized word is counted
   *  and dropped, and the connect goes on. */
  private deviceWord(end: SocketTransport, bytes: ArrayBuffer): void {
    const seen = this.devices.get(end) ?? { done: false };
    if (seen.said !== undefined || seen.done) return;
    const said = readDeviceWord(bytes);
    if (said === null) { this.refuse('device-word'); this.options.log({ at: 'client.device-refused', bytes: bytes.byteLength }); seen.done = true; this.devices.set(end, seen); return; }
    const actor = this.actors.get(end);
    if (actor !== undefined) {
      if (said.actor !== undefined) actor.claimed = said.actor;
      if (actor.mark.actor === 'human') actor.mark = classifyActor({
        userAgent: said.ua, stored: said.actor === 'agent' ? said.lane ?? '1' : null,
      });
      this.markLeak(actor);
    }
    seen.said = said; this.devices.set(end, seen); this.deviceSeen(end);
  }
  private markLeak(actor: SocketActor): void {
    if (actor.leaked !== true && actor.seatMinute !== undefined) actor.leaked = this.markerSeats.leak(actor.seatMinute, actor.mark, actor.claimed);
  }
  markerReading(): MarkerReading { return this.markerSeats.read(); }

  /** DT4: the hello named this socket's player. */
  private devicePlayer(end: SocketTransport, who: DeviceWho): void {
    const seen = this.devices.get(end) ?? { done: false };
    seen.who ??= who; this.devices.set(end, seen); this.deviceSeen(end);
  }
  /** DT4: one `client.device` journal line per connect, once both the word and the hello's player are in. Privacy: the player id the
   *  hello already carries and device characteristics only; never the address, which the door keeps for its limits alone. */
  private deviceSeen(end: SocketTransport): void {
    const seen = this.devices.get(end);
    if (seen === undefined || seen.done || seen.said === undefined || seen.who === undefined) return;
    seen.done = true;
    this.options.log(deviceLine(seen.who, seen.said));
  }
  private async joining(end: SocketTransport, bytes: ArrayBuffer, goto: string | null, spawn = false): Promise<void> {
    try { await this.hello(end, bytes, goto, spawn); }
    catch (error) { if (!end.isOpen) return; this.options.log({ at: 'world.join', error: String(error) }); this.refuse(error instanceof SaveNewerError ? 'save-newer' : 'join-failed'); end.close(error instanceof SaveQuarantinedError ? 'refused' : 'retry'); }
  }
  /** Everyone in the grid or on their way: the cap counts all of them, whichever cell they stand in (J182). */
  private get taken(): number { return this.seated.size + this.pending.size; }
  /** The worker a cell runs on, or (GC15) whose road a name is. */
  /** GC15 (3): every worker's road hears which cells on the other workers a walker can stand in, and drops its walls round them. */
  private openRoads(): void {
    for (const link of this.up) {
      const cells = [...this.stands].filter(([other]) => other !== link && this.up.has(other)).flatMap(([, list]) => list);
      if (cells.length > 0) link.send({ kind: 'open', cells });
    }
  }
  /** MEMORY-STRUCTURE STR4: one dev control for a seated device, applied by the worker that holds its cell (`devControl.ts`). */
  dev(device: string, message: unknown): Promise<DevAnswer> {
    const cell = this.seated.get(device), link = cell === undefined ? undefined : this.linkOf(cell);
    if (link === undefined) return Promise.resolve({ ok: false, reason: 'that device is not seated' });
    const id = ++this.asked;
    return new Promise(resolve => {
      const timer = this.scope.timeout(5000, () => { this.devs.delete(id); resolve({ ok: false, reason: 'the worker did not answer' }); });
      this.devs.set(id, answer => { this.scope.cancelTimer(timer); resolve(answer); });
      link.send({ kind: 'dev', id, device, message });
    });
  }
  /** MEMORY-STRUCTURE STR4: the devices seated now, for a dev tool. */
  devSeats(): readonly string[] { return [...this.seated.keys()]; }
  private linkOf(slug: string): WorkerLink | undefined { return this.links.get(roadHome(slug) ?? slug); }
  private link(slug: string): WorkerLink {
    const link = this.linkOf(slug);
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
  /** MP2.2d: a device's guest progress to the account a ticket seats; a failed claim leaves both as they were and the join goes on. */
  private async claim(device: string, account: string): Promise<void> {
    // Review M1: a body the door holds, loads, moves or redials (the guest's or the account's) would save over the move, so the
    // claim waits for a join with neither live; it is tried at every ticketed join, so it happens at a later one.
    // MP2.2g: an account that has progress never takes a claim, so its later joins skip the transaction.
    if (this.settled.has(account)) return;
    if ([device, account].some(id => this.seated.has(id) || this.pending.has(id) || this.crossings.has(id) || this.redials.has(id) || this.entries.has(id))) return;
    try {
      const claimed = await this.options.saves.claim?.(device, account);
      if (claimed === 'moved') this.options.log({ at: 'saves.claimed' });
      if (claimed === 'moved' || claimed === 'kept') this.settle(account);
    }
    catch (error) { this.options.log({ at: 'saves.claim-failed', error: error instanceof Error ? error.message : String(error) }); }
  }
  private settle(account: string): void {
    this.settled.add(account);
    for (const oldest of this.settled) { if (this.settled.size <= SETTLED_ACCOUNTS) break; this.settled.delete(oldest); }
  }
  /** MP2.5a: whether this seat has a body in the world now (linked, held, loading, crossing or redialling). */
  isPlaying(seat: string): boolean {
    return this.joiners.has(seat) || this.seated.has(seat) || this.pending.has(seat) || this.crossings.has(seat) || this.redials.has(seat) || this.entries.has(seat);
  }
  /** MP2.5a: a deleted account starts empty again, so a later device's guest progress may be claimed into it. */
  forgetAccount(account: string, now: number = Date.now()): void {
    this.settled.delete(account);
    for (const [id, until] of this.gone) if (until <= now) this.gone.delete(id);
    this.gone.set(account, now + GONE_MS);
  }
  /**
   * QA-FEEDBACK-2026-11-20-mini row 9: a seated page's `saves` word. The page can't see the room's copy of its saves (the Saves card
   * read "QUESTS 0 DONE · EMPTY" mid-quest) nor reset it (New Game reloaded into every flag). The seat is the one this socket's hello
   * was admitted as, so a player only ever reads or resets their own save. A word from a socket with no seat is refused.
   */
  /**
   * QA 11-23-b row 19 (Jake ~11:30 Cancún: "Enter MMO should, ask the server where [...] I am, and then like load the correct zone, and
   * like not spawn me in Driftwood, and then not teleport me"): a title's ask, on a socket with no hello, for the cell this player's
   * next join would be seated in, as `join` reads it: the zone entry its last socket left mid-load, else the cell holding its body,
   * else its saved place through `cellFor` (the first cell for a new player). Nothing is seated, held or written; a player the door
   * would not admit hears null. The player string is a bearer credential and is never logged.
   */
  private async whereWord(end: SocketTransport, bytes: ArrayBuffer): Promise<void> {
    const ask = decodeWhereAsk(bytes);
    let cell: string | null = null;
    try {
      const ticketed = ask === null ? undefined : await admit(ask.player, this.options.ticketKey ?? PLAYER_TICKET_PUBLIC_KEY, Date.now());
      if (ticketed !== undefined && ticketed.expired !== true) {
        // review 2 M1, as at a hello: a live ticket for an account deleted here plays as its device's guest
        const seat = ticketed.from !== undefined && (this.gone.get(ticketed.seat) ?? 0) > Date.now() ? ticketed.from : ticketed.seat;
        const holding = this.seated.get(seat), redial = this.redials.get(seat);
        if (redial !== undefined && redial.from === holding && this.links.has(redial.to)) cell = redial.to;
        else if (holding !== undefined) cell = holding;
        else {
          // MP2.2d: a first sign-in's join claims the device's guest place into the account
          const last = await this.options.saves.where(seat) ?? (ticketed.from === undefined || seat === ticketed.from ? null : await this.options.saves.where(ticketed.from));
          cell = this.cellFor(last);
        }
      }
    } catch { cell = null; }
    if (ask === null) this.refuse('where-word');
    if (end.isOpen) end.control('where', encodeWhere({ cell }));
  }
  private async savesWord(end: SocketTransport, bytes: ArrayBuffer): Promise<void> {
    const ask = decodeSavesAsk(bytes), device = [...this.seatSockets].find(([, socket]) => socket.end === end)?.[0];
    if (ask === null || device === undefined) { this.refuse('saves-word'); return; }
    if ('reset' in ask) {
      if (!await this.newGame(device, end, ask.reset) && end.isOpen) end.control('saves', encodeSaves({ reset: ask.reset, ok: false }));
      return;
    }
    if (this.savesReading.has(end)) return;
    this.savesReading.add(end);
    try {
      const read: Record<string, RoomSave | null> = {};
      for (const shard of ask.read) {
        // a save the door can't read now (pending, quarantined, from a newer server) shows as nothing here: the card keeps the page's
        try { const saved = await this.options.saves.read(device, shard); read[shard] = saved.doc === null ? null : roomSaveOf(saved.doc, shard); } catch { read[shard] = null; }
        if (!end.isOpen) return;
      }
      end.control('saves', encodeSaves({ read }));
    } finally { this.savesReading.delete(end); }
  }
  /**
   * Row 9: New Game on `shard`. The body leaves first, as at a quit (the link closes plainly): its cell writes its last doc and lets it
   * go, so no later checkpoint can write the old save back. Then the save is forgotten, its writes on the way landed first; the seat's
   * joins wait meanwhile (`retry`). False, with the link still open, when it can't start: a crossing or zone entry under way, a reset
   * already running, or no saves that reset.
   */
  private async newGame(device: string, end: SocketTransport, shard: string): Promise<boolean> {
    const { saves } = this.options, reset = saves.reset;
    if (reset === undefined || this.draining || this.resets.has(device) || this.crossings.has(device) || this.outs.has(device) || this.entries.has(device) || this.redials.has(device)) return false;
    this.resets.add(device);
    const from = this.seated.get(device);
    this.quits.add(end); end.close(LEFT);
    try {
      if (from !== undefined && !await this.untilLeft(device, from)) { this.options.log({ at: 'save.reset-refused', shard, reason: 'still-seated' }); return true; }
      const found = await reset(device, shard);
      this.options.log({ at: 'save.reset', shard, found });
    } catch (error) { this.options.log({ at: 'save.reset-failed', shard, error: error instanceof Error ? error.message : String(error) }); }
    finally { this.resets.delete(device); }
    return true;
  }
  /** Row 9: whether the seat let go of `from` (its cell said `left`) within the hold a quit takes. */
  private untilLeft(device: string, from: string, ms = 10_000): Promise<boolean> {
    const waiting = new Scope('dedicated.reset'), until = diagnosticNow() + ms;
    return new Promise<boolean>(resolve => {
      const look = (): void => {
        if (this.seated.get(device) !== from) { waiting.dispose(); resolve(true); return; }
        if (diagnosticNow() >= until || this.draining) { waiting.dispose(); resolve(false); return; }
        waiting.timeout(20, look);
      };
      look();
    });
  }
  /** Review M1: hold a seat out of the world while it is deleted; undefined (nothing held) when it is playing. */
  holdForDelete(seat: string): (() => void) | undefined {
    if (this.isPlaying(seat) || this.deleting.has(seat)) return undefined;
    this.deleting.add(seat);
    return () => { this.deleting.delete(seat); };
  }
  /** The join: check, find where they stand, let them load, seat them. */
  private async hello(end: SocketTransport, sent: ArrayBuffer, goto: string | null, spawn = false): Promise<void> {
    const bytes = sent;
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
    // MP2.2c: a live join ticket seats its account; anything else, the device it names.
    const ticketed = await admit(said.output.player, this.options.ticketKey ?? PLAYER_TICKET_PUBLIC_KEY, Date.now());
    if (ticketed === undefined) { this.refuse('identity'); end.close('refused'); return; }
    // FM7b3c: a ticket this key signed that has run out is told so (FM7b1's `auth-expired` fact), never seated as its device's guest,
    // where the account's page would play on as someone else; the page asks its API for a fresh ticket, or says Please sign in again
    if (ticketed.expired === true) { this.refuse('auth-expired'); end.close('refused', { code: 'auth-expired' }); return; }
    // review 2 M1: a live ticket for an account deleted here plays as its device's guest, so nothing writes the account back
    const admitted = ticketed.from !== undefined && (this.gone.get(ticketed.seat) ?? 0) > Date.now() ? { seat: ticketed.from } : ticketed;
    const { seat } = admitted;
    // review M1: an account being deleted dials again in a moment, after which it is a fresh account
    if (this.deleting.has(seat)) { end.close('retry'); return; }
    // row 9: a New Game under way forgets this seat's save once its body has gone: the join waits for it, so it reads no old save
    if (this.resets.has(seat)) { end.close('retry'); return; }
    this.joiners.set(seat, (this.joiners.get(seat) ?? 0) + 1);
    try { await this.join(end, bytes, goto, hello, said.output, admitted, spawn); }
    finally { const left = (this.joiners.get(seat) ?? 1) - 1; if (left > 0) this.joiners.set(seat, left); else this.joiners.delete(seat); }
  }
  private async join(end: SocketTransport, sent: ArrayBuffer, goto: string | null, hello: Hello, said: { readonly player: string; readonly name: string }, admitted: { readonly seat: string; readonly from?: string }, spawn = false): Promise<void> {
    let bytes = sent;
    const { seat } = admitted;
    // MP2.2d: the first sign-in from a device with guest progress moves it to the account, once (`saves/claim.ts`).
    if (admitted.from !== undefined) await this.claim(admitted.from, seat);
    // a link that quit while the ticket was read still goes on, so a held body of its player is let go (QA row 16, `leaveHeld`)
    if ((!end.isOpen && !this.quits.has(end)) || this.draining) return;
    // The cells read the seat, never the ticket: the hello they get names it (the ticket is a bearer credential, kept nowhere).
    if (seat !== said.player) bytes = encodeHello({ ...hello, player: seat }).slice().buffer;
    const device = seat, typed = cleanName(said.name), body = bodyId(this.options.secret, device), { saves } = this.options, holding = this.seated.get(device);
    // ZE9c: a zone entry this device's last socket left mid-load, while its road still holds the body: it goes on into the cell, as a goto
    const redial = this.redials.get(device);
    this.redials.delete(device);
    const arrival = redial !== undefined && redial.from === holding && this.links.has(redial.to) ? redial : undefined;
    const aim = arrival?.to ?? goto;
    // a redial that can't go on into the cell (the road no longer holds it, or the cell went): the frozen body plays on
    if (redial !== undefined && arrival === undefined) this.thaw(redial.from, device, redial.to);
    // DT4: the Name everyone sees and the secret-keyed body id; never the raw player id, which is a bearer credential
    this.devicePlayer(end, { name: this.names.get(device) ?? typed, body });
    // GC15: a seat mid-crossing is in neither cell for the door to ask: the client dials again in a moment.
    if (this.crossings.has(device)) { end.close('retry'); return; }
    // FM7b2: a goto from a held seat brings that seat with it; the line is for devices that hold none
    let mover = false;
    if (holding !== undefined) {
      // MP2.4: a body the room holds keeps the Name it was seated with; a new Name is claimed on the next fresh join, never here,
      // so the reservation and what everyone reads can't part.
      const found = await this.ask(holding, device, end), name = this.names.get(device) ?? typed;
      if (found.held && this.quits.has(end)) { this.leaveHeld(holding, { device, name, body, doc: null, seq: 0, held: true }, bytes); return; }
      if (!end.isOpen || this.draining) return;
      // GO7: Shard select chose another cell this world opens. The held body leaves cleanly (saved), and the door admits them there.
      const moving = aim !== null && cellName(aim) !== holding && this.links.has(cellName(aim));
      // `leaveHeld` transfers the hello it is given, and this hello still seats them in the new cell: it gets a copy.
      mover = found.held && moving;
      if (mover) this.leaveHeld(holding, { device, name, body, doc: null, seq: 0, held: true }, bytes.slice(0));
      else if (found.held) { this.seat(holding, end, { device, name, body, doc: null, seq: 0, held: true }, bytes); return; }
    }
    // FM7b2: Title from a full world's line is the page's clean quit; its ticket goes at once
    if (this.quits.has(end)) { this.queue.leave(device); return; }
    if (!end.isOpen || this.draining) return;
    this.pending.get(device)?.end.close('replaced');
    // FM7b2: a full world's line, in the door's order; a freed seat is held for its head. The place rides FM7b1's close facts.
    // (`taken` still counts a mover's own seat until its old cell's `left` arrives)
    const turn = mover ? { admit: true } as const : this.queue.turn(device, this.options.seats - this.taken, Date.now());
    if (!turn.admit) {
      this.refuse('full');
      end.close('full', { code: 'queue', ...(turn.position === undefined ? {} : { position: turn.position }), ...(turn.etaMs === undefined ? {} : { etaMs: turn.etaMs }) });
      return;
    }
    this.pending.set(device, { end });
    end.onClose(() => { if (this.pending.get(device)?.end === end) this.pending.delete(device); });
    // MP2.4: the Name everyone reads is the claimed one, never the hello's, so a refused or duplicate Name reaches no client.
    const name = saves.name === undefined ? typed : await saves.name(device, typed);
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    const last = await saves.where(device);
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    const slug = this.cellFor(last, aim), saved = await (saves.readWitness?.(device,cellShard(slug)) ?? saves.read(device,cellShard(slug))), at = arrival?.at; // preserve ZE9's entry continuation
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    const { spawn: stand } = await this.ask(slug, device, end);
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    // QA 11-19 row 52: a ZONE SELECT pick of this cell starts at its spawn; its save (progress, and where it last stood) still loads
    // (the door seats a goto in its cell whenever this world opens it: `cellFor`)
    const fresh = spawn && at === undefined && goto !== null && this.links.has(cellName(goto));
    // GO3: `shard` is what a one-shard page loads, `cell` the grid instance a grid page stands in.
    end.control('resume', new TextEncoder().encode(JSON.stringify({ shard: cellShard(slug), cell: slug, at: at ?? (fresh ? stand : saved.doc?.at ?? stand) })).buffer);
    this.sayCountdown(end);
    await new Promise<void>(resolve => {
      const timer = this.scope.timeout(this.options.readyMs ?? READY_MS, () => { this.refuse('ready-timeout'); end.close('refused'); resolve(); });
      const off = end.onControl((control, flag) => { if (control === 'ready' && new Uint8Array(flag)[0] !== LEAVE_FLAG) { off(); this.scope.cancelTimer(timer); resolve(); } });
      end.onClose(() => { off(); this.scope.cancelTimer(timer); resolve(); });
    });
    if (!end.isOpen || this.pending.get(device)?.end !== end || this.draining) return;
    this.pending.delete(device);
    this.seat(slug, end, { device, name, body, doc: saved.doc, seq: saved.seq, ...(saved.checkpoint===undefined?{}:{checkpoint:saved.checkpoint}), ...(saved.recovery === undefined ? {} : { recovery: saved.recovery }), ...(saved.previous === undefined ? {} : { previous: saved.previous }), ...(at === undefined ? {} : { arrival: at }), ...(fresh ? { spawn: true } : {}) }, bytes, fresh || arrival !== undefined);
  }
  /**
   * GC15: a seat's feet left cell `from` for `to`. On the same worker the door reads their save on `to`'s shard and orders the move, which
   * keeps the seat and the socket. A cell and its worker's road cross the same way, with no save to read for the road. Between workers nothing moves yet (GC15 (3): `exportPlayer`/`importPlayer` and re-pointing the socket).
   */
  private async crossing(from: string, device: string, to: string, at: ResumeAt): Promise<void> {
    const link = this.linkOf(to), name = this.names.get(device);
    // GC15 (3): from a worker's road into a cell another worker hosts
    if (link !== undefined && link !== this.linkOf(from) && roadHome(from) !== null && roadHome(to) === null) { await this.crossWorkers(from, device, to, at); return; }
    if (link === undefined || link !== this.linkOf(from) || this.seated.get(device) !== from || name === undefined || this.draining || this.crossings.has(device)) return;
    this.crossings.set(device, diagnosticNow());
    try {
      // The road keeps no progress: a seat walks onto it with nothing to read.
      const saved: SavedPlayer = roadHome(to) === null ? await this.options.saves.read(device, cellShard(to)) : { doc: null, seq: 0 };
      if (this.seated.get(device) !== from || this.draining) { this.abandon(device, from); return; }
      link.send({ kind: 'cross', from, to, at, device, name, body: bodyId(this.options.secret, device), doc: saved.doc, seq: saved.seq,
        ...(saved.recovery === undefined ? {} : { recovery: saved.recovery }), ...(saved.previous === undefined ? {} : { previous: saved.previous }) });
    } catch (error) { this.abandon(device, from); this.options.log({ at: 'cell.cross-refused', device, from, to, reason: String(error) }); }
  }
  /**
   * GC15 (3): a seat on one worker's road walks into a cell on another worker. The door reads their save on that cell's shard, the road
   * sends the client `travel` and lets the seat go (`handOut`), and when its port says `out` the door points the same socket at a new port
   * into the target's worker, which seats them at `at` and hears their hello again (`arrive`). The socket never closes.
   */
  private async crossWorkers(from: string, device: string, to: string, at: ResumeAt): Promise<void> {
    const source = this.linkOf(from), name = this.names.get(device);
    if (source === undefined || this.seated.get(device) !== from || name === undefined || this.draining || this.crossings.has(device) || !this.seatSockets.has(device)) return;
    this.crossings.set(device, diagnosticNow());
    try {
      const saved = await this.options.saves.read(device, cellShard(to));
      if (this.seated.get(device) !== from || this.draining || !this.seatSockets.has(device)) { this.abandon(device, from); return; }
      this.outs.set(device, { from, to, at, entry: { device, name, body: bodyId(this.options.secret, device), doc: saved.doc, seq: saved.seq,
        ...(saved.recovery === undefined ? {} : { recovery: saved.recovery }), ...(saved.previous === undefined ? {} : { previous: saved.previous }) } });
      source.send({ kind: 'handOut', from, device, to });
    } catch (error) { this.outs.delete(device); this.abandon(device, from); this.options.log({ at: 'cell.cross-refused', device, from, to, reason: String(error) }); }
  }
  /** GC15 (3): the source let the seat go and everything it said is on its way: the socket now pumps into the target's worker. */
  private movedOut(device: string, end: SocketTransport, motion: unknown, seq: number | undefined): void {
    const out = this.outs.get(device), kept = this.seatSockets.get(device), link = out === undefined ? undefined : this.linkOf(out.to);
    this.outs.delete(device);
    if (out === undefined || kept?.end !== end || link === undefined || !end.isOpen || this.draining) { this.abandon(device, out?.from ?? ''); end.close(this.draining ? 'restart' : 'retry'); return; }
    const { port1, port2 } = new MessageChannel(), hello = kept.hello.slice(0);
    pumpSocket(end, port1, undefined, (next, nextSeq) => { this.movedOut(device, end, next, nextSeq); });
    link.send({ kind: 'arrive', from: out.from, to: out.to, at: out.at, port: port2, hello, motion: motion as MotionSnapshot | null, ...(seq === undefined ? {} : { commandSeq: seq }), ...out.entry }, [port2, hello]);
  }
  /**
   * ZE9b (J352): road `from` froze a seat at the gate of `to` (its `enter`). The door tells the page `arrive` with the pose past the gate
   * and waits, as for a hello, for its `ready` (the page has disposed the old world and loaded the cell); then the seat moves the way a
   * crossing does, on the same socket: the road's `handOver` on its own worker, `handOut` and `arrive` onto another. A page that never
   * says `ready` in time, or a move the door won't make, is answered `enter` {refused} and the road lets the body go.
   */
  private async entering(from: string, device: string, to: string, at: ResumeAt): Promise<void> {
    const kept = this.seatSockets.get(device);
    if (kept === undefined || this.linkOf(to) === undefined || this.seated.get(device) !== from || roadHome(from) === null || this.draining || this.entries.has(device) || this.crossings.has(device)) {
      this.thaw(from, device, to, 'busy'); return;
    }
    const entry = { from, to, at }, { end } = kept;
    this.entries.set(device, entry);
    end.control('arrive', encodeArrive({ cell: to, at }));
    const readied = await new Promise<boolean>(resolve => {
      if (!end.isOpen) { resolve(false); return; }
      const offs: (() => void)[] = [];
      const done = (ready: boolean): void => { for (const off of offs.splice(0)) off(); resolve(ready); };
      const timer = this.scope.timeout(this.options.readyMs ?? READY_MS, () => { done(false); });
      offs.push(() => { this.scope.cancelTimer(timer); },
        end.onControl((control, flag) => { if (control === 'ready' && new Uint8Array(flag)[0] !== LEAVE_FLAG) done(true); }),
        end.onClose(() => { done(false); }));
    });
    if (this.entries.get(device) !== entry) return;
    this.entries.delete(device);
    // ZE9c: the socket went mid-load. The road holds the frozen body as it holds any dropped seat; a redial in that time arrives past the gate
    if (!readied && !end.isOpen && !this.draining) { this.redials.set(device, entry); return; }
    if (!readied) { this.refuse('enter-timeout'); this.thaw(from, device, to, 'timeout'); return; }
    if (this.seated.get(device) !== from || this.draining) { this.thaw(from, device, to, 'moved'); return; }
    this.options.log({ at: 'cell.entering', device, from, to });
    this.moving.set(device, to);
    await this.crossing(from, device, to, at);
    // the move never began (the door would not make it): the body plays on at the gate
    if (!this.crossings.has(device) && this.seated.get(device) === from && !this.outs.has(device)) { this.moving.delete(device); this.thaw(from, device, to, 'refused'); }
  }
  /** ZE9b: the zone entry of `device`, frozen on road `from`, is off: the road lets the body go, and the page hears why (if it still listens). */
  private thaw(from: string, device: string, to?: string, reason: string | null = null): void {
    if (roadHome(from) === null) return;
    this.linkOf(from)?.send({ kind: 'thaw', from, device });
    const end = this.seatSockets.get(device)?.end;
    if (reason !== null && to !== undefined && end?.isOpen === true) end.control('enter', encodeEnter({ cell: to, refused: reason }));
  }
  /** A crossing that never reached its worker: a `left` the source said meanwhile counts now. */
  private abandon(device: string, from: string): void {
    this.crossings.delete(device);
    if (this.leftCrossing.delete(device) && this.seated.get(device) === from) this.forgetSeat(device);
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
  /** The catalogue the room door can seat now, including successful live placements. */
  openShards(): readonly string[] {
    return [...new Set([...this.links].filter(([cell, link]) => roadHome(cell) === null && this.up.has(link)).map(([cell]) => cellShard(cell)))];
  }

  private discovery():Pick<WorldWord,'cells'|'shards'|'revisions'>{
    const shards=[...new Set([...this.links.keys()].map(cellShard))];
    return {cells:this.links.size,shards,...worldRevisions(shards,placedHash)};
  }
  private seat(slug: string, end: SocketTransport, entry: SeatEntry, hello: ArrayBuffer, entering = false): void {
    if (!end.isOpen || this.draining) return;
    const { port1, port2 } = new MessageChannel();
    this.seated.set(entry.device, slug); this.names.set(entry.device, entry.name);
    const actor = this.actors.get(end);
    if (actor !== undefined) this.seatActors.set(entry.device, actor);
    if(this.options.playtest!==undefined){
      const off=end.onControl((control,bytes)=>{
        if(control!=='playtest')return;
        try{const parsed=v.safeParse(CorrectionSchema,JSON.parse(new TextDecoder().decode(bytes)) as unknown);if(parsed.success)this.options.playtest?.(parsed.output);else this.refuse('playtest-record');}
        catch{this.refuse('playtest-record');}
      });
      end.onClose(off);end.control('playtest');
    }
    const admission=++this.admission;
    this.seatSockets.set(entry.device, { end, hello: hello.slice(0), admission, entering, confirmed: false });
    // Only a road can admit an enter. A cell must answer instead of leaving
    // the page waiting for its ten-second silent-peer fallback.
    const refusedEnter = end.onControl((control, bytes) => {
      if (control !== 'enter' || this.seatSockets.get(entry.device)?.end !== end) return;
      const from = this.seated.get(entry.device);
      if (from === undefined || roadHome(from) !== null) return;
      const word = decodeEnter(bytes);
      if (word !== null && word.refused === undefined) end.control('enter', encodeEnter({ cell: word.cell, refused: 'not-at-gate' }));
    });
    end.onClose(refusedEnter);
    end.onClose(() => {
      if (this.seatSockets.get(entry.device)?.end !== end) return;
      this.seatSockets.delete(entry.device);
      // GC15 (3), review MUST: the socket went while a crossing onto another worker waited for its `out`, which this close swallowed:
      // the crossing is off, and a `left` the road said (or says next) frees the seat
      const out = this.outs.get(entry.device);
      if (out !== undefined) { this.outs.delete(entry.device); this.abandon(entry.device, out.from); }
    });
    pumpSocket(end, port1, undefined, (motion, seq) => { this.movedOut(entry.device, end, motion, seq); });
    const rebody = this.voice.attach(end, slug, entry.name, entry.body);
    this.voiceBodies.set(entry.device, rebody);
    end.onClose(() => { if (this.voiceBodies.get(entry.device) === rebody) this.voiceBodies.delete(entry.device); });
    this.link(slug).send({ kind: 'seat', slug, port: port2, hello, ...entry,admission }, [port2, hello]);
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
  /** A confirmed live link counts until the socket leaves, even while it is on the road. */
  livePlayers(): LivePlayers {
    const zones = new Map<string, Record<ActorTags['actor'], number>>();
    const total = { human: 0, agent: 0 };
    for (const [device, socket] of this.seatSockets) {
      const cell = this.seated.get(device), actor = this.seatActors.get(device)?.mark.actor;
      if (!socket.confirmed || cell === undefined || actor === undefined) continue;
      const slug = roadHome(cell) === null ? cellShard(cell) : '_road';
      const count = zones.get(slug) ?? { human: 0, agent: 0 };
      count[actor]++;
      total[actor]++;
      zones.set(slug, count);
    }
    return { humans: total.human, agents: total.agent, zones: Object.fromEntries(zones) };
  }

  /**
   * What `/health` says: no player data. `table` is each open cell and the worker it runs on (GO3, MP1.4). `resident` (ROAD-RESIDENT RR2) is
   * what the booted workers say they hold: cells open in memory, roads open, and the strips those roads stand on.
   */
  health(): { readonly build: string; readonly cells: number; readonly workers: number; readonly awake: number; readonly players: number; readonly humans: number; readonly agents: number; readonly table: Readonly<Record<string, number>>; readonly resident: { readonly cells: number; readonly roads: number; readonly strips: number } } {
    const table = Object.fromEntries([...this.links].map(([cell, link]) => [cell, this.workers.indexOf(link)]));
    const rows = [...this.resident.values()];
    const resident = { cells: rows.reduce((sum, row) => sum + row.cells, 0), roads: rows.filter(row => row.road).length, strips: rows.reduce((sum, row) => sum + row.strips, 0) };
    const { humans, agents } = this.livePlayers();
    return { build: this.options.build, cells: this.links.size, workers: this.workers.length, awake: new Set(this.seated.values()).size, players: this.seated.size, humans, agents, table, resident };
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

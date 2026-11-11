// P1-E5.2 (E5-REPLICATION §3.3, §4): the server's end of the game protocol. One room steps one world on the fixed tick,
// builds a world frame every second tick (30 Hz, J40) and encodes each client's delta from it. It holds no socket and
// no save: a Transport carries its bytes, and accounts, rooms and persistence stay in the MMO plan.
import * as v from 'valibot';
import { installPortableMath } from '../../../shared/engine/core/portableMath';
import { NetRoomActSchema, type NetChatReport, type NetChatSay, type NetTickAct } from '../../../shared/engine/net/acts';
import { CHAT_RADIUS, RoomChat, type ChatLine, type ChatReports } from './chat';
import { cleanName } from './chatFilter';
import type { CombatEvent } from './combatWire';
import type { QuestProgress } from '../../../shared/engine/quest/progress';
import { seqAfter } from '../../../shared/engine/net/command';
import { CommandQueue, type CommandTurn } from './commandQueue';
import { FRAME_RING, WorldFrameRing, type WorldFrame } from '../../../shared/engine/net/frame';
import { encodeFrame } from '@wildshard/wire/frameRecord';
import { readMessage, TAG_ACT, TAG_CMDS } from '@wildshard/wire/game';
import { decodeFirstMessage } from '@wildshard/wire/handshake';
import { WIRE_MINOR } from '@wildshard/wire/major';
import { snapshotOf } from '../../../shared/engine/net/wireFrames';
import { eventsMessage, welcomeMessage, WireClientReader, type Span } from '../../../shared/engine/net/wireMessages';
import { NetHandles } from './handles';
import { GUEST, NetIdentitySchema, type NetIdentity } from '../../../shared/engine/net/identity';
import type { NetDied, NetPlayerDied, NetView, NetEvent, NetHit, NetReward } from '../../../shared/engine/net/messages';
import type { NetClass, NetRefs } from '../../../shared/engine/net/schema';
import type { FightViewCall } from '../../../shared/engine/sim/shardRows';
import { LedgerBook, type LedgerFiling } from './ledgerBook';
import { framesBetween, rowDue } from './tiers';
import type { NetChannel, Transport } from '../../../shared/engine/net/transport';

/** Sim steps per world frame: 60 Hz sim, 30 Hz frames (J40). */
export const TICKS_PER_FRAME = 2;
const SIM_HZ = 60, FRAME_HZ = 30;
/** The most words a ride may put on the wire. */
const RIDE_WORDS = 64;
/** Acts one client gets a tick, and the most it may have waiting. */
const ACTS_PER_TICK = 2, MAX_QUEUED_ACTS = 16;
/** How long an act waits for its command: J50's rewind cap. A press is judged where its player stood when they pressed, so it waits for the server to take that command, as a blow reads that tick's bodies; a client that never sends it gets the present. */
const ACT_WAIT_TICKS = 12;
/** Recalled rows a frame carries: a join beside a crowd of posed bodies spreads over frames. One body's rows are never split. */
const RECALL_ROWS = 256;
/** Past a hello's three full texts: no message is longer, so no bigger one is read. */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;
/**
 * Messages a client earns each tick, and the most it can hold. A phone at 120 Hz with an act or two stays well inside this,
 * and a burst after a stall spends what it saved. A message past it is refused unread, and each one is debt, so a client
 * flooding for seconds runs to `CLIENT_FLOOD_DEBT` and is dropped: the room's work for a client stays what the client earned.
 */
export const CLIENT_MESSAGES_PER_TICK = 8, MAX_CLIENT_MESSAGES = 240, CLIENT_FLOOD_DEBT = -3600;

/** The player a client owns. */
export interface NetPlayer { readonly id: string; readonly cls: NetClass<never>; sample: (out: Float64Array, refs: NetRefs) => void;
  /** The ride under this player as flat words, and how many. 0: on foot. */
  readonly ride?: (out: Float64Array) => number }
/** Hands the room each entity, with a view its class's accessors read. A view is valid only during the call. */
export interface NetVisitor { entity: <S>(id: string, cls: NetClass<S>, view: S) => void }
/** The world a room replicates. */
export interface NetWorld {
  /** Bind a welcomed seat to its persistent identity, including room handoffs. Dedicated hosts must verify the hello against their authenticated session. */
  identified?: (seat: string, identity: NetIdentity) => boolean;
  tick: () => number;
  /** The cell frame positions are local to (§3.5). */
  cell: () => number;
  /** Visit every replicated entity, the player included. */
  visit: (visitor: NetVisitor) => void;
  /** What the tick settled (P1-E3.2): each hit and death since the last call. A world with no fights leaves it out. */
  combat?: () => readonly CombatEvent[];
  /** A player's quests, when they moved past `since`. A world with no quests leaves it out. */
  quests?: (player: string, since: number) => { readonly version: number; readonly rows: readonly QuestProgress[]; readonly flags: readonly string[] } | null;
  /** What a player holds in this world, into `out`. A world with nothing held leaves it out. */
  owned?: (player: string, out: Map<string, number>) => void;
  /** What the tick granted (M8), each to its player. A world with no ledger leaves it out. */
  ledger?: () => readonly LedgerFiling[];
  /** Who rides what, by id, as of this tick (J48). A world with no riding leaves it out. */
  riders?: () => ReadonlyMap<string, string>;
  /** Hears who steps this tick, just before `step` (J125). A world whose players commands do not move leaves it out. */
  commanded?: (inputs: readonly NetTickInput[]) => void;
  /** Inputs the tick found no use for since the last call. A world that uses every input leaves it out. */
  refused?: () => number;
  /** What a client that arrives later has missed of a body (FLIP-6): values said once and remembered. A world with none leaves it out. */
  recall?: (id: string, out: FightViewCall[]) => void;
  /** The looks standing on screen now, which a client that arrives later must be told. A world with none leaves it out. */
  standing?: (out: FightViewCall[]) => void;
  /** The player a client owns unless it joins as another. */
  readonly player: NetPlayer;
}
/** One client's input for one tick: its turn, and its acts. */
export interface NetTickInput extends CommandTurn { readonly client: number; readonly player: string; readonly acts: readonly NetTickAct[] }
/** Bytes this room has put on the wire, for the bandwidth number (§7). */
export interface RoomStats { frames: number; frameBytes: number; eventBytes: number; refused: number; /** Rows a far tier left out (§3.3). */ tierSkips: number; /** Clients sent away for what they sent. */ dropped: number }
/** How a room is built. */
export interface NetRoomOptions {
  readonly world: NetWorld;
  /** Advance the world one fixed tick. */
  readonly step: (inputs: readonly NetTickInput[]) => void;
  /** This engine build's id; empty where builds are not stamped (tests, dev servers), which skips its check. */
  readonly build?: string;
  /** The players' receipts, where something outlives the room: a save, or rooms that share a player. */
  readonly book?: LedgerBook;
  /** Where reports of chat go. Absent, a report is checked and goes nowhere. */
  readonly reports?: ChatReports;
}

/** An act and the tick it stops waiting for its command. */
interface HeldAct { readonly act: NetTickAct; readonly until: number }
/** A view call as a line that compares equal when it says the same thing. */
const callLine = (call: FightViewCall): string => `${call.name}\0${call.args.join(',')}`;
/** What a client held at a frame. `due` are the rows this frame may send; `rows` is the world frame each held row came from. */
interface ClientView { tick: number; readonly visible: Set<number>; readonly due: Set<number>; readonly rows: Map<number, number> }
/** A settled event in handles, kept until the next frame. */
/** A frame covers two ticks of a fight's looks: of a look said twice only the last goes, named by its call and any slot it opens with. */
function freshViews(rows: readonly RoomCombat[]): readonly RoomCombat[] {
  const last = new Map<string, number>(), key = (view: NetView): string => { const [slot] = view.args; return slot !== undefined && Number.isInteger(slot) ? `${view.name}#${String(slot)}` : view.name; };
  for (const [index, row] of rows.entries()) if (row.kind === 'view') last.set(key(row), index);
  return last.size === 0 ? rows : rows.filter((row, index) => row.kind !== 'view' || last.get(key(row)) === index);
}
type RoomCombat = NetView | NetDied | NetPlayerDied | (NetHit & { readonly landedBy: string | null; readonly seen?: readonly [number, number, number] }) | (NetReward & { readonly owner: string });
interface RoomClient {
  readonly id: number; readonly transport: Transport; readonly queue: CommandQueue; readonly player: NetPlayer;
  /** Who it said it is at `hello` (J111). A hand-off keeps it. */
  identity: NetIdentity;
  /** Messages it may still send; below 0, what it owes. */
  credit: number;
  /** The last receipt it has had. */
  ledgerSeen: number;
  /** waiting: said hello before the room opened. live: welcomed. */
  state: 'new' | 'waiting' | 'live';
  /** Its command and act codecs, compiled from the tables its hello carried (5.3); absent before hello. */
  reader?: WireClientReader | undefined;
  ack: number; readonly acts: HeldAct[]; readonly known: Set<number>;
  /** Bodies this client has heard spawn and not yet been told what it missed of; each is sent a frame at a time. */
  readonly owed: number[];
  /** It has yet to be told the looks standing when it arrived. */
  newcomer: boolean;
  /** The looks it has heard live while bodies are still owed, so a recall doesn't repeat one. */
  readonly said: Set<string>;
  /** The quest rows this client holds, and the book version they came from. */
  questVersion: number; readonly quests: Map<string, string>; readonly phased: Set<string>;
  /** The lines of what its player holds that this client has been told. */
  readonly owned: Map<string, number>;
  /** Who it has heard riding what, in handles: what the next `mount` and `dismount` are a change from. */
  readonly rides: Map<number, number>;
  /** What this client could see at each recent frame: a baseline is the frame and this set. */
  readonly views: ClientView[]; nextView: number;
  readonly owner: Float64Array; dispose: () => void;
}


function rowPosition(frame: WorldFrame, at: number, cls: NetClass<never>): { x: number; y: number; z: number } | null {
  if (cls.position === null) return null;
  const read = (index: number): number => { const column = cls.row[index], value = column?.value(frame.data[at + index] ?? 0); return typeof value === 'number' ? value : 0; };
  return { x: read(cls.position[0]), y: read(cls.position[1]), z: read(cls.position[2]) };
}

/** The server's end of the wire. */
export class NetRoom {
  readonly stats: RoomStats = { frames: 0, frameBytes: 0, eventBytes: 0, refused: 0, tierSkips: 0, dropped: 0 };
  private readonly clients: RoomClient[] = [];
  private readonly handles = new NetHandles();
  private readonly ring = new WorldFrameRing();
  private readonly rideOut = new Float64Array(RIDE_WORDS);
  private readonly held = new Map<string, number>();
  private readonly calls: FightViewCall[] = [];
  private readonly world: NetWorld;
  private readonly step: NetRoomOptions['step'];
  private readonly build: string;
  private readonly inputs: NetTickInput[] = [];
  private readonly combat: RoomCombat[] = [];
  private readonly book: LedgerBook;
  private readonly chat: RoomChat;
  private opened = false;
  private serial = 0;
  private clientIds = 0;
  constructor(options: NetRoomOptions) { installPortableMath(); this.world = options.world; this.step = options.step; this.build = options.build ?? ''; this.book = options.book ?? new LedgerBook(); this.chat = new RoomChat(options.reports); }
  /** Who a client said it is, its Name cleaned. */
  identityOf(client: number): NetIdentity | null { return this.clients.find(entry => entry.id === client)?.identity ?? null; }
  /** The last command `seq` applied for a client, or 0. */
  lastSeq(client: number): number { return this.clients.find(entry => entry.id === client)?.queue.lastSeq ?? 0; }
  /** Commands refused and duplicated across every client. */
  get admission(): { refused: number; duplicates: number } {
    return this.clients.reduce((sum, client) => ({ refused: sum.refused + client.queue.refused, duplicates: sum.duplicates + client.queue.duplicates }), { refused: 0, duplicates: 0 });
  }
  /** Connect a client that owns `player`. It waits for its `hello`, and past that for `open`. Returns its id. */
  join(transport: Transport, player: NetPlayer = this.world.player, queue: CommandQueue = new CommandQueue()): number {
    const id = ++this.clientIds, owner = new Float64Array(player.cls.owner.length);
    const client: RoomClient = { id, transport, player, queue, identity: GUEST, credit: MAX_CLIENT_MESSAGES, ledgerSeen: 0, state: 'new', ack: -1, acts: [], known: new Set(), owed: [], newcomer: true, said: new Set(), questVersion: -1, quests: new Map(), phased: new Set(), owned: new Map(), rides: new Map(), owner,
      views: Array.from({ length: FRAME_RING }, () => ({ tick: -1, visible: new Set<number>(), due: new Set<number>(), rows: new Map<number, number>() })), nextView: 0, dispose: () => undefined };
    const off = transport.onMessage((channel, bytes) => { this.receive(client, channel, bytes); });
    const closed = transport.onClose(() => { this.remove(client); });
    client.dispose = () => { off(); closed(); };
    this.clients.push(client);
    return id;
  }
  /**
   * A player crossed (P1-E3.9): their client leaves this world for the room of the one they stand in, on the same link and
   * with the same command stream. It hears `travel`, then the new room's `welcome`, then a full frame at that room's next.
   * Null: nobody follows them. Their client left, or never said hello, and any link it still has is closed: a player's
   * feet can cross with no one holding them, and that may not end either room.
   */
  handOff(id: number, to: NetRoom, player: NetPlayer): number | null {
    const client = this.clients.find(entry => entry.id === id);
    if (client === undefined) return null;
    if (client.state !== 'live' || !to.opened) { this.drop(client); return null; }
    const tick = this.world.tick(), travel: NetEvent = { kind: 'travel', tick, from: this.world.cell(), to: to.world.cell() };
    client.transport.send('reliable', eventsMessage(tick, [travel]).buffer);
    this.remove(client);
    return to.adopt(client.transport, player, client.queue, { identity: client.identity, reader: client.reader });
  }
  private adopt(transport: Transport, player: NetPlayer, queue: CommandQueue, said: { readonly identity: NetIdentity; readonly reader: WireClientReader | undefined }): number | null {
    const id = this.join(transport, player, queue), client = this.clients.find(entry => entry.id === id), { identity } = said;
    if (client !== undefined) {
      if (this.world.identified?.(player.id, identity) === false) { this.stats.refused++; this.drop(client); return null; }
      // Its hello's tables come with it: the same socket, the same client build (5.3).
      client.identity = identity; client.reader = said.reader; this.welcome(client);
    } // it said hello to the room it came from
    return id;
  }
  /** The client finished loading (§6.3.1): welcome everyone waiting and send each its full frame. */
  open(): void {
    this.opened = true;
    const waiting = this.clients.filter(client => client.state === 'waiting');
    for (const client of waiting) this.welcome(client);
    if (waiting.length > 0) this.snapshot(this.world.tick());
  }
  /** One fixed tick: each client's turn, the world's step, and on every second tick a frame. */
  tick(): void {
    this.inputs.length = 0;
    for (const client of this.clients) {
      client.credit = Math.min(client.credit + CLIENT_MESSAGES_PER_TICK, MAX_CLIENT_MESSAGES);
      if (client.state !== 'live') continue;
      const turn = client.queue.next();
      this.inputs.push({ client: client.id, player: client.player.id, ...turn, acts: this.dueActs(client) });
    }
    this.world.commanded?.(this.inputs);
    this.step(this.inputs);
    this.stats.refused += this.world.refused?.() ?? 0;
    this.settled();
    for (const filing of this.world.ledger?.() ?? []) this.book.file(filing);
    const tick = this.world.tick();
    if (tick % TICKS_PER_FRAME === 0) this.snapshot(tick);
  }
  /** A client's acts this tick, in the order it sent them: those whose command the server has taken, or that have waited long enough. */
  private dueActs(client: RoomClient): readonly NetTickAct[] {
    const { acts, queue } = client, now = this.world.tick(), due: NetTickAct[] = [];
    while (due.length < ACTS_PER_TICK) {
      const held = acts[0];
      if (held === undefined || (seqAfter(held.act.seq, queue.lastSeq) && now < held.until)) break;
      acts.shift(); due.push(held.act);
    }
    return due;
  }
  /** Turn the tick's settled combat into handles now: a body retired by the next frame still gets its death. */
  private settled(): void {
    for (const row of this.world.combat?.() ?? []) {
      const { refs } = this.handles;
      if (row.kind === 'view') { this.combat.push(row); continue; }
      if (row.kind === 'reward') { const { player, ...reward } = row; this.combat.push({ ...reward, body: refs(row.body), owner: player }); continue; }
      if (row.kind === 'player-died') { const id = refs(row.id); if (id !== 0) this.combat.push({ ...row, id }); continue; }
      if (row.kind === 'hit') { const target = refs(row.target); if (target !== 0) { const { by, seq, ...hit } = row; this.combat.push({ ...hit, target, confirmFor: seq, landedBy: by }); } }
      else { const id = refs(row.id); if (id !== 0) this.combat.push({ ...row, id, by: row.by === null ? 0 : refs(row.by) }); }
    }
  }
  /** Drop every client. */
  dispose(): void { for (const client of this.clients.slice()) this.remove(client); }

  private remove(client: RoomClient): void {
    client.dispose();
    const at = this.clients.indexOf(client);
    if (at !== -1) this.clients.splice(at, 1);
  }
  /** Send a client away. The room goes on; a bad client may be dropped, and the room may not. */
  private drop(client: RoomClient): void {
    this.stats.dropped++;
    client.transport.close('refused');
    this.remove(client);
  }
  /** The trust boundary: every byte a client sends arrives here, and nothing it sends gets past this as an exception. */
  private receive(client: RoomClient, _channel: NetChannel, bytes: ArrayBuffer): void {
    client.credit--;
    if (client.credit < 0 || bytes.byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      this.stats.refused++;
      if (client.credit <= CLIENT_FLOOD_DEBT) this.drop(client);
      return;
    }
    const view = new Uint8Array(bytes);
    try {
      // A client's first message is the bootstrap and its hello (5.1); every later one is plain records.
      if (client.state === 'new') { this.hello(client, view); return; }
      const records = this.records(view);
      if (records === null) { this.stats.refused++; return; }
      for (const record of records) {
        const span = { bytes: view, start: record.start, end: record.end };
        if (record.tag === TAG_CMDS) this.commands(client, span);
        else if (record.tag === TAG_ACT) this.act(client, span);
        else this.stats.refused++;
      }
    } catch (error) {
      console.error('A client message threw past its decoder; dropping the client', error);
      this.stats.refused++;
      this.drop(client);
    }
  }
  /** A message's records, or null when its framing is malformed (a duplicate singleton included). */
  private records(view: Uint8Array): ReturnType<typeof readMessage>['records'] | null {
    try { return readMessage(view).records; } catch (error) { if (error instanceof Error && error.name === 'WireDecodeError') return null; throw error; }
  }
  private hello(client: RoomClient, view: Uint8Array): void {
    // WR5 (5.5, J54 replaced): a v0.1.x hello or an older major reloads; a newer major retries; within the major, the
    // minor window is one either way. Builds no longer have to match: each side's tables say its layout.
    const first = decodeFirstMessage(view);
    if (first.kind !== 'hello') { this.stats.refused++; client.transport.close(first.kind === 'refuse' ? 'refused' : first.kind); return; }
    const { hello } = first;
    if (hello.minor > WIRE_MINOR + 1) { this.stats.refused++; client.transport.close('retry'); return; }
    if (hello.minor < WIRE_MINOR - 1) { this.stats.refused++; client.transport.close('reload'); return; }
    const said = v.safeParse(NetIdentitySchema, { player: hello.player, name: hello.name });
    if (!said.success) { this.stats.refused++; client.transport.close('refused'); return; }
    const identity = { player: said.output.player, name: cleanName(said.output.name) };
    if (this.world.identified?.(client.player.id, identity) === false) { this.stats.refused++; this.drop(client); return; }
    client.identity = identity;
    client.ledgerSeen = hello.ledger;
    client.reader = new WireClientReader(hello);
    client.state = 'waiting';
    if (this.opened) this.welcome(client);
  }
  /** A cmds record; one a client's tables can't read, or that names an unknown handle, is refused like v0's. */
  private commands(client: RoomClient, span: Span): void {
    const { reader } = client;
    let bundle: ReturnType<WireClientReader['commandsOf']> | null = null;
    if (client.state === 'live' && reader !== undefined) try { bundle = reader.commandsOf(span, this.handles.idOf); } catch (error) { if (!(error instanceof RangeError) && !(error instanceof Error && error.name === 'WireDecodeError')) throw error; }
    if (bundle === null) { this.stats.refused++; return; }
    if (bundle.ackFrame > this.world.tick()) this.stats.refused++; // a frame that never was: its commands may still stand
    else if (bundle.ackFrame > client.ack) client.ack = bundle.ackFrame;
    client.queue.admit(bundle.commands);
  }
  private act(client: RoomClient, span: Span): void {
    let decoded: unknown = null;
    try { decoded = client.reader?.actOf(span) ?? null; } catch (error) { if (!(error instanceof Error && error.name === 'WireDecodeError')) throw error; }
    const parsed = v.safeParse(NetRoomActSchema, decoded);
    if (!parsed.success || client.state !== 'live') { this.stats.refused++; return; }
    const act = parsed.output;
    if (act.kind === 'chat' || act.kind === 'report') { if (!this.chatAct(client, act)) this.stats.refused++; return; }
    // Untrusted input stays bounded (R3): a flood of acts waits its turn or is refused, and can never exceed a tick's allowance.
    if (client.acts.length >= MAX_QUEUED_ACTS) { this.stats.refused++; return; }
    client.acts.push({ act, until: this.world.tick() + ACT_WAIT_TICKS });
  }
  private chatAct(client: RoomClient, act: NetChatSay | NetChatReport): boolean {
    if (act.kind === 'report') return this.chat.report(client.identity.player, act.line, this.world.tick());
    return this.chat.say({ ...client.identity, body: client.player.id }, act.channel, act.text, this.world.tick());
  }
  /** Whether `client` hears a line: anyone in the room, or within earshot of who said it. */
  private hears(frame: WorldFrame, own: number, line: ChatLine, from: number): boolean {
    if (line.channel === 'room' || from === own) return true;
    const place = (handle: number): { x: number; y: number; z: number } | null => {
      const cls = this.handles.row(handle)?.cls, at = frame.offset(handle);
      return cls === undefined || at === undefined ? null : rowPosition(frame, at, cls);
    };
    const here = place(own), there = place(from);
    return here !== null && there !== null && (here.x - there.x) ** 2 + (here.y - there.y) ** 2 + (here.z - there.z) ** 2 <= CHAT_RADIUS ** 2;
  }
  private welcome(client: RoomClient): void {
    client.state = 'live';
    // Handles are handed out by frames, and the welcome comes first: without this a first client's own handle reads 0.
    const { handles } = this, serial = ++this.serial;
    this.world.visit({ entity: (id, cls, view) => { handles.touch(id, cls, view, serial); } });
    const handle = handles.refs(client.player.id);
    client.transport.send('reliable', welcomeMessage({ handle, player: client.player.id, tick: this.world.tick(), cell: this.world.cell(), simHz: SIM_HZ, frameHz: FRAME_HZ }, this.build).buffer);
  }
  private snapshot(tick: number): void {
    const frame = this.ring.claim(tick), serial = ++this.serial, { handles } = this;
    this.world.visit({ entity: (id, cls, view) => {
      const row = handles.touch(id, cls, view, serial), at = frame.claim(row.handle, cls.row.length);
      cls.row.forEach((column, index) => { frame.data[at + index] = column.sample(view, handles.refs); });
    } });
    const retired = handles.sweep(serial), combat = freshViews(this.combat.splice(0)), lines = this.chat.drain(), riders = new Map<number, number>();
    for (const [rider, mount] of this.world.riders?.() ?? []) riders.set(handles.refs(rider), handles.refs(mount));
    // On a copy: a send may close a client that has stalled (E7.1), and the next in line must not lose this frame's events for it.
    for (const client of this.clients.slice()) if (client.state === 'live') this.send(client, frame, retired, combat, lines, riders);
  }
  /** Every entity in range of this client, itself excluded: its own state is the owner block. */
  private view(client: RoomClient, frame: WorldFrame, own: number): ClientView {
    const view = client.views[client.nextView];
    if (view === undefined) throw new Error('Empty client view ring');
    client.nextView = (client.nextView + 1) % FRAME_RING;
    view.tick = frame.tick; view.visible.clear(); view.due.clear();
    const ownClass = this.handles.row(own)?.cls, ownAt = frame.offset(own);
    const origin = ownClass === undefined || ownAt === undefined ? null : rowPosition(frame, ownAt, ownClass);
    for (const handle of frame.handles()) {
      const cls = this.handles.row(handle)?.cls, at = frame.offset(handle);
      if (handle === own || cls === undefined || at === undefined) continue;
      const position = origin === null ? null : rowPosition(frame, at, cls);
      const away = position === null || origin === null ? 0 : (position.x - origin.x) ** 2 + (position.y - origin.y) ** 2 + (position.z - origin.z) ** 2;
      if (cls.radius !== null && away > cls.radius ** 2) continue;
      view.visible.add(handle);
      if (rowDue(Math.floor(frame.tick / TICKS_PER_FRAME), handle, framesBetween(away))) view.due.add(handle);
    }
    return view;
  }
  /**
   * Which world frame each row this client ends up holding came from. A row left out stays what its baseline had, so the
   * next delta must start there and not at the baseline's own tick. A row whose source is about to leave the ring is sent whole.
   */
  private heldRows(view: ClientView, frame: WorldFrame, seen: ClientView | null): void {
    view.rows.clear();
    for (const handle of view.visible) {
      const from = view.due.has(handle) ? undefined : seen?.rows.get(handle);
      const kept = from !== undefined && frame.tick - from < (FRAME_RING - 2) * TICKS_PER_FRAME;
      view.rows.set(handle, kept ? from : frame.tick);
      if (kept) this.stats.tierSkips++;
    }
  }
  /** A client hears every ride it can see start and end, its own first: a new client hears who already rides by the same diff. */
  private rideEvents(client: RoomClient, own: number, riders: ReadonlyMap<number, number>, tick: number, events: NetEvent[]): void {
    const { rides } = client, seq = client.queue.lastSeq, said = (kind: 'mount' | 'dismount', rider: number, mount: number): void => { events.push({ kind, tick, rider, mount, seq: rider === own ? seq : 0 }); };
    for (const [rider, mount] of rides) if (riders.get(rider) !== mount) { rides.delete(rider); said('dismount', rider, mount); }
    for (const [rider, mount] of riders) {
      if (rides.has(rider) || (rider !== own && !client.known.has(rider))) continue;
      rides.set(rider, mount); said('mount', rider, mount);
    }
  }
  /** A client hears what its player holds, line by line as each changes, and all of it on arriving in a world. */
  private ownedEvents(client: RoomClient, tick: number, events: NetEvent[]): void {
    const { held } = this;
    held.clear();
    this.world.owned?.(client.player.id, held);
    for (const [name, value] of held) if (client.owned.get(name) !== value) { client.owned.set(name, value); events.push({ kind: 'owned', tick, name, value }); }
    for (const name of client.owned.keys()) if (!held.has(name)) { client.owned.delete(name); events.push({ kind: 'owned', tick, name, value: 0 }); }
  }
  /** What this client arrived too late to hear: to it alone, right after the spawns, so `combat`'s fresher rows land on top. What it has heard meanwhile goes once. */
  private recalled(client: RoomClient, tick: number, combat: readonly RoomCombat[], events: NetEvent[]): void {
    const { calls } = this, { owed, said } = client;
    if (!client.newcomer && owed.length === 0) return;
    for (const row of combat) if (row.kind === 'view') said.add(callLine(row));
    calls.length = 0;
    if (client.newcomer) { client.newcomer = false; this.world.standing?.(calls); }
    while (owed.length > 0 && calls.length < RECALL_ROWS) {
      const id = this.handles.row(owed.shift() ?? 0)?.id;
      if (id !== undefined) this.world.recall?.(id, calls);
    }
    for (const call of calls) if (!said.has(callLine(call))) events.push({ kind: 'view', tick, name: call.name, args: call.args });
    if (owed.length === 0) said.clear();
  }
  private send(client: RoomClient, frame: WorldFrame, retired: readonly number[], combat: readonly RoomCombat[], lines: readonly ChatLine[], riders: ReadonlyMap<number, number>): void {
    const { handles, world } = this, own = handles.refs(client.player.id), view = this.view(client, frame, own), events: NetEvent[] = [];
    for (const handle of view.visible) {
      if (client.known.has(handle)) continue;
      const row = handles.row(handle);
      if (row === undefined) continue;
      client.known.add(handle); client.owed.push(handle);
      events.push({ kind: 'spawn', handle, cls: row.cls.id, id: row.id, initial: row.initial, text: row.text });
    }
    this.recalled(client, frame.tick, combat, events);
    this.rideEvents(client, own, riders, frame.tick, events);
    // Spawns, then what happened, then who left: a body's last hit and its death arrive before its despawn.
    for (const row of combat) {
      if (row.kind === 'view') { events.push(row); continue; }
      if (row.kind === 'reward') { if (row.owner === client.player.id) { const { owner: _owner, ...reward } = row; events.push(reward); } continue; }
      if (row.kind === 'died') { if (row.id === own || client.known.has(row.id)) events.push(row); continue; }
      if (row.kind === 'player-died') { if (row.id === own) events.push(row); continue; }
      const { landedBy, seen, ...hit } = row, owned = landedBy === client.player.id;
      if (row.target !== own && !owned && !client.known.has(row.target)) continue;
      // the shooter's spark goes where it saw the body, everyone else's where the body is (J47, J50)
      events.push({ ...hit, at: owned ? seen ?? hit.at : hit.at, confirmFor: owned ? hit.confirmFor : 0 });
    }
    const quests = world.quests?.(client.player.id, client.questVersion) ?? null;
    if (quests !== null) {
      client.questVersion = quests.version;
      for (const row of quests.rows) {
        const seen = `${String(row.started)}|${String(row.n)}|${row.step ?? ''}`;
        if (client.quests.get(row.quest) === seen) continue;
        client.quests.set(row.quest, seen); events.push({ kind: 'quest', tick: frame.tick, ...row });
      }
      for (const flag of client.phased) if (!quests.flags.includes(flag)) { client.phased.delete(flag); events.push({ kind: 'phase', tick: frame.tick, flag, on: false }); }
      for (const flag of quests.flags) if (!client.phased.has(flag)) { client.phased.add(flag); events.push({ kind: 'phase', tick: frame.tick, flag, on: true }); }
    }
    this.ownedEvents(client, frame.tick, events);
    for (const line of lines) {
      const from = handles.refs(line.body);
      if (!this.hears(frame, own, line, from)) continue;
      events.push({ kind: 'chat', tick: line.tick, line: line.line, channel: line.channel, from: client.known.has(from) || from === own ? from : 0, name: line.name, text: line.text });
    }
    for (const receipt of this.book.since(client.player.id, client.ledgerSeen)) { events.push({ ...receipt, tick: frame.tick }); client.ledgerSeen = receipt.serial; }
    for (const handle of retired) if (client.known.delete(handle)) events.push({ kind: 'despawn', handle });
    if (events.length > 0) {
      const bytes = eventsMessage(frame.tick, events).buffer;
      this.stats.eventBytes += bytes.byteLength;
      client.transport.send('reliable', bytes);
    }
    const acked = client.ack < 0 ? null : this.ring.at(client.ack), seen = client.views.find(entry => entry.tick === client.ack);
    const base = acked === frame || seen === undefined ? null : acked;
    this.heldRows(view, frame, base === null ? null : seen ?? null);
    client.player.sample(client.owner, handles.refs);
    const { rideOut } = this, rideWords = client.player.ride?.(rideOut) ?? 0;
    const bytes = encodeFrame(snapshotOf({ frame, cell: world.cell(), lastSeq: client.queue.lastSeq, ownerClass: client.player.cls, owner: client.owner, ride: rideOut, rideWords,
      visible: view.visible, baseline: base === null || seen === undefined ? null : { frame: base, visible: seen.visible, rowFrom: handle => this.ring.at(seen.rows.get(handle) ?? -1) },
      due: handle => view.rows.get(handle) === frame.tick, classOf: handle => handles.row(handle)?.cls })).buffer;
    this.stats.frames++; this.stats.frameBytes += bytes.byteLength;
    client.transport.send('unreliable', bytes);
  }
}

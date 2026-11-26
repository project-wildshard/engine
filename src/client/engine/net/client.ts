import { bootMark } from '../../../shared/engine/boot/timing';
// P1-E5.2 (E5-REPLICATION §4): the client's end of the game protocol. It says hello, decodes frames and events, acks, and
// sends commands in bundles with redundant copies. Prediction and interpolation build on this in E5.3; the view halves
// read its rows in E4.3. It knows nothing of how bytes travel, and imports nothing from the server.
import { installPortableMath } from '../../../shared/engine/core/portableMath';
import type { QuestProgress } from '../../../shared/engine/quest/progress';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { ChatChannel, NetRoomAct } from '../../../shared/engine/net/acts';
import type { NetChat } from '../../../shared/engine/net/chatWire';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { fitText, MAX_NET_TEXT_BYTES } from '../../../shared/engine/net/bits';
import { seqAfter } from '../../../shared/engine/net/command';
import { GUEST, type NetIdentity } from '../../../shared/engine/net/identity';
import type { NetLedger } from '../../../shared/engine/net/ledgerWire';
import { FRAME_RING, NO_BASELINE, type DecodedFrame } from '../../../shared/engine/net/frame';
import { TAG_FRAME } from '@wildshard/wire/frameRecord';
import { readMessage, TAG_EVENTS } from '@wildshard/wire/game';
import { decodeWelcome } from '@wildshard/wire/handshake';
import { WireFrameReader } from '../../../shared/engine/net/wireFrames';
import { actMessage, commandsMessage, eventsReader, helloMessage, type Span } from '../../../shared/engine/net/wireMessages';
import type { NetEvent, NetFlight, NetView, NetCombatEvent, NetPlayerDied, NetRide, NetTravel, NetWelcome } from '../../../shared/engine/net/messages';
import { ANIMAL_CLASS, FLAG_CLASS, netClassOf, PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import { FLAG_PREFIX, STATE_PREFIX } from '../../../shared/engine/net/shardNet';
import type { NetClass, NetValue } from '../../../shared/engine/net/schema';
import type { Transport } from '../../../shared/engine/net/transport';
import type { NetCorrection } from '../../../shared/engine/net/measurements';
import { Interpolator } from './interpolator';
import { NetClock } from './netClock';
import { NetDelivery } from './onRep';

/** Older commands repeated in each bundle, against loss (§4.2). */
export const REDUNDANT_COMMANDS = 4;

/** What the client knows of an entity from its spawn. */
export interface NetEntityInfo { readonly handle: number; readonly id: string; readonly cls: NetClass<never>; readonly initial: Readonly<Record<string, NetValue>> }
/** A row with its quantised values turned back into field values. */
export type NetFields = Readonly<Record<string, NetValue>>;

/** The welcome's record tag (5.1). */
const TAG_WELCOME = 4;

function decodeColumns(columns: NetClass<never>['row'], values: ArrayLike<number>): Record<string, NetValue> {
  const out: Record<string, NetValue> = {};
  columns.forEach((column, index) => { out[column.name] = column.value(values[index] ?? 0); });
  return out;
}

/** The client's end of the wire. */
/** FM4: the acts a player taps, by the word their hold card echoes. Chat holds itself (chatLines.ts); reports, poses and climate are never
 *  a tap that waits on the world. */
const GATED_ACTS: Partial<Record<NetRoomAct['kind'], string>> = { interact: 'Interact', reload: 'Reload', equip: 'Equip', ride: 'Ride', wear: 'Wear', board: 'Board', buy: 'Buy' };
export class NetClient {
  /** The server's welcome, once it arrives. */
  welcome: NetWelcome | null = null;
  /** The newest frame decoded. */
  latest: DecodedFrame | null = null;
  /** Why the connection ended, or null while it is open. `reload` means a stale build was refused (J54). */
  closed: string | null = null;
  /** Frames refused as malformed or not applicable yet. */
  dropped = 0;
  private readonly entityRows = new Map<number, NetEntityInfo>();
  readonly entities: ReadonlyMap<number, NetEntityInfo> = this.entityRows;
  private roster: { readonly creatures: ReadonlyMap<number, NetEntityInfo>; readonly flags: ReadonlySet<string> } | undefined;
  /** Where the server is now, and how far behind it rows are drawn (P1-E5.3-F3). */
  readonly clock: NetClock = new NetClock();
  /** Every row but this client's own character, buffered to be drawn in the past (P1-E5.3-F2). */
  readonly interpolator: Interpolator = new Interpolator(handle => this.entities.get(handle)?.cls);
  /** Events and field changes, when the screen reaches them (P1-E5.3-F4). Step it with `present`. */
  readonly delivery: NetDelivery = new NetDelivery(this.interpolator, handle => this.entities.get(handle)?.cls.cls);
  private readonly now: () => number;
  private transport: Transport;
  private readonly frames = new Map<number, DecodedFrame>();
  private readonly listeners = new Set<(frame: DecodedFrame, spacingErrorMs?: number | null) => void>();
  private readonly presented = new Set<() => void>();
  private readonly corrected = new Set<(row: Omit<NetCorrection,'kind'|'session'>) => void>();
  private readonly fights = new Set<(event: NetCombatEvent) => void>();
  private readonly deaths = new Set<(event: NetPlayerDied) => void>();
  private deathTick = -1;
  private readonly fightViews = new Set<(view: NetView) => void>();
  private readonly flights = new Set<(flight: NetFlight) => void>();
  private readonly travels = new Set<(event: NetTravel) => void>();
  private readonly rides = new Set<(event: NetRide) => void>();
  /** The last ledger serial this client has: pass it to `hello` when it comes back, and it hears only what it missed. */
  ledgerSerial = 0;
  private readonly receipts = new Set<(receipt: NetLedger) => void>();
  private readonly lines = new Set<(line: NetChat) => void>();
  private readonly granted = new Set<string>();
  /** This client's own player's quests, newest row each (P1-E3.3): what a QuestReplica reads. */
  readonly quests: Map<string, QuestProgress> = new Map<string, QuestProgress>();
  /** What this client's own player holds in this world, by line. A row that went to 0 is gone. */
  readonly owned: Map<string, number> = new Map<string, number>();
  /** Moves each time a line of `owned` does. */
  ownedVersion = 0;
  /** Who rides what, in handles, as far as this client has heard (J48). */
  readonly riders: Map<number, number> = new Map<number, number>();
  /** The flags up in this client's own world (J106): what its view of a gate or a key reads. */
  readonly phased: Set<string> = new Set<string>();
  /** The server's layout, from its welcome's tables (5.3): frames and spawns project through it. */
  private server: WireFrameReader | null = null;
  private serverEvents: ((span: Span) => { readonly events: readonly NetEvent[] }) | null = null;
  /** Every spawned handle's class by the server's class id, known to this build or not: frames decode by it (5.4). */
  private readonly senderClasses = new Map<number, number>();
  private tableHash = -1;
  private readonly ids = new Map<string, number>();
  /** STR20: the shared state rows' handles by their declared name (the id less `STATE_PREFIX`), so a read builds no key */
  private readonly stateIds = new Map<string, number>();
  private unacked: NetCommand[] = [];
  private fresh = 0;
  private seq = 0;
  /** The last `lastSeq` this client trimmed by: an ack only ever moves on from it, and never past `seq`. */
  private ackedSeq: number | null = null;
  private off: (() => void)[];
  private said: { readonly build: string; readonly identity: NetIdentity } = { build: '', identity: GUEST };
  private readonly rejoins = new Set<() => void>();
  /** FM4 (meta MMO-FAILURE-MODES-PLAN): asked before a tap the world must hear goes out. False holds it: the online page's hold card
   *  says why, and the tap is dropped, never sent late. Null (the default, and every bot) lets everything through. */
  private gate: ((what: string) => boolean) | null = null;
  constructor(transport: Transport, now: () => number = diagnosticNow) {
    installPortableMath();
    this.transport = transport; this.now = now;
    this.off = this.listen(transport);
  }
  /** CHUNK-PARAM CP5 (J522): what a link says before its hello (the page's `goto` word, `gotoFirst`), then sends it; null: at once. */
  private helloFirst: ((transport: Transport, hello: () => void) => void) | null = null;
  /** CP5: every hello, the first and each redial's, goes through `first`. */
  sayFirst(first: ((transport: Transport, hello: () => void) => void) | null): void { this.helloFirst = first; }
  /** Begin the handshake. `build` is this client's engine build id; `identity` is who it says it is (J111). */
  hello(build = '', identity: NetIdentity = GUEST, ledger = 0): void {
    this.ledgerSerial = ledger; this.said = { build, identity };
    const transport = this.transport;
    const send = (): void => { if (this.transport === transport) transport.send('reliable', helloMessage({ build, player: identity.player, name: identity.name, ledger }).buffer); };
    if (this.helloFirst === null) send(); else this.helloFirst(transport, send);
  }
  /**
   * The link died and `transport` is its replacement (E7.1, C2): a fresh `hello` on it. What was held named the old link, so it
   * goes as a crossing's does, and what this client has heard of the ledger stays, so no receipt comes twice. A server always
   * gives a new link a new command queue, so `seq` starts over: an old `seq` read against a new queue's 0 may look acked.
   */
  rejoin(transport: Transport): void {
    for (const off of this.off) off();
    const { ledgerSerial, said } = this;
    this.left();
    this.unacked = []; this.fresh = 0; this.seq = 0; this.ackedSeq = null; this.closed = null;
    this.transport = transport; this.off = this.listen(transport);
    for (const listener of this.rejoins) listener();
    this.hello(said.build, said.identity, ledgerSerial);
  }
  /** ZONE-ENTRY ZE10d2: what this client holds named the cell it is leaving by a gate, and the next frames do too (the road's,
   *  while the page loads the cell): it drops them until the cell's welcome. */
  hold(cell?: number): void { this.left(); this.holding = true; this.heldFor = cell; }
  /** ZE10d2: the entry was called off: frames decode again (the next welcome, or the road's own, places them). */
  unhold(): void { this.holding = false; this.heldFor = undefined; }
  private holding = false;
  /** the frame number of the cell a hold waits for (undefined: any welcome ends it) */
  private heldFor: number | undefined;
  private readonly heldFrames = new Set<() => void>();
  private readonly heldElsewhere = new Set<(cell: number) => void>();
  /** ZE10d2: a hold ended on a welcome from another cell than the one it waited for (a redial the door thawed back onto the road). */
  onHeldElsewhere(listener: (cell: number) => void): () => void { this.heldElsewhere.add(listener); return () => { this.heldElsewhere.delete(listener); }; }
  /** ZE10d2: a frame arrived while held: the link is alive though nothing is decoded (the redial's watch hears it); returns the unsubscribe. */
  onHeldFrame(listener: () => void): () => void { this.heldFrames.add(listener); return () => { this.heldFrames.delete(listener); }; }
  /** Call when a new link replaces the old one, before its `hello`; returns the unsubscribe. */
  onRejoin(listener: () => void): () => void { this.rejoins.add(listener); return () => { this.rejoins.delete(listener); }; }
  /** Subscribe to decoded frames. Each new tick after the first includes its receipt spacing error. */
  onFrame(listener: (frame: DecodedFrame, spacingErrorMs?: number | null) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** E7.8a observes actual presentation calls and actual prediction corrections. */
  onRender(listener:()=>void):()=>void{this.presented.add(listener);return()=>{this.presented.delete(listener);};}
  rendered():void{for(const listener of this.presented)listener();}
  onCorrection(listener:(row:Omit<NetCorrection,'kind'|'session'>)=>void):()=>void{this.corrected.add(listener);return()=>{this.corrected.delete(listener);};}
  correction(row:Omit<NetCorrection,'kind'|'session'>):void{for(const listener of this.corrected)listener(row);}
  get stats():Transport['stats']{return this.transport.stats;}
  /** Call for every look a fight tells its views; returns the unsubscribe. */
  onView(listener: (view: NetView) => void): () => void { this.fightViews.add(listener); return () => { this.fightViews.delete(listener); }; }
  /** ONE-FORMAT CC18c: a creature's strike launched a projectile this client can see the creature of. */
  onFlight(listener: (flight: NetFlight) => void): () => void { this.flights.add(listener); return () => { this.flights.delete(listener); }; }
  /** Call for every settled hit and death (P1-E3.2); returns the unsubscribe. */
  onCombat(listener: (event: NetCombatEvent) => void): () => void { this.fights.add(listener); return () => { this.fights.delete(listener); }; }
  /** Own-player health death once per tick, at receipt before an owner frame can move the page. */
  onPlayerDied(listener: (event: NetPlayerDied) => void): () => void { this.deaths.add(listener); return () => { this.deaths.delete(listener); }; }
  /** Call when anyone it can see gets on or off a ride; returns the unsubscribe. */
  onRide(listener: (event: NetRide) => void): () => void { this.rides.add(listener); return () => { this.rides.delete(listener); }; }
  /** Call when this client's player crosses, before the new cell's `welcome`; returns the unsubscribe. */
  onTravel(listener: (event: NetTravel) => void): () => void { this.travels.add(listener); return () => { this.travels.delete(listener); }; }
  /** Call for every line of chat this client hears, its own included, as others read it; returns the unsubscribe. */
  onChat(listener: (line: NetChat) => void): () => void { this.lines.add(listener); return () => { this.lines.delete(listener); }; }
  /** Say a line (J110). The server cleans, filters and may refuse it; hearing it back is the proof it went out. */
  say(channel: ChatChannel, text: string): void { this.act({ kind: 'chat', seq: this.seq, channel, text: fitText(text, MAX_NET_TEXT_BYTES) }); }
  /** Report a line this client heard. */
  report(line: number): void { this.act({ kind: 'report', seq: this.seq, line }); }
  /** Call once for every ledger receipt, however often the wire repeats it (M8); returns the unsubscribe. */
  onLedger(listener: (receipt: NetLedger) => void): () => void { this.receipts.add(listener); return () => { this.receipts.delete(listener); }; }
  /** A held frame by tick. */
  frame(tick: number): DecodedFrame | null { return this.frames.get(tick) ?? null; }
  /** An entity's handle by its id, while the wire holds it. */
  handle(id: string): number | undefined { return this.ids.get(id); }
  /** One entity's row in a frame, as field values. */
  fields(frame: DecodedFrame, handle: number): NetFields | null {
    const row = frame.rows.get(handle), cls = this.entities.get(handle)?.cls;
    return row === undefined || cls === undefined ? null : decodeColumns(cls.row, row);
  }
  /** One field of an entity's row in a frame, decoded in place: no row object. STR20: what a per-frame reader of one or two
   *  fields asks (the creature census once a server frame per creature, a mover's pose). @frame */
  field(frame: DecodedFrame, handle: number, name: string): NetValue | undefined {
    const row = frame.rows.get(handle), cls = this.entities.get(handle)?.cls;
    if (row === undefined || cls === undefined) return undefined;
    const columns = cls.row;
    for (let k = 0; k < columns.length; k++) { const column = columns[k]; if (column?.name === name) return column.value(row[k] ?? 0); }
    return undefined;
  }
  /** The reliable roster changes on spawn, despawn or travel, independently of frame delivery. */
  private entityRoster(): NonNullable<NetClient['roster']> {
    if (this.roster === undefined) {
      const creatures = new Map<number, NetEntityInfo>(), flags = new Set<string>();
      for (const entity of this.entityRows.values()) {
        if (entity.cls === ANIMAL_CLASS) creatures.set(entity.handle, entity);
        else if (entity.cls === FLAG_CLASS) flags.add(entity.id.slice(FLAG_PREFIX.length));
      }
      this.roster = { creatures, flags };
    }
    return this.roster;
  }
  /** The creature rows in reliable spawn order. */
  get creatures(): ReadonlyMap<number, NetEntityInfo> { return this.entityRoster().creatures; }
  /** The flags set in the shard, by name: a flag's entity exists while it is set (P1-E3.10). */
  flags(): ReadonlySet<string> { return new Set(this.entityRoster().flags); }
  /** One public shared state field in a frame, by its declared name. STR20: read every frame (the grapple's seven rows, the
   *  day, the weather), so it decodes the one `value` column in place: no key string and no decoded row object. @frame */
  stateField(frame: DecodedFrame, name: string): number | undefined {
    const handle = this.stateIds.get(name);
    const row = handle === undefined ? undefined : frame.rows.get(handle), cls = handle === undefined ? undefined : this.entities.get(handle)?.cls;
    if (row === undefined || cls === undefined) return undefined;
    const columns = cls.row;
    for (let k = 0; k < columns.length; k++) {
      const column = columns[k];
      if (column?.name !== 'value') continue;
      const value = column.value(row[k] ?? 0);
      return typeof value === 'number' ? value : undefined;
    }
    return undefined;
  }
  /** The owner block of a frame, as field values. */
  owner(frame: DecodedFrame): NetFields {
    // STR20: read by several systems every frame (loadout effects, the HUD); a held frame's owner block never changes, so it
    // is decoded once per frame
    let fields = this.owners.get(frame);
    if (fields === undefined) { fields = Object.freeze(decodeColumns(PLAYER_CLASS.owner, frame.owner)); this.owners.set(frame, fields); }
    return fields;
  }
  private readonly owners = new WeakMap<DecodedFrame, NetFields>();
  /** Queue one sim step's input; the next `flush` sends it. Returns the `seq` it was given. `viewTick`, left out, is what the
   *  screen shows now, which is what a blow is settled against (J50). */
  command(input: Omit<NetCommand, 'seq' | 'viewTick'> & { readonly viewTick?: number }): number {
    this.seq = (this.seq + 1) & 0xffff;
    this.unacked.push({ ...input, viewTick: input.viewTick ?? this.clock.viewTick(this.now()), seq: this.seq }); this.fresh++;
    return this.seq;
  }
  /** Once per render frame: the tick rows are drawn at, with every event and field change that tick has reached delivered. */
  present(): number {
    const renderTick = this.clock.renderTick(this.now());
    this.interpolator.cover(renderTick);
    this.delivery.update(renderTick);
    return renderTick;
  }
  /** Send this client frame's bundle: its new commands and up to REDUNDANT_COMMANDS older unacked ones, plus the ack. */
  flush(): void {
    // MP1.6: a cell on another worker hears this link with a fresh queue whose `lastSeq` is 0 while `seq` runs on; past 0x8000 that 0
    // reads as ahead of every command held here, which then all looked acked and none went out. An ack counts only when it moves on
    // from the last one and doesn't pass what this client sent.
    const acked = this.latest?.lastSeq;
    if (acked !== undefined && !seqAfter(acked, this.seq) && (this.ackedSeq === null || !seqAfter(this.ackedSeq, acked))) {
      this.ackedSeq = acked; this.unacked = this.unacked.filter(command => seqAfter(command.seq, acked));
    }
    const commands = this.unacked.slice(-(Math.min(this.fresh, 3) + REDUNDANT_COMMANDS));
    this.fresh = 0;
    const ackFrame = this.latest?.tick ?? NO_BASELINE;
    this.transport.send('unreliable', commandsMessage(ackFrame, commands, id => this.ids.get(id) ?? 0).buffer);
  }
  /** Send a non-movement action on the reliable channel. */
  act(act: NetRoomAct): void {
    const what = GATED_ACTS[act.kind];
    if (what !== undefined && !this.allows(what)) return;
    this.transport.send('reliable', actMessage(act).buffer);
  }
  /** Set what decides whether a tap may go out now (FM4); null lets everything through. */
  gateActions(gate: ((what: string) => boolean) | null): void { this.gate = gate; }
  /** May a tap named `what` go out now? Asking may show the player why not; an empty `what` asks without showing anything. */
  allows(what: string): boolean { return this.gate === null || this.gate(what); }
  /** Stop listening; the transport stays with its owner. */
  dispose(): void { for (const off of this.off) off(); this.listeners.clear(); this.presented.clear(); this.corrected.clear(); this.fights.clear(); this.deaths.clear(); this.travels.clear(); this.rejoins.clear(); this.heldFrames.clear(); this.heldElsewhere.clear(); this.unhold(); }

  private listen(transport: Transport): (() => void)[] {
    return [transport.onMessage((_channel, bytes) => { this.receive(new Uint8Array(bytes)); }), transport.onClose(reason => { this.closed = reason; })];
  }

  private receive(bytes: Uint8Array): void {
    const arrived = this.now(); // here, never in a render frame: at 24.3 frames/s that stamp would be 41 ms of false jitter
    let records: ReturnType<typeof readMessage>['records'];
    try { records = readMessage(bytes).records; } catch { this.dropped++; return; }
    for (const record of records) {
      const span = { bytes, start: record.start, end: record.end };
      if (record.tag === TAG_WELCOME) { bootMark('server:welcome-receive'); this.welcomed(span); }
      else if (this.holding) { this.dropped++; if (record.tag === TAG_FRAME) for (const listener of this.heldFrames) listener(); }
      else if (record.tag === TAG_EVENTS) this.events(span);
      else if (record.tag === TAG_FRAME) this.decoded(this.server?.read(span) ?? null, arrived);
      else this.dropped++;
    }
  }
  /** A welcome: the seat, and the server's tables unless this socket already holds them (a travel, 5.3). */
  private welcomed(span: Span): void {
    let said: ReturnType<typeof decodeWelcome>;
    try { said = decodeWelcome(span); } catch { this.dropped++; return; }
    const { tables } = said;
    if (tables !== undefined) {
      // Both readers or neither: a table this build can't project (one lacking a required field) is a server this build
      // can't play, so it closes as `reload` and the page decides from version.json (5.5), never hanging unwelcomed.
      let built: { readonly server: WireFrameReader; readonly events: (span: Span) => { readonly events: readonly NetEvent[] } };
      try {
        const server = new WireFrameReader(tables, handle => this.senderClasses.get(handle), PLAYER_CLASS);
        built = { server, events: eventsReader(tables.eventTables, id => server.senderColumns(id)) };
      } catch (error) {
        if (!(error instanceof Error && error.name === 'WireDecodeError')) throw error;
        this.dropped++; this.transport.close('reload'); return;
      }
      this.server = built.server; this.serverEvents = built.events; this.tableHash = said.tableHash;
    } else if (said.tableHash !== this.tableHash) { this.dropped++; this.transport.close('reload'); return; }
    const elsewhere = this.holding && this.heldFor !== undefined && said.cell !== this.heldFor;
    this.holding = false; this.heldFor = undefined;
    this.welcome = { handle: said.handle, player: said.player, tick: said.tick, cell: said.cell, schemaHash: said.tableHash, simHz: said.simHz, frameHz: said.frameHz };
    this.interpolator.own = said.handle;
    if (elsewhere) for (const listener of this.heldElsewhere) listener(said.cell);
  }
  private events(span: Span): void {
    let decoded: { readonly events: readonly NetEvent[] } | null = null;
    try { decoded = this.serverEvents?.(span) ?? null; } catch { decoded = null; }
    if (decoded === null) { this.dropped++; return; }
    for (const event of decoded.events) {
      if (event.kind === 'player-died') {
        if (event.id !== this.welcome?.handle || event.tick <= this.deathTick) continue;
        this.deathTick = event.tick;
        for (const listener of this.deaths) listener(event);
        continue;
      }
      if (event.kind === 'hit' || event.kind === 'died' || event.kind === 'reward') { for (const listener of this.fights) listener(event); this.delivery.receive(event); continue; }
      if (event.kind === 'view') { for (const listener of this.fightViews) listener(event); continue; }
      if (event.kind === 'flight') { for (const listener of this.flights) listener(event); continue; }
      if (event.kind === 'quest') { this.quests.set(event.quest, event); continue; }
      if (event.kind === 'ledger') { this.receipt(event); continue; }
      if (event.kind === 'owned') { if (event.value === 0) this.owned.delete(event.name); else this.owned.set(event.name, event.value); this.ownedVersion++; continue; }
      if (event.kind === 'chat') { for (const listener of this.lines) listener(event); continue; }
      if (event.kind === 'travel') { this.left(); for (const listener of this.travels) listener(event); continue; }
      if (event.kind === 'mount' || event.kind === 'dismount') {
        if (event.kind === 'mount') this.riders.set(event.rider, event.mount); else this.riders.delete(event.rider);
        for (const listener of this.rides) listener(event);
        continue;
      }
      if (event.kind === 'phase') { if (event.on) this.phased.add(event.flag); else this.phased.delete(event.flag); continue; }
      if (event.kind === 'despawn') {
        const id = this.entities.get(event.handle)?.id;
        if (id !== undefined) { this.ids.delete(id); if (id.startsWith(STATE_PREFIX)) this.stateIds.delete(id.slice(STATE_PREFIX.length)); }
        if (this.entityRows.delete(event.handle)) this.roster = undefined;
        this.senderClasses.delete(event.handle);
        continue;
      }
      // The server's class id (game index + 1, 5.2), kept even for a class this build lacks so its rows still decode.
      const senderId = event.cls + 1;
      this.senderClasses.set(event.handle, senderId);
      const cls = netClassOf(event.cls);
      if (cls === undefined) continue;
      const initial = decodeColumns(cls.initial, this.server?.initial(senderId, event.initial) ?? event.initial);
      const texts = this.server?.text(senderId, event.text) ?? event.text;
      cls.text.forEach((field, index) => { initial[field.name] = texts[index] ?? ''; });
      this.entityRows.set(event.handle, { handle: event.handle, id: event.id, cls, initial });
      this.roster = undefined;
      this.ids.set(event.id, event.handle);
      if (event.id.startsWith(STATE_PREFIX)) this.stateIds.set(event.id.slice(STATE_PREFIX.length), event.handle);
    }
  }
  /** Everything it holds named the cell it left. Commands stand: the player's own stream goes on. */
  private left(): void { this.welcome = null; this.latest = null; this.deathTick = -1; this.clock.reset(); this.interpolator.clear(); this.delivery.clear(); this.frames.clear(); this.entityRows.clear(); this.roster = undefined; this.senderClasses.clear(); this.ids.clear(); this.stateIds.clear(); this.quests.clear(); this.phased.clear(); this.riders.clear(); this.owned.clear(); this.ownedVersion++; this.ledgerSerial = 0; }
  private receipt(event: NetLedger): void {
    if (event.serial <= this.ledgerSerial || this.granted.has(event.id)) return;
    this.ledgerSerial = event.serial; this.granted.add(event.id);
    for (const listener of this.receipts) listener(event);
  }
  private decoded(frame: DecodedFrame | null, arrived: number): void {
    if (frame === null || (this.welcome !== null && frame.cell !== this.welcome.cell)) { this.dropped++; return; }
    this.frames.set(frame.tick, frame);
    if (this.frames.size > FRAME_RING) for (const tick of this.frames.keys()) { this.frames.delete(tick); if (this.frames.size <= FRAME_RING) break; }
    if (this.latest === null) bootMark('server:first-authoritative-frame', {tick: frame.tick});
    if (this.latest === null || frame.tick > this.latest.tick) this.latest = frame;
    const spacingErrorMs = this.clock.arrival(frame.tick, arrived);
    this.interpolator.push(frame);
    for (const listener of this.listeners) listener(frame, spacingErrorMs);
  }
}

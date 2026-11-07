import { bootMark } from '../../../shared/engine/boot/timing';
// P1-E5.2 (E5-REPLICATION §4): the client's end of the game protocol. It says hello, decodes frames and events, acks, and
// sends commands in bundles with redundant copies. Prediction and interpolation build on this in E5.3; the view halves
// read its rows in E4.3. It knows nothing of how bytes travel, and imports nothing from the server.
import { installPortableMath } from '../../../shared/engine/core/portableMath';
import type { QuestProgress } from '../../../shared/engine/quest/progress';
import type { NetCommand } from '@wildshard/format/netCommand';
import type { ChatChannel, NetRoomAct } from '../../../shared/engine/net/acts';
import type { NetChat } from '../../../shared/engine/net/chatWire';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { BitWriter, fitText, MAX_NET_TEXT_BYTES } from '../../../shared/engine/net/bits';
import { encodeCommands, seqAfter } from '../../../shared/engine/net/command';
import { GUEST, type NetIdentity } from '../../../shared/engine/net/identity';
import type { NetLedger } from '../../../shared/engine/net/ledgerWire';
import { decodeFrame, FRAME_RING, NO_BASELINE, type DecodedFrame, type FrameTable } from '../../../shared/engine/net/frame';
import { decodeEvents, decodeWelcome, encodeAct, encodeHello, messageId, MSG_EVENTS, MSG_FRAME, MSG_WELCOME, type InitialBits, type NetView, type NetCombatEvent, type NetPlayerDied, type NetRide, type NetTravel, type NetWelcome } from '../../../shared/engine/net/messages';
import { FLAG_CLASS, NET_CLASSES, NET_SCHEMA_HASH, PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import { FLAG_PREFIX, STATE_PREFIX } from '../../../shared/engine/net/shardNet';
import type { NetClass, NetValue } from '../../../shared/engine/net/schema';
import type { Transport } from '../../../shared/engine/net/transport';
import { Interpolator } from './interpolator';
import { NetClock } from './netClock';
import { NetDelivery } from './onRep';

/** Older commands repeated in each bundle, against loss (§4.2). */
export const REDUNDANT_COMMANDS = 4;

/** What the client knows of an entity from its spawn. */
export interface NetEntityInfo { readonly handle: number; readonly id: string; readonly cls: NetClass<never>; readonly initial: Readonly<Record<string, NetValue>> }
/** A row with its quantised values turned back into field values. */
export type NetFields = Readonly<Record<string, NetValue>>;

const initialBits: InitialBits = cls => { const entry = NET_CLASSES[cls]; return entry === undefined ? undefined : { bits: entry.initial.map(column => column.bits), text: entry.text.length }; };

function decodeColumns(columns: NetClass<never>['row'], values: ArrayLike<number>): Record<string, NetValue> {
  const out: Record<string, NetValue> = {};
  columns.forEach((column, index) => { out[column.name] = column.value(values[index] ?? 0); });
  return out;
}

/** The client's end of the wire. */
export class NetClient {
  /** The server's welcome, once it arrives. */
  welcome: NetWelcome | null = null;
  /** The newest frame decoded. */
  latest: DecodedFrame | null = null;
  /** Why the connection ended, or null while it is open. `reload` means a stale build was refused (J54). */
  closed: string | null = null;
  /** Frames refused as malformed or not applicable yet. */
  dropped = 0;
  readonly entities: Map<number, NetEntityInfo> = new Map<number, NetEntityInfo>();
  /** Where the server is now, and how far behind it rows are drawn (P1-E5.3-F3). */
  readonly clock: NetClock = new NetClock();
  /** Every row but this client's own character, buffered to be drawn in the past (P1-E5.3-F2). */
  readonly interpolator: Interpolator = new Interpolator(handle => this.entities.get(handle)?.cls);
  /** Events and field changes, when the screen reaches them (P1-E5.3-F4). Step it with `present`. */
  readonly delivery: NetDelivery = new NetDelivery(this.interpolator, handle => this.entities.get(handle)?.cls.cls);
  private readonly now: () => number;
  private transport: Transport;
  private readonly writer = new BitWriter(1024);
  private readonly frames = new Map<number, DecodedFrame>();
  private readonly listeners = new Set<(frame: DecodedFrame) => void>();
  private readonly fights = new Set<(event: NetCombatEvent) => void>();
  private readonly deaths = new Set<(event: NetPlayerDied) => void>();
  private deathTick = -1;
  private readonly fightViews = new Set<(view: NetView) => void>();
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
  private readonly table: FrameTable;
  private readonly ids = new Map<string, number>();
  private unacked: NetCommand[] = [];
  private fresh = 0;
  private seq = 0;
  private off: (() => void)[];
  private said: { readonly build: string; readonly identity: NetIdentity } = { build: '', identity: GUEST };
  private readonly rejoins = new Set<() => void>();
  constructor(transport: Transport, now: () => number = diagnosticNow) {
    installPortableMath();
    this.transport = transport; this.now = now;
    this.table = { ownerClass: PLAYER_CLASS, classOf: handle => this.entities.get(handle)?.cls, baseline: tick => this.frames.get(tick) ?? null };
    this.off = this.listen(transport);
  }
  /** Begin the handshake. `build` is this client's engine build id; `identity` is who it says it is (J111). */
  hello(build = '', identity: NetIdentity = GUEST, ledger = 0): void {
    this.ledgerSerial = ledger; this.said = { build, identity };
    this.transport.send('reliable', encodeHello(this.writer, { schemaHash: NET_SCHEMA_HASH, build, ...identity, ledger }));
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
    this.unacked = []; this.fresh = 0; this.seq = 0; this.closed = null;
    this.transport = transport; this.off = this.listen(transport);
    for (const listener of this.rejoins) listener();
    this.hello(said.build, said.identity, ledgerSerial);
  }
  /** Call when a new link replaces the old one, before its `hello`; returns the unsubscribe. */
  onRejoin(listener: () => void): () => void { this.rejoins.add(listener); return () => { this.rejoins.delete(listener); }; }
  /** Call for every frame decoded; returns the unsubscribe. */
  onFrame(listener: (frame: DecodedFrame) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Call for every look a fight tells its views; returns the unsubscribe. */
  onView(listener: (view: NetView) => void): () => void { this.fightViews.add(listener); return () => { this.fightViews.delete(listener); }; }
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
  /** One entity's row in a frame, as field values. */
  fields(frame: DecodedFrame, handle: number): NetFields | null {
    const row = frame.rows.get(handle), cls = this.entities.get(handle)?.cls;
    return row === undefined || cls === undefined ? null : decodeColumns(cls.row, row);
  }
  /** The flags set in the shard, by name: a flag's entity exists while it is set (P1-E3.10). */
  flags(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const entity of this.entities.values()) if (entity.cls === FLAG_CLASS) out.add(entity.id.slice(FLAG_PREFIX.length));
    return out;
  }
  /** One public shared state field in a frame, by its declared name. */
  stateField(frame: DecodedFrame, name: string): number | undefined {
    const value = this.fields(frame, this.ids.get(`${STATE_PREFIX}${name}`) ?? 0)?.['value'];
    return typeof value === 'number' ? value : undefined;
  }
  /** The owner block of a frame, as field values. */
  owner(frame: DecodedFrame): NetFields { return decodeColumns(PLAYER_CLASS.owner, frame.owner); }
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
    this.delivery.update(renderTick);
    return renderTick;
  }
  /** Send this client frame's bundle: its new commands and up to REDUNDANT_COMMANDS older unacked ones, plus the ack. */
  flush(): void {
    const acked = this.latest?.lastSeq;
    if (acked !== undefined) this.unacked = this.unacked.filter(command => seqAfter(command.seq, acked));
    const commands = this.unacked.slice(-(Math.min(this.fresh, 3) + REDUNDANT_COMMANDS));
    this.fresh = 0;
    const ackFrame = this.latest?.tick ?? NO_BASELINE;
    this.transport.send('unreliable', encodeCommands(this.writer, { ackFrame, commands }, id => this.ids.get(id) ?? 0));
  }
  /** Send a non-movement action on the reliable channel. */
  act(act: NetRoomAct): void { this.transport.send('reliable', encodeAct(this.writer, act)); }
  /** Stop listening; the transport stays with its owner. */
  dispose(): void { for (const off of this.off) off(); this.listeners.clear(); this.fights.clear(); this.deaths.clear(); this.travels.clear(); this.rejoins.clear(); }

  private listen(transport: Transport): (() => void)[] {
    return [transport.onMessage((_channel, bytes) => { this.receive(new Uint8Array(bytes)); }), transport.onClose(reason => { this.closed = reason; })];
  }

  private receive(bytes: Uint8Array): void {
    const arrived = this.now(); // here, never in a render frame: at 24.3 frames/s that stamp would be 41 ms of false jitter
    switch (messageId(bytes)) {
      case MSG_WELCOME: bootMark('server:welcome-receive'); this.welcome = decodeWelcome(bytes); this.interpolator.own = this.welcome?.handle ?? null; break;
      case MSG_EVENTS: this.events(bytes); break;
      case MSG_FRAME: this.decoded(decodeFrame(bytes, this.table), arrived); break;
      default: this.dropped++;
    }
  }
  private events(bytes: Uint8Array): void {
    const decoded = decodeEvents(bytes, initialBits);
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
        if (id !== undefined) this.ids.delete(id);
        this.entities.delete(event.handle);
        continue;
      }
      const cls = NET_CLASSES[event.cls];
      if (cls === undefined) continue;
      const initial = decodeColumns(cls.initial, event.initial);
      cls.text.forEach((field, index) => { initial[field.name] = event.text[index] ?? ''; });
      this.entities.set(event.handle, { handle: event.handle, id: event.id, cls, initial });
      this.ids.set(event.id, event.handle);
    }
  }
  /** Everything it holds named the cell it left. Commands stand: the player's own stream goes on. */
  private left(): void { this.welcome = null; this.latest = null; this.deathTick = -1; this.clock.reset(); this.interpolator.clear(); this.delivery.clear(); this.frames.clear(); this.entities.clear(); this.ids.clear(); this.quests.clear(); this.phased.clear(); this.riders.clear(); this.owned.clear(); this.ownedVersion++; this.ledgerSerial = 0; }
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
    this.clock.arrival(frame.tick, arrived); this.interpolator.push(frame);
    for (const listener of this.listeners) listener(frame);
  }
}

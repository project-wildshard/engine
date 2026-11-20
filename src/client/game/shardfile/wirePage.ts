// What a page reads in place of a sim of its own. Views install long before the server's first frame, so they take this seat at
// install and it fills when the wire does.
import type { Vector3 } from 'three';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
import { declaredHarvestDrops } from '../../../shared/game/harvest';
import type { HarvestDrop } from '@wildshard/format/harvestRows';
import { STORY_ACT, type NetRoomAct } from '@wildshard/engine/net/acts';
import { DAY_ROW } from '@wildshard/engine/sim/shardRows';
import type { DayCycleClock } from '@wildshard/engine/world/dayCycle';
import type { ClimateWord } from '../weather/netClimate';
import type { Inventory } from '../Inventory';
import { boardFromLines, OWNED_ROW, WORN_LINE } from '../../../shared/game/loot/ownedRows';
import type { ContractBoard } from '../../../shared/game/quest/contractBoard';
import { sandWireName, type ArenaRoomGround } from '../../../shared/game/boss/arenaGround';
import { isCosmetic, isOwnedId, type Owned } from '../../../shared/game/loot/Owned';
import type { Purse } from '../../../shared/game/loot/Purse';
import { QuestViewFeed } from '@wildshard/engine/quest/view/replica';
import type { QuestDef } from '@wildshard/engine/quest/core';
import type { QuestGateView, QuestView } from '@wildshard/engine/quest/viewPort';
import type { QuestProgress } from '@wildshard/engine/quest/progress';
import { Flags } from '@wildshard/engine/world/interact/flags';
import { netEncounterFeed, type EncounterRow } from '../boss/barFeed';
import { netLootFeed, type LootFeed } from '../loot/feed';
import { netCreatureCount } from '../population/netCounts';
import type { MoverView } from '../../../server/game/plugin/mover';
import type { MoverPose } from '@wildshard/format/moverPose';
import type { PageAbility } from './clientRecipes';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { netSimCommand } from '@wildshard/engine/sim/netMotion';
import type { SimCommand } from '@wildshard/engine/sim';
import { vehicleMotionRow } from '../../../shared/game/shardfile/wirePrompts';
import type { VehicleReport, VehicleWire } from '../plugin/followedVehicles';
import type { VehicleRow } from '../plugin/vehiclePrediction';

type Live = (client: NetClient) => (() => void) | undefined;
/** MIRROR-SALT-ZONE MSZ9b: the vehicles a page follows off the wire (`FollowedVehicles`). */
export interface VehicleFollower {
  /** The view a vehicle's row poses, when it is one of these. */
  readonly view: (id: string) => MoverView | undefined;
  /** Once a frame: the wire's entity ids, this page's player and its feet. */
  readonly sync: (ids: Iterable<string>, me: string | null, feet: { readonly x: number; readonly z: number }) => void;
  /** The seat this page's player holds, a vehicle's pose and its kind, as the newest rows say. */
  readonly seatOf: () => { readonly vehicle: string; readonly seat: number } | undefined;
  readonly pose: (id: string) => MoverPose | undefined;
  readonly kindOf: (id: string) => { readonly seats: readonly { readonly role: string }[]; readonly handling: { readonly speed: number; readonly boost: number } } | undefined;
  /** MSZ10: another player's seat, as its body is drawn: its vehicle's heading and the seat's pose. */
  readonly seated: (player: string) => { readonly yaw: number; readonly pose: 'sit' | 'stand' } | null;
  /** MSZ16: a command this page sent, which steps the vehicle its player drives; and a drawn frame, which eases a correction. */
  /** Where a seat stands as the page draws its vehicle. */
  readonly seatPoint?: (vehicle: string, seat: number) => readonly [number, number, number] | undefined;
  readonly command?: (command: SimCommand, wire: VehicleWire) => void;
  readonly frame?: (dt: number) => void;
  readonly report?: () => VehicleReport;
}
/** A mover's look in one grid cell, as `WirePage.moverLooks` keys it. */
export const moverLookKey = (instance: string, id: string): string => `${instance}\n${id}`;
/** What a page draws of what its player holds. */
export interface WireHoldings {
  /** The shard these lines are this page's for, on a grid page that holds several: the entered one's reach the page. */
  readonly shard?: string;
  readonly purse?: Pick<Purse, 'mirror'>; readonly inventory?: Pick<Inventory, 'mirror'>; readonly gear?: Pick<Owned, 'grant' | 'worn' | 'toggleWorn'>; readonly board?: Pick<ContractBoard, 'mirror'>;
  /** Kill totals from the server; discoveries remain the page's. */
  readonly journal?: { readonly mirrorKills: (id: string, taken: number, best: number) => void };
  /** Pending finish pickups, with their authoritative positions. */
  readonly drops?: (lines: ReadonlyMap<string, number>) => void;
  /** The weapon finishes the server says this player owns. */
  readonly finishes?: { readonly own: (id: string) => void };
  /** A story's channel the server said for this player's eyes: its toast, its reading, its sting. */
  readonly said?: (channel: string) => void;
}
/** A page's own copy of a save that the server keeps: it reads the page's last word and writes nothing. */
export const readOnlySave = <T extends object>(save: T & { readonly write: unknown }): T => new Proxy(save, { get: (target, name) => name === 'write' ? (): boolean => true : Reflect.get(target, name, target) as unknown });
/** The page's day clock, as a row sets it. */
export type DayFollower = Pick<DayCycleClock, 'phase' | 'paused'>;
const NO_ROWS: readonly EncounterRow[] = [];
/** A talk's end, which says it again: a press is judged where the server has the body, a command behind, and a retry changes nothing. */
const TALKED = 'talked:';

/** A client's rows, through a seat that may not have one yet. */
const rowsOf = (seat: { readonly client: NetClient | null }): Pick<NetClient, 'latest' | 'stateField'> => ({ get latest() { return seat.client?.latest ?? null; }, stateField: (frame, name) => seat.client?.stateField(frame, name) });
/** One page's seat on the wire. */
export class WirePage {
  /** The server's client once this page has one. */
  client: NetClient | null = null;
  /** Ends the session's server: Settings stops it before it touches what it saves. */
  stop: () => void = () => undefined;
  /** Mover views by id: rows pose them, and no script runs them here. */
  readonly movers: Map<string, MoverView> = new Map<string, MoverView>();
  /** TEMPLATE-E2E TC-E5b: a mover's drawn look (a grid cell's props panel) by `moverLookKey`, which its cell's collider view
   *  poses too. Keyed by cell: two copies of one product share their mover ids. */
  readonly moverLooks: Map<string, MoverView> = new Map<string, MoverView>();
  /** MSZ9b: the vehicles each install follows, by its key (`page`, `scene`, `grid`): a grid cell's replaces the last one's. */
  readonly vehicles: Map<string, VehicleFollower> = new Map<string, VehicleFollower>();
  /** Whether the server is carrying this player's body now. */
  led: () => boolean = () => false;
  /** Commands this page sent that the server has not stepped yet (SS-MS2a3b). */
  pending: () => number = () => 0;
  /** A row's body on this page, by its handle. */
  rowBody: (body: number) => Animal | null = () => null;
  /** A row's body on this page, by the name the server gave it. */
  namedBody: (id: string) => Animal | null = () => null;
  private readonly dressers = new Map<object, (body: Animal) => void>();
  /** A declared species' kind on this page, by its id: its own id when it shares a native kind (TE-ENG7). */
  private speciesKinds: ReadonlyMap<string, string> = new Map<string, string>();
  /** The head over a row's body, into `to`: what an elite's bar stands on. */
  readonly head: (body: number, to: Vector3) => boolean = (body, to) => this.heads(body, to);
  /** SS-MS2a3b: a mover's row in the newest frame, when that frame carried a sample of it (not a held copy). */
  /** MSZ9b: a vehicle's row's view, from the followers that know its dock. */
  vehicleView(id: string): MoverView | undefined {
    for (const follower of this.vehicles.values()) { const view = follower.view(id); if (view !== undefined) return view; }
    return undefined;
  }
  /** MSZ10: a player's seat in a vehicle the followers know, for its drawn body; null out of one. */
  vehicleSeat(player: string): { readonly yaw: number; readonly pose: 'sit' | 'stand' } | null {
    for (const follower of this.vehicles.values()) { const seat = follower.seated(player); if (seat !== null) return seat; }
    return null;
  }
  /** MSZ9b, once a frame: the followers read the vehicles and seats the wire has now. */
  syncVehicles(feet: { readonly x: number; readonly z: number }, dt = 0): void {
    const client = this.client; if (client === null || this.vehicles.size === 0) return;
    const ids: string[] = []; for (const info of client.entities.values()) ids.push(info.id);
    for (const follower of this.vehicles.values()) { follower.sync(ids, client.welcome?.player ?? null, feet); follower.frame?.(dt); }
  }
  /** MSZ16: each command the page sends, as it goes: the driven vehicle steps on it. */
  command(command: NetCommand): void {
    if (this.client === null || this.vehicles.size === 0) return;
    const sim = netSimCommand(command), wire: VehicleWire = { row: id => this.vehicleRow(id), behind: this.pending() };
    for (const follower of this.vehicles.values()) follower.command?.(sim, wire);
  }
  /** MSZ16: what a proof reads of the page's driving: the first follower that drives, else the first one. */
  vehicleReport(): VehicleReport | null {
    let first: VehicleReport | null = null;
    for (const follower of this.vehicles.values()) { const report = follower.report?.() ?? null; if (report?.driving !== null && report !== null) return report; first ??= report; }
    return first;
  }
  /** MSZ16: a driven vehicle's row in the newest frame, with its speeds when the frame carried them. */
  vehicleRow(id: string): VehicleRow | null {
    const row = this.moverRow(id), frame = this.client?.latest; if (row === null || frame === null || frame === undefined) return null;
    const forward = this.client?.stateField(frame, vehicleMotionRow(id, 'forward')), slip = this.client?.stateField(frame, vehicleMotionRow(id, 'slip'));
    return { ...row, ...(forward === undefined ? {} : { forward }), ...(slip === undefined ? {} : { slip }) };
  }
  moverRow(id: string): { readonly tick: number; readonly pose: MoverPose } | null {
    const client = this.client, frame = client?.latest;
    if (client === null || frame === null || frame === undefined) return null;
    const handle = client.handle(`script:${id}`);
    if (handle === undefined || !frame.fresh.has(handle)) return null;
    const x = client.field(frame, handle, 'x'), y = client.field(frame, handle, 'y'), z = client.field(frame, handle, 'z'), pitch = client.field(frame, handle, 'pitch'), yaw = client.field(frame, handle, 'yaw'), roll = client.field(frame, handle, 'roll');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof pitch !== 'number' || typeof yaw !== 'number' || typeof roll !== 'number') return null;
    return { tick: frame.tick, pose: { position: { x, y, z }, euler: { x: pitch, y: yaw, z: roll }, enabled: client.field(frame, handle, 'enabled') === true } };
  }
  /** How many poses rows have set: what a proof reads. */
  posed = 0;
  /** What this page drew of what it only hears, by name: what a proof reads. */
  readonly drawn: Record<string, number> = {};
  /** The highest drift rows have laid here, in metres: what a proof reads. */
  sandPeak = 0;
  private sandTick = -1;
  private readonly sandStrips: string[] = [];
  /** This player's own world (J106), for a gate and a key. */
  readonly gates: QuestGateView = { has: flag => this.heard.has(flag) };
  private readonly quests = new Map<string, QuestProgress>();
  private readonly heard = new Set<string>();
  private readonly feeds = new Map<string, QuestViewFeed>();
  /** each feed's declaration, as text: a changed one makes a new feed */
  private readonly feedWords = new Map<string, string>();
  private readonly waiting = new Set<Live>();
  private readonly books = new Set<Flags>();
  /** The rows a sky reads: none, until the wire is up. */
  readonly climateRows: Pick<NetClient, 'latest' | 'stateField'> = rowsOf(this);
  private encounterRows: (() => readonly EncounterRow[]) | null = null;
  /** The cell whose rows the feeds last took: what a client hears first in a cell is where things stand there, not news. */
  private seeded: number | null = null;
  private heads: (body: number, to: Vector3) => boolean = () => false;
  private press: (id: string) => void = () => undefined;
  private act: (act: NetRoomAct) => void = () => undefined;
  /** This player's word on the sky: every world keeps its own weather, so each one hears it as this page gets there. */
  private readonly skyWords = new Map<ClimateWord['op'], ClimateWord>();
  private dayRow: number | undefined;
  private readonly holdings = new Set<WireHoldings>();
  private readonly purchases = new Map<number, { before: number; confirmed: () => void }>();
  private ownedAt = -1;
  private readonly said = new Map<string, number>();
  /** What a page does to a body its own population spawns, for the rows `manager` draws: until `scope` ends. */
  dressRows(manager: object, scope: Scope, dress: (body: Animal) => void): void { this.dressers.set(manager, dress); scope.onDispose(() => { if (this.dressers.get(manager) === dress) this.dressers.delete(manager); }); }
  /** A row's new body, in `manager`. */
  dress(manager: object, body: Animal): void { this.dressers.get(manager)?.(body); }
  /** The page's kinds for declared species (`speciesViewKinds`), until `scope` ends. */
  declareSpecies(kinds: ReadonlyMap<string, string>, scope: Scope): void {
    this.speciesKinds = kinds; scope.onDispose(() => { if (this.speciesKinds === kinds) this.speciesKinds = new Map(); });
  }
  /** CC11a2c: each declared species' abilities in row order (`abilityRows`), until `scope` ends. */
  private speciesAbilities: ReadonlyMap<string, readonly PageAbility[]> = new Map();
  declareAbilities(abilities: ReadonlyMap<string, readonly PageAbility[]>, scope: Scope): void {
    this.speciesAbilities = abilities; scope.onDispose(() => { if (this.speciesAbilities === abilities) this.speciesAbilities = new Map(); });
  }
  /** The ability a row's `ability` names (1-based in its species' abilities); none for 0, an unknown one or no species. */
  abilityOf(species: string, index: number): PageAbility | undefined { return index > 0 ? this.speciesAbilities.get(species)?.[index - 1] : undefined; }
  /** The kind a row spawns as here: its declared species' page kind, else the wire's `kind` (a native body, an older server). */
  /** CC28c: each page kind's look swap (its body's second look), by the page kind it swaps from. */
  private swaps: ReadonlyMap<string, { readonly kind: string; readonly index: number; readonly at: number }> = new Map();
  declareSwaps(swaps: ReadonlyMap<string, { readonly kind: string; readonly index: number; readonly at: number }>, scope: Scope): void {
    this.swaps = swaps; scope.onDispose(() => { if (this.swaps === swaps) this.swaps = new Map(); });
  }
  /** The kind a row of page kind `home` draws as under these channels: its swap look's while the channel is at `at` or more. */
  lookKind(home: string, channels: readonly number[]): string {
    const swap = this.swaps.get(home);
    return swap !== undefined && (channels[swap.index] ?? 0) >= swap.at ? swap.kind : home;
  }
  rowKind(species: unknown, kind: string): string { return typeof species === 'string' && species !== '' ? this.speciesKinds.get(species) ?? kind : kind; }
  /** Count a thing drawn, or `times` of them (a frame that draws every word heard since the last). */
  drew(what: string, times = 1): void { this.drawn[what] = (this.drawn[what] ?? 0) + times; }
  /** Words for a view this page hasn't built (a room nobody entered), by name: heard, and rightly not drawn (EG-15). */
  readonly offstage: Record<string, number> = {};
  unbuilt(what: string): void { this.offstage[what] = (this.offstage[what] ?? 0) + 1; }

  /** The latest frame's server tick, or null before one. */
  tick(): number | null { return this.client?.latest?.tick ?? null; }
  /** One of this player's lines as the server last said it: 0 for none. */
  line(name: string): number { return this.client?.owned.get(name) ?? 0; }
  /** Run `use` once there is a client, now or later, until `scope` ends. What it returns runs when `scope` does. */
  whenLive(scope: Scope, use: Live): void {
    const { client } = this;
    if (client !== null) { const off = use(client); if (off !== undefined) scope.onDispose(off); return; }
    const run: Live = next => { const off = use(next); if (off !== undefined) scope.onDispose(off); return undefined; };
    this.waiting.add(run); scope.onDispose(() => { this.waiting.delete(run); });
  }
  /** Past this world's first frame. Until then a flag that rises only says where a save stood. */
  get settled(): boolean { const cell = this.client?.latest?.cell; return cell !== undefined && this.seeded === cell; }
  private readonly settles = new Set<() => void>();
  /** Run `then` once, at this world's first frame, after its flags are mirrored: now, if that frame is in. Returns its cancel. */
  whenSettled(then: () => void): () => void {
    if (this.settled) { then(); return () => undefined; }
    this.settles.add(then);
    return () => { this.settles.delete(then); };
  }
  /** This page's books follow the server's: its quests read where a save stood only from the world's first frame (`settled`). */
  following = false;
  /** Every flag book this page makes from now on follows the server's. */
  followBooks(): void { this.following = true; Flags.made = book => { this.books.add(book); book.follow(flag => { if (flag.startsWith('seen:')) { this.send(flag); return; } if (flag.startsWith(TALKED)) this.send(`${flag.slice(TALKED.length)}.talk`); this.send(`${STORY_ACT}${flag}`); }); }; }
  /** SHARD-SOURCE SS-GP1: a flag book for `level` (a grid cell's slug) that follows the server's until `scope` ends (a grid
   *  stay), then is dropped. `current`: the wire is that cell's now, so a settled world's flags are taken at once rather than
   *  read as news on the next frame. */
  book(level: string, scope: Scope, current: boolean): Flags {
    const book = new Flags(level, false), tick = this.client?.latest?.tick;
    if (current && this.books.has(book) && this.settled && tick !== undefined) book.mirror(this.heard, tick);
    scope.onDispose(() => { this.books.delete(book); });
    return book;
  }
  /** The wire is up. `press` sends one `interact`. */
  bind(client: NetClient, press: (id: string) => void, stop: () => void, heads: (body: number, to: Vector3) => boolean, act: (act: NetRoomAct) => void = () => undefined): void {
    this.client = client; this.press = press; this.act = act; this.stop = stop; this.heads = heads; this.encounterRows = netEncounterFeed(client).rows;
    for (const use of this.waiting) use(client);
    this.waiting.clear();
  }
  unbind(): void { this.client = null; this.press = () => undefined; this.act = () => undefined; this.dayRow = undefined; this.stop = () => undefined; this.encounterRows = null; this.heads = () => false; this.seeded = null; this.purchases.clear(); this.books.clear(); this.feeds.clear(); this.feedWords.clear(); this.movers.clear(); }
  /** A setting's weather or a dev's jump: the server's sky takes it. Only a mode outlives its world. */
  climate(word: ClimateWord): void {
    if (word.op !== 'force') this.skyWords.set(word.op, word);
    if (this.seeded !== null) this.say(word); else this.skyWords.set(word.op, word);
  }
  private say(word: ClimateWord): void { this.act({ kind: 'climate', seq: 0, ...word }); }
  /** A player is back from a room. The page's law is that a day goes on while they practise, and this page's clock did: the server's held with its world. */
  dayPassed(clock: DayFollower): void { if (!clock.paused) this.say({ op: 'day', name: 'room', at: clock.phase }); }
  /** One of a world's public rows, as the latest frame has it. */
  row(name: string): number | undefined { const { client } = this, frame = client?.latest ?? null; return client === null || frame === null ? undefined : client.stateField(frame, name); }
  /** The server's day, followed: the page's clock is a view of it. A paused clock is one a player or a tool stopped. */
  private followDay(clock: DayFollower | null, client: NetClient): void {
    const phase = client.latest === null ? undefined : client.stateField(client.latest, DAY_ROW);
    if (clock === null || phase === undefined || phase === this.dayRow || clock.paused) return;
    this.dayRow = phase; clock.phase = phase;
  }
  /** What this page shows of what its player holds: `hold`'s until `scope` ends. */
  hold(holdings: WireHoldings, scope: Scope): void { this.holdings.add(holdings); this.ownedAt = -1; scope.onDispose(() => { this.holdings.delete(holdings); }); }
  /** The server's lines, onto the page's purse, pack and gear. They only say what's so: the server owns all three. */
  private mirrorOwned(client: NetClient, level: string | null): void {
    if (client.ownedVersion === this.ownedAt || client.ownedVersion === 0) return; // a player with no coins has no coins line: any line at all is the server speaking
    this.ownedAt = client.ownedVersion;
    const pack = new Map<string, number>(), { owned } = client;
    for (const [name, value] of owned) if (name.startsWith(OWNED_ROW.item)) pack.set(name.slice(OWNED_ROW.item.length), value);
    const contracts = boardFromLines(owned), news: string[] = [];
    for (const [name, value] of owned) if (name.startsWith(OWNED_ROW.said) && this.said.get(name) !== value) { this.said.set(name, value); news.push(name.slice(OWNED_ROW.said.length)); }
    for (const { shard, purse, inventory, gear, board, finishes, journal, drops, said } of this.holdings) {
      if (shard !== undefined && level !== null && shard !== level) continue;
      purse?.mirror(owned.get(OWNED_ROW.coins) ?? 0); inventory?.mirror(pack);
      for (const [name, value] of owned) if (name.startsWith(OWNED_ROW.owned)) { const id = name.slice(OWNED_ROW.owned.length); gear?.grant(id); if (isOwnedId(id) && isCosmetic(id) && gear?.worn(id) !== (value === WORN_LINE)) gear?.toggleWorn(id); }
      if (journal !== undefined) for (const [name, value] of owned) if (name.startsWith(OWNED_ROW.journal) && name.endsWith('.taken')) {
        const id = name.slice(OWNED_ROW.journal.length, -'.taken'.length); journal.mirrorKills(id, value - 1, (owned.get(`${OWNED_ROW.journal}${id}.best`) ?? 1) - 1);
      }
      if (finishes !== undefined) for (const [name] of owned) if (name.startsWith(OWNED_ROW.finish)) finishes.own(name.slice(OWNED_ROW.finish.length));
      drops?.(owned);
      if (board !== undefined && contracts !== null) board.mirror(contracts);
      if (said !== undefined) for (const channel of news) said(channel);
    }
    for (const [good, pending] of this.purchases) if ((owned.get(`${OWNED_ROW.purchase}${String(good)}`) ?? 0) > pending.before) { this.purchases.delete(good); pending.confirmed(); }
  }
  /** A room's drifts as the server's rows have them: what this page's player walks on is what the server's does. */
  sandInto(ground: ArenaRoomGround, room: string): void {
    const { client } = this, frame = client?.latest ?? null;
    if (client === null || frame === null || frame.tick === this.sandTick) return;
    this.sandTick = frame.tick;
    const name = sandWireName(room), strips = this.sandStrips;
    ground.mirrorSand(strip => { strips[strip] ??= `${name}.${String(strip)}`; return client.stateField(frame, strips[strip]); });
    this.sandPeak = ground.sandPeak;
  }
  /** Put a cosmetic on or take it off: the server keeps what's worn. */
  wear(id: string): void { this.act({ kind: 'wear', seq: 0, id }); }
  /** A hand on the contract board: the server checks it and pays. */
  contract(op: 'claim' | 'tear', slot: number): void { this.act({ kind: 'board', seq: 0, op, slot }); }
  /** Buy a good; feedback waits until the server confirms the grant and its holdings have been mirrored. */
  buy(good: number, confirmed?: () => void): void {
    if (confirmed !== undefined) this.purchases.set(good, { before: this.line(`${OWNED_ROW.purchase}${String(good)}`), confirmed });
    this.act({ kind: 'buy', seq: 0, good });
  }
  /** One press of a prompt the server knows by this id. */
  send(id: string): void { this.press(id); }
  /** Use a server carcass; only its confirmed grant indices reach presentation. */
  harvest(scope: Scope, id: string, _kind: string, variant: string, confirmed: (items: readonly string[]) => void, declared?: readonly HarvestDrop[]): void {
    const client = this.client;if(client === null)return;
    const entity = [...client.entities.values()].find(info => this.rowBody(info.handle)?.entityId === id);
    if(entity === undefined)return;
    const word = `harvest.${entity.id}`, drops = declaredHarvestDrops(declared ?? [], variant);
    const off = client.onView(view => {
      if(view.name !== word)return;
      off();confirmed(view.args.flatMap(index => {const item = drops[index];return item === undefined ? [] : [item];}));
    });
    scope.onDispose(off);this.send(word);
  }
  /** A quest view for `def`, over this player's rows. */
  quest(def: QuestDef): QuestView {
    // SHARD-SOURCE AP19 (DEVSERVER): a quest whose declaration changed (`wildshard watch`'s soft restart) gets a feed of its new steps
    const words = typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ ? JSON.stringify(def) : '', held = this.feeds.get(def.id);
    const feed = held !== undefined && this.feedWords.get(def.id) === words ? held : new QuestViewFeed([def], { quests: this.quests, phased: this.heard });
    this.feeds.set(def.id, feed); this.feedWords.set(def.id, words);
    return feed.quest(def.id);
  }
  /** The server's payouts: the page's own go, so a kill pays once. */
  lootFeed(scope: Scope): LootFeed {
    return { debug: {}, onPayout: pay => {
      let off: (() => void) | undefined;
      this.whenLive(scope, client => { off = netLootFeed(client).onPayout(pay); return off; });
      return () => { off?.(); };
    } };
  }
  /** The declared facts the server grants this player, each once: its name, and the receipt that is its identity. */
  facts(scope: Scope, hear: (name: string, id: string) => void): void {
    this.whenLive(scope, client => client.onLedger(receipt => { if (receipt.grant === 'fact') hear(receipt.name, receipt.id); }));
  }
  /** The fights and lairs in this frame. */
  encounters(): readonly EncounterRow[] { return this.encounterRows?.() ?? NO_ROWS; }
  /** How many living creatures of `kind` are near this player, or null with no wire. */
  creatures(kind: string): number | null { return this.client === null ? null : netCreatureCount(this.client, kind); }
  /** What this frame's events changed: the server's flags and quest rows, then who they tell. `level` names the entered book, null any; `here` is false while a crossing is under way. */
  frame(level: string | null, here: boolean, clock: DayFollower | null = null): void {
    const { client } = this;
    if (client === null || client.latest === null || !here) return;
    this.followDay(clock, client); this.mirrorOwned(client, level);
    for (const [id, row] of client.quests) this.quests.set(id, row);
    const held = new Set([...client.flags(), ...client.phased]), now = client.latest.tick;
    this.heard.clear(); for (const flag of held) this.heard.add(flag); // a gate's flag may be the world's: a personal one comes as a `phase`
    for (const book of this.books) if (level === null || book.level.endsWith(level)) book.mirror(held, now);
    // What a save opened with is no news, and nor is a started quest a crossing comes back to: a world's first frame only says where things stand.
    if (this.seeded !== client.latest.cell) {
      this.seeded = client.latest.cell;
      for (const feed of this.feeds.values()) feed.settle();
      for (const then of this.settles) { this.settles.delete(then); then(); }
      for (const word of this.skyWords.values()) this.say(word);
      this.skyWords.delete('force');
      return;
    }
    for (const feed of this.feeds.values()) feed.sync();
  }
}
/** The seat. A page has one. */
export const wirePage: WirePage = new WirePage();

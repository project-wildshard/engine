// What a page reads in place of a sim of its own. Views install long before the server's first frame, so they take this seat at
// install and it fills when the wire does.
import type { Vector3 } from 'three';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
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

type Live = (client: NetClient) => (() => void) | undefined;
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
  /** Whether the server is carrying this player's body now. */
  led: () => boolean = () => false;
  /** A row's body on this page, by its handle. */
  rowBody: (body: number) => Animal | null = () => null;
  /** A row's body on this page, by the name the server gave it. */
  namedBody: (id: string) => Animal | null = () => null;
  private readonly dressers = new Map<object, (body: Animal) => void>();
  /** The head over a row's body, into `to`: what an elite's bar stands on. */
  readonly head: (body: number, to: Vector3) => boolean = (body, to) => this.heads(body, to);
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
  /** Count one thing drawn. */
  drew(what: string): void { this.drawn[what] = (this.drawn[what] ?? 0) + 1; }

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
  /** Every flag book this page makes from now on follows the server's. */
  followBooks(): void { Flags.made = book => { this.books.add(book); book.follow(flag => { if (flag.startsWith('seen:')) { this.send(flag); return; } if (flag.startsWith(TALKED)) this.send(`${flag.slice(TALKED.length)}.talk`); this.send(`${STORY_ACT}${flag}`); }); }; }
  /** The wire is up. `press` sends one `interact`. */
  bind(client: NetClient, press: (id: string) => void, stop: () => void, heads: (body: number, to: Vector3) => boolean, act: (act: NetRoomAct) => void = () => undefined): void {
    this.client = client; this.press = press; this.act = act; this.stop = stop; this.heads = heads; this.encounterRows = netEncounterFeed(client).rows;
    for (const use of this.waiting) use(client);
    this.waiting.clear();
  }
  unbind(): void { this.client = null; this.press = () => undefined; this.act = () => undefined; this.dayRow = undefined; this.stop = () => undefined; this.encounterRows = null; this.heads = () => false; this.seeded = null; this.purchases.clear(); this.books.clear(); this.feeds.clear(); this.movers.clear(); }
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
      drops?.(owned);
      if (finishes !== undefined) for (const [name] of owned) if (name.startsWith(OWNED_ROW.finish)) finishes.own(name.slice(OWNED_ROW.finish.length));
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
  /** A quest view for `def`, over this player's rows. */
  quest(def: QuestDef): QuestView {
    const feed = this.feeds.get(def.id) ?? new QuestViewFeed([def], { quests: this.quests, phased: this.heard });
    this.feeds.set(def.id, feed);
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
      for (const word of this.skyWords.values()) this.say(word);
      this.skyWords.delete('force');
      return;
    }
    for (const feed of this.feeds.values()) feed.sync();
  }
}
/** The seat. A page has one. */
export const wirePage: WirePage = new WirePage();

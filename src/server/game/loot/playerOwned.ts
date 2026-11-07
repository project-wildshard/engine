import * as v from 'valibot';
import { questBooks } from '@wildshard/engine/quest/players';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { LedgerFiling } from '@wildshard/engine/net/ledgerBook';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { encounterRows } from '@wildshard/engine/sim/encounterRows';
import type { SimHost } from '@wildshard/engine/sim';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { addInventory, takeInventory } from '../../../shared/game/inventoryLaw';
import { heldAmmunition } from '../loadout/nativeAmmunition';
import { Exchange } from '../../../shared/game/loot/exchange';
import { isCosmetic, isOwnedId, Owned } from '../../../shared/game/loot/Owned';
import { Purse } from '../../../shared/game/loot/Purse';
import { installOwnedEffects } from '../loadout/ownedEffects';
import { OWNED_ROW, WORN_LINE } from '../../../shared/game/loot/ownedRows';
import { inventorySave, ownedSave, purseSave, skinSave, compendiumSave, finishPickupSave, saveSlug, CreatureRewardSchema, creatureRewardSave, type CreatureRewardState } from '../../../shared/game/saves';

/**
 * Creature rewards are persistent player data, independent of a world continuation. E7 supplies this from each
 * authenticated player's OwnedSlots/PlayerDoc and flushes changes through its durable player-save path.
 *
 * NetWorld.identified binds a seat on hello and room handoff. The local worker accepts its device hello, while E7
 * must bind the verified session identity, reject a hello that changes it, and clear the binding when a seat is released.
 * Reconnect, another seat, room handoff, process restart and empty-cell retirement must keep the same player record.
 * The default local store and legacy shard-wide fallback are not dedicated-server identity or persistence services.
 *
 * Local workers write device-keyed creature-rewards on every kill/claim. Only the first local device inherits old
 * shard-wide saves and the old lead reward continuation. Old non-lead seat-only rows have no proven device binding;
 * migrating those on E7 requires a verified historical mapping, never the current occupant of the former seat.
 * syncPageRewards reconciles current cosmetics/discovery across localStorage and IndexedDB before boot; the
 * dedicated adapter instead reads its authoritative player document. J105 pays every meaningful contributor.
 */
export interface CreatureRewardStore {
  read: (identity: string) => CreatureRewardState | null;
  write: (identity: string, state: CreatureRewardState) => boolean;
}
const REWARDS = 'owned.creature-rewards';

/** A pack keeps what the server hands it: a slot limit is the giver's to check. */
const KEEPS_ALL = { has: (): boolean => true, keeps: (): boolean => true, slots: () => Number.MAX_SAFE_INTEGER };

/** Where one player's goods are kept. */
export interface OwnedSlots {
  readonly purse: Pick<typeof purseSave, 'read' | 'write'>;
  readonly owned: Pick<typeof ownedSave, 'read' | 'write'>;
  readonly inventory: Pick<typeof inventorySave, 'read' | 'write'>;
}
const SESSION_SLOTS: OwnedSlots = { purse: purseSave, owned: ownedSave, inventory: inventorySave };
/** Each player's slots, where players keep their own (E7.4): */
export type OwnedStores = (player: string) => OwnedSlots;

/**
 * What a player holds in one shard: its purse, its pack and its gear, in the saves a page kept them in, which the
 * server's session read in. Grants arrive as filings and purchases as acts, and clients read lines of it (J130: the server owns
 * these). A world whose quest keeps its own pack leaves its lines to that owner.
 */
export class PlayerOwned {
  readonly purse: Purse; readonly owned: Owned;
  private readonly slot: string;
  private readonly counts: Record<string, number>;
  private readonly order: string[];
  private exchange: Exchange | null = null;
  private readonly finishIds = new Set<string>();
  private readonly purchases = new Map<number, number>();
  private readonly inventory: OwnedSlots['inventory'];
  constructor(readonly shard: string, slots: OwnedSlots = SESSION_SLOTS, finishes: readonly string[] = []) {
    this.purse = new Purse(shard, slots.purse); this.owned = new Owned(shard, slots.owned); this.slot = saveSlug(shard); this.inventory = slots.inventory;
    const saved = slots.inventory.read(this.slot);
    this.counts = { ...saved.counts }; this.order = [...saved.order];
    for (const id of finishes) this.finishIds.add(id);
  }
  private savePack(): void { this.inventory.write({ counts: this.counts, order: this.order }, this.slot); }
  count(id: string): number { return this.counts[id] ?? 0; }
  add(id: string, n = 1): boolean {
    if (!addInventory({ counts: this.counts, order: this.order }, KEEPS_ALL, id, n)) return false;
    this.savePack(); return true;
  }
  take(id: string, n = 1): boolean {
    if (!takeInventory({ counts: this.counts, order: this.order }, id, n)) return false;
    this.savePack(); return true;
  }
  /** One grant the tick filed: coins to the purse, an item to the gear it names or the pack. */
  file(filing: Pick<LedgerFiling, 'grant' | 'name' | 'amount'>): void {
    if (filing.grant === 'coins') this.purse.add(filing.amount);
    else if (filing.grant === 'item') { if (this.finishIds.has(filing.name)) return; if (isOwnedId(filing.name)) this.owned.grant(filing.name); else this.add(filing.name, filing.amount); }
  }
  /** Death rewards belong to the server, including a drop no page has drawn yet. */
  creatures(host: SimHost, source: Shardfile, profiles?: CreatureRewardStore): void {
    const pickups = source.items.pickups ?? {}, slot = this.slot, lead = questBooks(host).lead.player, routes = actRoutes(host);
    // Validate historical world data during installation, where the continuation loader can reject it and fall back.
    const historical = profiles === undefined ? v.parse(v.record(v.string(), CreatureRewardSchema), host.slots.questState[REWARDS] ?? {})[lead] : undefined;
    const rewards = new Map<string, CreatureRewardState>();
    const persist = (identity: string, state: CreatureRewardState): void => {
      if (profiles !== undefined) { if (!profiles.write(identity, state)) throw new Error('Creature rewards could not be saved'); return; }
      const saved = creatureRewardSave.read(slot);
      saved.players[identity] = state;
      if (!creatureRewardSave.write(saved, slot)) throw new Error('Creature rewards could not be saved');
    };
    // The seat is only a route. Every read/write resolves the current persistent identity, so reuse cannot lend its rewards.
    const seat = (player: string): { identity: string; state: CreatureRewardState } | null => {
      const identity = routes.identities.get(player); if (identity === undefined) return null;
      const cached = rewards.get(identity); if (cached !== undefined) return { identity, state: cached };
      const saved = creatureRewardSave.read(slot), stored = profiles === undefined ? saved.players[identity] : profiles.read(identity);
      const state: CreatureRewardState = stored === undefined || stored === null ? { finishes: [], pending: {}, journal: {} } : v.parse(CreatureRewardSchema, stored);
      // Only this device may import historical shard-wide progress. E7 profiles never inherit an arbitrary world seat.
      if (profiles === undefined && (saved.legacyOwner === identity || saved.legacyOwner === null && player === lead)) {
        if (saved.legacyOwner === null) {
          saved.legacyOwner = identity;
          if (!creatureRewardSave.write(saved, slot)) throw new Error('Creature reward owner could not be saved');
        }
        state.finishes = [...new Set([...state.finishes, ...historical?.finishes ?? [], ...skinSave.read(slot).owned])];
        state.pending = { ...historical?.pending, ...finishPickupSave.read(slot), ...state.pending };
        for (const [id, entry] of [...Object.entries(historical?.journal ?? {}), ...Object.entries(compendiumSave.read(slot))]) {
          const stats = state.journal[id];
          state.journal[id] = stats === undefined ? entry : { s: Math.max(stats.s, entry.s), n: Math.max(stats.n, entry.n),
            t: Math.max(stats.t, entry.t), b: Math.max(stats.b, entry.b) };
        }
      }
      for (const id of state.finishes) delete state.pending[id];
      rewards.set(identity, state); persist(identity, state);
      return { identity, state };
    };
    for (const id of Object.keys(pickups)) this.finishIds.add(id);
    const journals = source.rows.compendiums.flatMap(row => 'kind' in row ? row.entries : []);
    const deaths = new Set<string>();
    for (const id of Object.keys(pickups)) actRoutes(host).claims.set(`finish.claim.${id}`, player => {
      const owner = seat(player); if (owner === null) return;
      const { state, identity } = owner, at = state.pending[id], feet = host.players.get(player)?.position;
      if (at === undefined || feet === undefined || Math.hypot(feet.x - at.x, feet.z - at.z) > 4 || Math.abs(feet.y - at.y) > 6) return;
      if (!state.finishes.includes(id)) state.finishes.push(id);
      delete state.pending[id];
      persist(identity, state);
    });
    host.events.on('actor.died', ({ actor }) => {
      const body = host.entities.get(actor.id);
      if (body === undefined || deaths.has(actor.id)) return;
      deaths.add(actor.id);
      // Read before personal loot consumes DamageBook at its default-order death listener (J105).
      const eligible = host.damage.meaningful(actor.id);
      const matched = journals.filter(entry => entry.match?.kind === body.kind && (entry.match.variants === undefined || entry.match.variants.includes(body.variant)));
      const mass = matched.find(entry => entry.massKg !== undefined)?.massKg ?? 0;
      const elite = [...encounterRows(host).values()].some(read => { const row = read(); return row.kind === 'elite' && row.body === actor.id; });
      for (const player of eligible) {
        const owner = seat(player); if (owner === null) continue;
        const { state, identity } = owner, { journal, pending, finishes } = state;
        for (const entry of matched) {
          const stats = journal[entry.id] ?? { s: 0, n: 0, t: 0, b: 0 };
          journal[entry.id] = { ...stats, s: 3, t: stats.t + 1, b: Math.max(stats.b, Math.round(mass * body.scale * body.scale * body.scale)) };
        }
        for (const [id, row] of Object.entries(pickups)) {
          const death = row.death;
          if (elite || death === undefined || death.kind !== body.kind || death.variant !== undefined && death.variant !== body.variant || finishes.includes(id) || pending[id] !== undefined) continue;
          const at = { x: body.position.x, y: body.position.y, z: body.position.z }, toward = death.towardPlayer;
          if (toward !== undefined) {
            const feet = host.players.get(player)?.position ?? body.position, distance = Math.hypot(at.x - feet.x, at.z - feet.z), ratio = distance > toward.epsilon ? Math.min(1, toward.distance / distance) : 0;
            at.x = feet.x + (at.x - feet.x) * ratio; at.z = feet.z + (at.z - feet.z) * ratio;
          }
          if (death.floor !== 'source') at.y = Math.max(at.y, host.groundHeightAt(at.x, at.z));
          pending[id] = at;
        }
        persist(identity, state);
      }
    }, host.scope, { order: -10 });
    host.events.on('actor.died', ({ actor }) => { host.damage.forget(actor.id); }, host.scope, { order: 10 });
    host.onStep('owned.creatures', () => { for (const id of deaths) if (host.entities.get(id)?.alive === true) deaths.delete(id); });
    publishOwned(host, 'creature-rewards', (player, out) => {
      const owner = seat(player); if (owner === null) return;
      const { finishes, pending, journal } = owner.state;
      for (const id of finishes) if (this.finishIds.has(id)) out.set(`${OWNED_ROW.finish}${id}`, 1);
      for (const [id, at] of Object.entries(pending)) if (!finishes.includes(id)) {
        out.set(`${OWNED_ROW.drop}${id}`, 1);
        out.set(`${OWNED_ROW.drop}${id}.x`, at.x); out.set(`${OWNED_ROW.drop}${id}.y`, at.y); out.set(`${OWNED_ROW.drop}${id}.z`, at.z);
      }
      for (const [id, stats] of Object.entries(journal)) {
        out.set(`${OWNED_ROW.journal}${id}.taken`, stats.t + 1); out.set(`${OWNED_ROW.journal}${id}.best`, stats.b + 1);
      }
    });
  }
  /** This world's exchange, over what this player holds. */
  trade(rows: unknown, extra: ReadonlyMap<string, unknown>): void {
    this.exchange = new Exchange(rows, new Map<string, unknown>([...extra, ['owned', this.owned], ['pack', this],
      ['purse', { count: () => this.purse.coins, spend: (n: number) => this.purse.spend(n) }]]));
  }
  /** One purchase: the rows check it, and an answer of no changes nothing. */
  buy(good: number): boolean {
    const { exchange } = this;
    if (exchange === null || exchange.rows.goods[good] === undefined) return false;
    exchange.open();
    try { const bought = exchange.use(good); if (bought) this.purchases.set(good, (this.purchases.get(good) ?? 0) + 1); return bought; } finally { exchange.close(); }
  }
  /** Lines for a client. */
  read(out: Map<string, number>, pack: boolean): void {
    for (const [good, count] of this.purchases) out.set(`${OWNED_ROW.purchase}${String(good)}`, count);
    out.set(OWNED_ROW.coins, this.purse.coins);
    if (pack) for (const id of this.order) out.set(`${OWNED_ROW.item}${id}`, this.counts[id] ?? 0);
    for (const id of this.owned.all) out.set(`${OWNED_ROW.owned}${id}`, isCosmetic(id) && this.owned.worn(id) ? WORN_LINE : 1);
  }
}

/** Who holds what in one world: one `PlayerOwned` a session, or one a player where each keeps their own. */
export interface OwnedBook { readonly of: (player: string) => PlayerOwned; /** A player left: what they held stays in their store, and this forgets it. */ readonly drop: (player: string) => void }

/** Put a world on the wire's owned rows. Any owner of a pack or a shop already in the world keeps them. A good of ammunition goes to the world's quiver, and a world with none has no room for it. */
export function installPlayerOwned(host: SimHost, shard: string, economy: unknown, pack: boolean, stores?: OwnedStores, source?: Shardfile, profiles?: CreatureRewardStore): OwnedBook {
  const routes = actRoutes(host), seats = new Map<string, PlayerOwned>(), shopped = economy !== null && economy !== undefined && routes.buy === null;
  const open = (slots?: OwnedSlots): PlayerOwned => {
    const owned = new PlayerOwned(shard, slots, Object.keys(source?.items.pickups ?? {}));
    if (shopped) owned.trade(economy, new Map<string, unknown>([['skins', { owns: (id: string) => owned.owned.has(id), own: (id: string) => { owned.owned.grant(id); } }], ['ammo', { capacity: (kind: string, n: number) => heldAmmunition(host)?.room(kind, n) ?? false, addBolts: (n: number) => { heldAmmunition(host)?.addBolts(n); }, grant: (kind: string, n: number) => { heldAmmunition(host)?.add(kind, n); } }]]));
    return owned;
  };
  const session = stores === undefined ? open() : null;
  if (source !== undefined && session !== null) installOwnedEffects(host, session.owned, source);
  if (source !== undefined) (session ?? new PlayerOwned(shard)).creatures(host, source, profiles);
  const of = (player: string): PlayerOwned => {
    if (session !== null) return session;
    let seat = seats.get(player);
    if (seat === undefined) { seat = open(stores?.(player)); seats.set(player, seat); }
    return seat;
  };
  publishOwned(host, 'player', (player, out) => { of(player).read(out, pack); });
  routes.wear = (player, id) => { const { owned } = of(player); if (isOwnedId(id) && isCosmetic(id) && owned.has(id)) owned.toggleWorn(id); };
  if (shopped) routes.buy = (player, good) => { of(player).buy(good); };
  return { of, drop: player => { seats.delete(player); } };
}

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
import { OWNED_ROW, WORN_LINE } from '../../../shared/game/loot/ownedRows';
import { inventorySave, skinSave, compendiumSave, finishPickupSave, saveSlug } from '../../../shared/game/saves';

/** A pack keeps what the server hands it: a slot limit is the giver's to check. */
const KEEPS_ALL = { has: (): boolean => true, keeps: (): boolean => true, slots: () => Number.MAX_SAFE_INTEGER };

/**
 * What the session's player holds in one shard: its purse, its pack and its gear, in the saves a page kept them in, which the
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
  constructor(readonly shard: string) {
    this.purse = new Purse(shard); this.owned = new Owned(shard); this.slot = saveSlug(shard);
    const saved = inventorySave.read(this.slot);
    this.counts = { ...saved.counts }; this.order = [...saved.order];
  }
  private savePack(): void { inventorySave.write({ counts: this.counts, order: this.order }, this.slot); }
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
  creatures(host: SimHost, source: Shardfile): void {
    const pickups = source.items.pickups ?? {}, slot = this.slot, pending = finishPickupSave.read(slot);
    for (const id of Object.keys(pickups)) this.finishIds.add(id);
    const journals = source.rows.compendiums.flatMap(row => 'kind' in row ? row.entries : []);
    const journal = compendiumSave.read(slot), deaths = new Set<string>();
    const owns = (id: string): boolean => skinSave.read(slot).owned.includes(id);
    const grant = (id: string): void => { const saved = skinSave.read(slot); if (!saved.owned.includes(id)) skinSave.write({ ...saved, owned: [...saved.owned, id] }, slot); };
    for (const id of Object.keys(pickups)) actRoutes(host).claims.set(`finish.claim.${id}`, player => {
      const at = pending[id], feet = host.players.get(player)?.position;
      if (at === undefined || feet === undefined || Math.hypot(feet.x - at.x, feet.z - at.z) > 4 || Math.abs(feet.y - at.y) > 6) return;
      grant(id); delete pending[id]; finishPickupSave.write(pending, slot);
    });
    host.events.on('actor.died', ({ actor }) => {
      const body = host.entities.get(actor.id);
      if (body === undefined || deaths.has(actor.id)) return;
      deaths.add(actor.id);
      const matched = journals.filter(entry => entry.match?.kind === body.kind && (entry.match.variants === undefined || entry.match.variants.includes(body.variant)));
      const mass = matched.find(entry => entry.massKg !== undefined)?.massKg ?? 0;
      for (const entry of matched) {
        const stats = journal[entry.id] ?? { s: 0, n: 0, t: 0, b: 0 };
        journal[entry.id] = { ...stats, s: 3, t: stats.t + 1, b: Math.max(stats.b, Math.round(mass * body.scale * body.scale * body.scale)) };
      }
      if (matched.length > 0) compendiumSave.write(journal, slot);
      if ([...encounterRows(host).values()].some(read => { const row = read(); return row.kind === 'elite' && row.body === actor.id; })) return;
      for (const [id, row] of Object.entries(pickups)) {
        const death = row.death;
        if (death === undefined || death.kind !== body.kind || death.variant !== undefined && death.variant !== body.variant || owns(id) || pending[id] !== undefined) continue;
        const at = { x: body.position.x, y: body.position.y, z: body.position.z }, toward = death.towardPlayer;
        if (toward !== undefined) {
          const player = host.nearestPlayer(body.position).position, distance = Math.hypot(at.x - player.x, at.z - player.z), ratio = distance > toward.epsilon ? Math.min(1, toward.distance / distance) : 0;
          at.x = player.x + (at.x - player.x) * ratio; at.z = player.z + (at.z - player.z) * ratio;
        }
        if (death.floor !== 'source') at.y = Math.max(at.y, host.groundHeightAt(at.x, at.z));
        pending[id] = at; finishPickupSave.write(pending, slot);
      }
    }, host.scope);
    host.onStep('owned.creatures', () => { for (const id of deaths) if (host.entities.get(id)?.alive === true) deaths.delete(id); });
    publishOwned(host, 'creature-rewards', (_player, out) => {
      for (const id of skinSave.read(slot).owned) if (this.finishIds.has(id)) out.set(`${OWNED_ROW.finish}${id}`, 1);
      for (const [id, at] of Object.entries(pending)) if (!owns(id)) {
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

/** Put a world on the wire's owned rows. Any owner of a pack or a shop already in the world keeps them. A good of ammunition goes to the world's quiver, and a world with none has no room for it. */
export function installPlayerOwned(host: SimHost, shard: string, economy: unknown, pack: boolean, source?: Shardfile): PlayerOwned {
  const owned = new PlayerOwned(shard), routes = actRoutes(host);
  if (source !== undefined) owned.creatures(host, source);
  publishOwned(host, 'player', (_player, out) => { owned.read(out, pack); });
  routes.wear = (_player, id) => { if (isOwnedId(id) && isCosmetic(id) && owned.owned.has(id)) owned.owned.toggleWorn(id); };
  if (economy !== null && economy !== undefined && routes.buy === null) {
    owned.trade(economy, new Map<string, unknown>([['skins', { owns: (id: string) => owned.owned.has(id), own: (id: string) => { owned.owned.grant(id); } }], ['ammo', { capacity: (kind: string, n: number) => heldAmmunition(host)?.room(kind, n) ?? false, addBolts: (n: number) => { heldAmmunition(host)?.addBolts(n); }, grant: (kind: string, n: number) => { heldAmmunition(host)?.add(kind, n); } }]]));
    routes.buy = (_player, good) => { owned.buy(good); };
  }
  return owned;
}

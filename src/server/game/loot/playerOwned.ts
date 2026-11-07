import type { LedgerFiling } from '@wildshard/engine/net/ledgerBook';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { SimHost } from '@wildshard/engine/sim';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { addInventory, takeInventory } from '../../../shared/game/inventoryLaw';
import { heldAmmunition } from '../loadout/nativeAmmunition';
import { Exchange } from '../../../shared/game/loot/exchange';
import { isCosmetic, isOwnedId, Owned } from '../../../shared/game/loot/Owned';
import { Purse } from '../../../shared/game/loot/Purse';
import { OWNED_ROW, WORN_LINE } from '../../../shared/game/loot/ownedRows';
import { inventorySave, saveSlug } from '../../../shared/game/saves';

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
    else if (filing.grant === 'item') { if (isOwnedId(filing.name)) this.owned.grant(filing.name); else this.add(filing.name, filing.amount); }
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
    try { return exchange.use(good); } finally { exchange.close(); }
  }
  /** Lines for a client. */
  read(out: Map<string, number>, pack: boolean): void {
    out.set(OWNED_ROW.coins, this.purse.coins);
    if (pack) for (const id of this.order) out.set(`${OWNED_ROW.item}${id}`, this.counts[id] ?? 0);
    for (const id of this.owned.all) out.set(`${OWNED_ROW.owned}${id}`, isCosmetic(id) && this.owned.worn(id) ? WORN_LINE : 1);
  }
}

/** Put a world on the wire's owned rows. Any owner of a pack or a shop already in the world keeps them. A good of ammunition goes to the world's quiver, and a world with none has no room for it. */
export function installPlayerOwned(host: SimHost, shard: string, economy: unknown, pack: boolean): PlayerOwned {
  const owned = new PlayerOwned(shard), routes = actRoutes(host);
  publishOwned(host, 'player', (_player, out) => { owned.read(out, pack); });
  routes.wear = (_player, id) => { if (isOwnedId(id) && isCosmetic(id) && owned.owned.has(id)) owned.owned.toggleWorn(id); };
  if (economy !== null && economy !== undefined && routes.buy === null) {
    owned.trade(economy, new Map<string, unknown>([['skins', { owns: (id: string) => owned.owned.has(id), own: (id: string) => { owned.owned.grant(id); } }], ['ammo', { capacity: (kind: string, n: number) => heldAmmunition(host)?.room(kind, n) ?? false, addBolts: (n: number) => { heldAmmunition(host)?.addBolts(n); }, grant: (kind: string, n: number) => { heldAmmunition(host)?.add(kind, n); } }]]));
    routes.buy = (_player, good) => { owned.buy(good); };
  }
  return owned;
}

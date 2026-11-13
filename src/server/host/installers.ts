// SERVER-PARITY SS3 (meta docs/plans/SERVER-PARITY-PLAN.md). SS2 (shard-format `featureSides`) gives every `client/plan`
// feature kind and `world.assembly` stage kind a side, and names, for a `both` or `server` kind, the key its server installer
// registers under. Each installer that builds a server half calls `registerInstalled(host, key)` (kept in
// src/server/game/shardfile/installedSides.ts, which the game's installers may import) when it actually builds one, so a
// booted room can say which of its product's server halves ran. `missingInstallers` lists the sided kinds whose key no
// installer registered: NET-LAG NL5's rope bridge (a page-built `rope-deck` the room never built) is that shape.
import { CLIENT_FEATURE_SIDES, WORLD_ASSEMBLY_STAGE_SIDES, type SideEntry } from '@wildshard/format/featureSides';
import type { ServerInstallerKey } from '@wildshard/engine/game/shardfile/installedSides';
import type { ShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';

/** Every SS2 server key, and the engine owner(s) that register it. A key SS2 adds without an entry here fails
 *  `test/side-installers.test.ts`. */
export const SERVER_INSTALLERS: Readonly<Record<ServerInstallerKey, string>> = Object.freeze({
  arenaRoom: 'native assembly `boss.arena` (a room)',
  collision: 'native assembly `collision` / `collision.pieces`, the runtime-plan world, a data cell\'s simulation when it built prop solids',
  fallFloor: 'standalone/cellWorld.ts `FallFloor` over `shardPlayArea`; a lone resident\'s `residentFallNet`',
  grapple: 'native assembly `grapple`',
  harvest: 'native assembly `installNativeHarvest` (a pack inventory)',
  heldArms: 'native assembly `held.arms` (a room), `item.swept` (the swept kit the page\'s held claims arm)',
  heldBoss: 'the runtime-plan world\'s boss encounter',
  heldRanged: 'native assembly `item.ranged`',
  keepsakes: 'loot/keepsakeProgression.ts `installKeepsakeProgression` (each player\'s progression rewards, from installPlayerOwned)',
  loadout: 'native assembly `loadout`, `held.arms` and `item.swept` (each owns the equip route)',
  melee: 'the runtime-plan held melee',
  movers: 'headlessRuntime.ts carried and moored movers, or the plan\'s own mover motion',
  places: 'headlessRuntime.ts room respawn places, standalone/cellWorld.ts discoveries',
  portalRide: 'native assembly `portal.ride`',
  // one key for every `view.program` row: a page-only pose (Driftwood's bridge sway, Nine Dragon's movers) stays a KNOWN line until HS6
  poseViews: 'native assembly `encounter.patrol` slots and `boss.open-arena`',
  questComposition: 'native assembly `quest.composition`',
  questHost: 'the runtime-plan declared quest host',
  ropeDecks: 'ropeDecks.ts `installRopeDecks`',
  saves: 'quest/serverChapters.ts (each player\'s feat counts and bond), quest/chapterRecords.ts (the open arena\'s boss record)',
  slots: 'native assembly `encounter.patrol` slots (a room)',
  stealth: 'native assembly `held.arms` stealth (a room, SS4)',
  windElite: 'native assembly `encounter.patrol` wind elite (a room)',
});

/** One sided kind in a product: where it is declared, its kind, and the key of the server half it needs. */
export interface ServerSide { readonly where: 'client/plan' | 'world.assembly'; readonly kind: string; readonly key: string }
const serverKey = (entry: SideEntry | undefined): string | null => entry === undefined || entry.side === 'view' ? null : entry.server;

/** Every `both` or `server` kind a product's `client/plan` declares, once each. A product with no plan has none. */
export function serverSides(product: Pick<ShardProduct, 'has' | 'section'>): readonly ServerSide[] {
  if (!product.has('client/plan')) return [];
  const out = new Map<string, ServerSide>(), add = (where: ServerSide['where'], kind: string, entry: SideEntry | undefined): void => {
    // admission (SS2) refuses an unsided kind, so a kind with no entry never reaches a room
    if (entry === undefined) throw new Error(`Unsided ${where} kind ${kind}`);
    const key = serverKey(entry);
    if (key !== null) out.set(`${where} ${kind}`, { where, kind, key });
  };
  for (const feature of product.section('client/plan').features) {
    add('client/plan', feature.kind, CLIENT_FEATURE_SIDES[feature.kind]);
    if (feature.kind === 'world.assembly') for (const stage of feature.rows.stages) add('world.assembly', stage.kind, WORLD_ASSEMBLY_STAGE_SIDES[stage.kind]);
  }
  return [...out.values()];
}

/** Each sided kind of `product` whose server key is not in `keys` (a booted host's `installedKeys`), as `<where> <kind> (<key>)`. */
export function missingInstallers(product: Pick<ShardProduct, 'has' | 'section'>, keys: ReadonlySet<string>): readonly string[] {
  return serverSides(product).filter(side => !keys.has(side.key)).map(side => `${side.where} ${side.kind} (${side.key})`);
}

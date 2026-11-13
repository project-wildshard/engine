// SERVER-PARITY SS3b: Driftwood's sea glass charms in a room. The page's keepsakes grant each progression state's rewards as a
// player's glass flags count up (5 glass: Sea glass charm I, +10 max health); the room's owned book, the one its effects read,
// never had them. Each seated player is now paid off their own book's flags, by the page's own law (`progressionState`).
// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { SaveStore } from '../src/shared/engine/saves/store';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { progressionState } from '../src/shared/game/compendium/keepsakeProgression';
import { declaredLootEconomy } from '../src/shared/game/shard/declaredRows';
import type { OwnedSlots } from '../src/server/game/loot/playerOwned';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { installedKeys } from '../src/server/game/shardfile/installedSides';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';

/** One player's goods, kept in memory: each seat its own, as a dedicated room keeps them. */
function memorySlots(): OwnedSlots {
  const slot = <T>(initial: T): { read: () => T; write: (value: T) => boolean } => { let held = initial; return { read: () => held, write: value => { held = value; return true; } }; };
  return { purse: slot(0), owned: slot({ owned: [] as string[], worn: [] as string[] }), inventory: slot({ counts: {} as Record<string, number>, order: [] as string[] }) };
}

/** Driftwood as a room whose goods are kept per seat; `open` says whose goods may be read (a dedicated room throws for an empty seat). */
async function driftwood(open: (player: string) => boolean = () => true) {
  const directory = builtProduct('driftwood-isle'), product = await loadHeadlessProduct(directory), stores = new Map<string, OwnedSlots>();
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const world = await openCellWorld({ instance: 'driftwood-isle' }, { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier }, undefined,
    { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true, owned: player => {
      if (!open(player)) throw new Error(`No seat for ${player}`);
      const held = stores.get(player) ?? memorySlots(); stores.set(player, held); return held;
    } });
  const page = declaredLootEconomy(product.shardfile.rows.loot).progression, charms = [...new Set(page.states.flatMap(state => state.earned.map(reward => reward.id)))];
  return { world, page, stores,
    // the page's law over the same flags: what its keepsakes grant a player holding `n` glass
    earned: (n: number): readonly string[] => progressionState(page, flag => page.flags.indexOf(flag) < n).earned.map(reward => reward.id),
    owns: (player: string): readonly string[] => charms.filter(id => world.owned.of(player).owned.has(id)) };
}

test('in a room each player earns the sea glass charms their own glass pays, as the page grants them', { timeout: 120_000 }, async () => {
  const { world, page, earned, owns } = await driftwood();
  try {
    const { host } = world, lead = leadPlayer(host), books = questBooks(host);
    const second = host.addPlayer('bot:1', { x: lead.position.x + 3, y: lead.position.y, z: lead.position.z }), third = host.addPlayer('bot:2', { x: lead.position.x - 3, y: lead.position.y, z: lead.position.z });
    expect(page.flags.every(flag => books.personal(flag)), 'a room\'s glass is each player\'s own').toBe(true);
    const base = second.health.attributes.maxHealth;
    const glass = (player: string, n: number): void => { for (const flag of page.flags.slice(0, n)) books.of(player).flags.set(flag); host.step(); };
    expect(owns(second.id)).toEqual([]);
    glass(second.id, 4);
    expect(owns(second.id), 'four glass is no charm').toEqual(earned(4));
    expect(earned(4)).toEqual([]);
    glass(second.id, 5);
    expect(owns(second.id), 'five glass: the page\'s charm, on the server').toEqual(earned(5));
    expect(earned(5)).toEqual(['charm-1']);
    expect(second.health.attributes.maxHealth, 'and the charm\'s +10 max health, which the server\'s effects read').toBe(base + 10);
    expect(owns(lead.id), 'the first player found none, and has none').toEqual([]);
    glass(second.id, 10);
    expect(owns(second.id)).toEqual(earned(10));
    expect(earned(10)).toEqual(['charm-1', 'charm-2']);
    glass(lead.id, 5);
    expect(owns(lead.id), 'the first player\'s own five glass pay them too').toEqual(['charm-1']);
    expect(owns(third.id), 'and nobody else').toEqual([]);
    expect(installedKeys(host).has('keepsakes'), 'the room installs the keepsakes\' server half').toBe(true);
  } finally { world.dispose(); }
});

test('a seat is paid only once someone sits in it, from a save it imports, and afresh after a leave', { timeout: 120_000 }, async () => {
  const seated = new Set<string>(), { world, page, stores, earned, owns } = await driftwood(player => seated.has(player));
  try {
    const { host } = world, lead = leadPlayer(host), books = questBooks(host);
    for (let i = 0; i < 3; i++) host.step(); // nobody sits yet: the parked lead body's goods are never opened
    const guest = host.addPlayer('bot:1', { x: lead.position.x + 3, y: lead.position.y, z: lead.position.z });
    seated.add(guest.id); world.owned.of(guest.id);
    books.importOf(guest.id, { ...books.exportOf(guest.id), flags: page.flags.slice(0, 5) }); // a returning player's save
    host.step();
    expect(owns(guest.id), 'saved glass pays on its import').toEqual(earned(5));
    world.owned.drop(guest.id); stores.delete(guest.id);
    world.owned.of(guest.id);
    host.step();
    expect(owns(guest.id), 'the next occupant of that body is paid off its book, afresh').toEqual(earned(5));
  } finally { world.dispose(); }
});

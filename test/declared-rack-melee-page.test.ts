import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import type { ItemPorts } from '../src/shared/engine/combat/items';
import { declaredKitItemFamilies } from '../src/client/game/plugin/weaponFamily';
import { installDeclaredItems, rackMeleeRows } from '../src/shared/game/shardfile/items';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-E4b, the page's half of TC-E4: Mossgate's iron sword starts on its rack. The server refused its blows until
// the rack's take, but the page's kit unlocked it with the whip, so slot 2 drew the sword at spawn (WebKit probe, engine
// fafee64e, 2026-11-16). A racked melee row now starts locked on the page, as a lever does, until its taken line unlocks it.
test('a racked melee weapon starts locked in the page\'s kit; the loadout primary does not', { timeout: 60_000 }, async () => {
  const shard = (await loadHeadlessFolder(builtFolder('_template'))).shardfile;
  const racked = rackMeleeRows(shard), primary = shard.items.loadout.primary;
  expect([...racked]).toEqual(['weapon.sword-iron']);
  const scope = new Scope('page'), aim = { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const input = { bind: () => undefined, held: () => false, register: () => undefined, has: () => true };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The kit's runtimes strike at nothing here.
  const runtime = (row: { readonly hook: unknown }): ItemPorts => ({ actor: { id: 'actor.player', alive: true }, combat: { hit: () => null }, targets: () => [], hook: row.hook === null ? null : (command: { action: number }) => command.action, effect: () => undefined, active: () => true }) as unknown as ItemPorts;
  const items = installDeclaredItems(shard.items, { scope, actorId: 'actor.player', input, families: declaredKitItemFamilies(), icon: () => 'sword' as never, aim: () => aim, runtime, racked,
    observation: { mode: 'foot', item: null, flags: [] } });
  const weapons = [items.primary, items.secondary, ...items.extras].filter(weapon => weapon !== null);
  const first = weapons[0]; if (first === undefined) throw new Error('Template holds weapons');
  const kit = new EquipmentService(first, { scope });
  for (const weapon of weapons) if (weapon !== first) kit.add(weapon, { locked: true });
  items.install(kit);
  const id = (row: string | null): string => { const weapon = weapons.find(entry => entry.row.id === row); if (weapon === undefined) throw new Error(`Missing ${String(row)}`); return String(weapon.id); };
  expect(kit.has(id(primary) as never)).toBe(true);
  expect(kit.has(id('weapon.sword-iron') as never)).toBe(false);
  kit.select(id('weapon.sword-iron') as never, true);
  expect(kit.current.row.id).toBe(primary);
  scope.dispose();
});

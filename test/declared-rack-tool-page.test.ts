import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '../src/shared/engine/app/scope';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import type { ItemPorts } from '../src/shared/engine/combat/items';
import { declaredKitItemFamilies } from '../src/client/game/plugin/weaponFamily';
import { installDeclaredItems, rackMeleeRows, rackToolRows } from '../src/shared/game/shardfile/items';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// SHARD-SOURCE SS-GF1a1a, the page's half: a lantern on a stand is in the page's kit locked (not drawn, not used) until its
// taken line (or, off the wire, its stand's scene) unlocks it; a lantern the loadout carries is in hand from the start.
const LANTERN = 'tool.template-lantern';
test('a tool on a stand starts locked in the page\'s kit and works once unlocked', { timeout: 60_000 }, async () => {
  const base = (await loadHeadlessFolder(builtFolder('_template'))).shardfile;
  const shard: Shardfile = { ...base, items: { ...base.items, loadout: { ...base.items.loadout, tools: base.items.loadout.tools.filter(id => id !== LANTERN) } },
    targets: { ...base.targets, itemActions: [...(base.targets.itemActions ?? []).filter(row => row.item !== LANTERN || row.action !== 3), { scene: 'fixture.lantern-rack.take', item: LANTERN, action: 3 }] } };
  const scope = new Scope('page'), aim = { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const input = { bind: () => undefined, held: () => false, register: () => undefined, has: () => true };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The kit's runtimes strike at nothing here.
  const runtime = (row: { readonly hook: unknown }): ItemPorts => ({ actor: { id: 'actor.player', alive: true }, combat: { hit: () => null }, targets: () => [], hook: row.hook === null ? null : (command: { action: number }) => command.action, effect: () => undefined, active: () => true }) as unknown as ItemPorts;
  const kitFor = (source: Shardfile): { kit: EquipmentService; tool: { readonly id: unknown; enabled: boolean } } => {
    const items = installDeclaredItems(source.items, { scope, actorId: 'actor.player', input, families: declaredKitItemFamilies(), icon: () => 'sword' as never, aim: () => aim, runtime,
      racked: new Set([...rackMeleeRows(source), ...rackToolRows(source)]), observation: { mode: 'foot', item: null, flags: [] } });
    const weapons = [items.primary, items.secondary, ...items.extras].filter(weapon => weapon !== null);
    const first = weapons[0]; if (first === undefined) throw new Error('Template holds weapons');
    const kit = new EquipmentService(first, { scope });
    for (const weapon of weapons) if (weapon !== first) kit.add(weapon, { locked: true });
    items.install(kit); kit.enabled = true;
    const tool = items.tools.find(entry => entry.row.id === LANTERN); if (tool === undefined) throw new Error('Template has a lantern');
    return { kit, tool };
  };
  const stand = kitFor(shard);
  expect(stand.kit.has(stand.tool.id as never)).toBe(false);
  expect(stand.tool.enabled).toBe(false);
  stand.kit.unlock(stand.tool.id as never); // the taken line's (or the stand's scene's) unlock
  expect(stand.tool.enabled).toBe(true);
  const carried = kitFor(base);
  expect(carried.kit.has(carried.tool.id as never)).toBe(true);
  scope.dispose();
});

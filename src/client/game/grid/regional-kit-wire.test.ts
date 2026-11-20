// @vitest-environment node
// ONE-FORMAT OF19d: on the grid the Dunes whip cracked the crank on the page alone. The regional kit kept its own contacts, so
// the server, whose crack rows wait on the weapon's own lash, never heard the heavy crack and refused the well's oil silently.
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
// oxlint-disable-next-line import/no-nodejs-modules -- The pinned products' section index on disk.
import { readFileSync } from 'node:fs';
import { builtFolder } from '../../../test/game/builtFolder';
import { EmptyEquipment } from '../shardfile/emptyEquipment';
import { EnteredEquipment } from './enteredEquipment';
import { regionalKitOnWire } from './regionalKitWire';

type Wire = Parameters<EquipmentService['bindWire']>[0];
/** A pinned product's section index and bound runtime, as its folder's `has` and `shardfile` read them. */
const product = (slug: string): Parameters<typeof regionalKitOnWire>[0] => {
  const index = JSON.parse(readFileSync(`${builtFolder(slug)}/shard.json`, 'utf8')) as { sections: { name: string }[]; runtime: unknown };
  const names = new Set(index.sections.map(row => row.name));
  return { has: name => names.has(name), shardfile: { runtime: index.runtime ?? null } as Parameters<typeof regionalKitOnWire>[0]['shardfile'] };
};

test('a regional kit whose server runs its weapon takes the road\'s wire; one whose server holds none keeps its own contacts', () => {
  const dunes = product('sunscar-dunes'), brasscap = product('brasscap-mesa');
  expect(regionalKitOnWire(dunes), 'Dunes\' runtime plan holds the whip on the server').toBe(true);
  expect(regionalKitOnWire(brasscap)).toBe(false);
  // mini-dw-play: a native-assembly cell's server swings its sword; off the wire no Driftwood crab ever took a hit on the grid
  expect(regionalKitOnWire(product('driftwood-isle')), 'Driftwood\'s native assembly holds the sword on the server').toBe(true);
  const scope = new Scope('regional-kit-wire');
  try {
    const road = new EquipmentService(new EmptyEquipment(), { scope }), wire = { equip: () => undefined } as unknown as Wire;
    road.bindWire(wire);
    const controls = new EnteredEquipment(road), kit = new EquipmentService(new EmptyEquipment(), { scope }), entry = scope.child('entered');
    controls.bind(kit, entry, { wire: regionalKitOnWire(dunes) });
    expect(kit.current.wire, 'the whip\'s presses go to the server').toBe(wire);
    entry.dispose();
    expect(kit.current.wire, 'leaving hands the wire back to the road').toBeNull();
    expect(road.current.wire).toBe(wire);
  } finally { scope.dispose(); }
});

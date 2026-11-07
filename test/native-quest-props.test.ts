// oxlint-disable-next-line import/no-nodejs-modules -- Native prop ownership exercises the shipped physics binary.
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { addPiece } from '../src/shared/engine/physics/pieces';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { NativeQuestProps } from '../src/shared/game/quest/nativeProps';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// The barrel's own save regressions (old-save adoption, migrated restore) are test/driftwood-barrel-saves.test.ts (G566).
test('salt-marsh physical quest props own drops, floor layers and same-tick latches', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  const gate = addPiece(host.physics, { id: 'marsh.gate', name: 'Sluice', category: 'props', file: 'fixture', colliders: [
    { kind: 'box', x: 8, y: 1.5, z: 0, hx: .5, hy: 1.5, hz: .2 },
  ] }).colliders[0];
  const rows = { floors: [{ x: 0, z: 0, step: 2, width: 3, height: 3, values: Array.from({ length: 9 }, () => 3) }],
    drops: [{ id: 'reed-token', kind: 'boar' }],
    gates: [{ flag: 'open:marsh.gate', box: { x: 8, z: 0, hw: .5, hd: .2, yTop: 3, yBottom: 0 } }],
  };
  try {
    const props = new NativeQuestProps(host, rows, false);
    expect(props.dropAt('reed-token')).toBeNull();
    const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing native drop body');
    const fallen = host.spawn({ ...sample, at: { x: 2, y: 3, z: 2 } });
    host.combat.hit({ source: 'env', sourceTags: [], target: fallen.combatActor(), amount: 10000, point: fallen.position, dir: fallen.position.clone() });
    host.events.flush('fixed.post');
    expect(props.dropAt('reed-token')).toEqual({ x: 2, y: 3, z: 2 });
    props.restoreDrop('reed-token', { x: -2, y: 0, z: 1 });
    expect(props.dropAt('reed-token')).toEqual({ x: -2, y: 0, z: 1 });
    expect(() => props.restoreDrop('reed-token', { x: Infinity, y: 0, z: 1 })).toThrow();
    expect(() => props.restoreDrop('missing', null)).toThrow();
    host.retire(fallen.entityId);
    if (gate === undefined) throw new Error('Missing native gate');
    expect(props.floorAt(2, 2)).toBe(3); expect(props.floorAt(-10, -10)).toBe(0);
    expect(gate.isEnabled()).toBe(true); host.flags.set('open:marsh.gate'); props.syncGates(); expect(gate.isEnabled()).toBe(false);
    // no declared body: the envelope stays null, and a saved body refuses
    expect(props.snapshot('north')).toBeNull(); props.restore('north', null);
    expect(() => props.restore('north', { handle: 1, watch: { lost: 0, wedge: 0, from: { x: 0, y: 0, z: 0 } } })).toThrow('continuation');
    expect(() => new NativeQuestProps(host, { ...rows, bodies: [{ owner: 'north', body: 'barrel' }] }, false)).toThrow('declared body authority');
    expect(() => new NativeQuestProps(host, { ...rows, floors: [{ ...rows.floors[0], values: [] }] }, false)).toThrow('rows');
  } finally { host.dispose(); }
});

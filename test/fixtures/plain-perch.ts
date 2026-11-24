import { parse, object, unknown, looseObject } from 'valibot';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { groundFixture } from './plain-ground';
import { liveReturnInline } from './returnPrograms';
import { liveJson } from './livePin';

// ZONE-SNAPSHOTS ZS9 (J507): Driftwood's live monkey perch policy and enemy volley pool.
const perch = parse(object({ perch: unknown() }), liveJson('driftwood-isle', 'poses/monkey.json')).perch;
const volley = parse(object({ volley: unknown() }), liveJson('driftwood-isle', 'sim/enemy-placement.json')).volley;
/** Original native root/action and real admitted VM bytes in an unrelated plain body. */
export function perchFixture() {
  const base = groundFixture();
  const bite = base.rows.strikes[0];
  if (bite === undefined) throw new Error('Missing fixture bite');
  const rows = { ...base.rows, strikes: [...base.rows.strikes, { ...bite, id: 'fixture.throw', damage: 5 }] };
  const creatures = parse(CreaturesSchema, {
    perchBodies: [{ id: 'fixture.perch', sites: [{ at: [0, 5, 7], base: [0, 0, 7] }],
      program: structuredClone(liveReturnInline), policy: { ...parse(looseObject({}), perch), kind: 'fixture.creature', strike: 'fixture.bite' },
      projectile: { strike: 'fixture.throw', pool: volley,
        launch: { kind: 'target', speed: 8, time: [0.3, 2], gravity: 9.8, rotation: [0, 0, 0] } } }],
    brains: [{ id: 'fixture.brain', kind: 'perch-hunter', thinkDivisor: 3,
      throwRadius: 18, throwDuration: 0.8, biteRadius: 2, biteDuration: 0.8, underRadius: 2, underSeconds: 0.5,
      holdRadius: 3, runSpeed: 3, activeGroundSeconds: 3, biteCooldown: 1, throwCooldownMin: 1, throwCooldownMax: 2,
      alertCue: 'alert', noticeCue: 'notice' }], groups: [],
    spawns: base.creatures.spawns.map(row => ({ ...row, perchBody: 'fixture.perch', home: { x: 0, y: 0, z: 7, r: 45 } })),
  });
  return { ...base, rows, creatures };
}

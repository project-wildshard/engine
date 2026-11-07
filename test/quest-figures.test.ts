import { expect, test } from 'vitest';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';
import * as v from 'valibot';
import { Group, Vector3 } from 'three';
import { QuestFiguresSchema } from '@wildshard/format/questFigures';
import { fireInFigureFrame } from '../src/client/game/quest/figures';

// Driftwood's castaway rows by shape: parts by fixed-draw slot, the camp and the fire's objects at the fire.
const row = { id: 'castaway', kit: 'castaway', feet: { poi: 'hut', x: 3, z: -2, yaw: 0.7 }, fire: { poi: 'hut', x: 4.5, z: -1.1, y: 0.25 },
  parts: { body: 'npcCastawayBody', camp: 'npcCastawayCamp' }, campAt: 'fire',
  objects: [{ kind: 'basic-mesh', id: 'flames', name: 'castaway-flame', draw: 'npcCastawayFlames', colour: [1.8, 1.8, 1.8], vertexColors: true, at: 'fire', lift: 0.08 },
    { kind: 'cloud', id: 'smoke', name: 'castaway-smoke', draw: 'castawaySmoke', look: 'smoke', at: 'fire', center: [0, 1, 0], radius: 2, order: 3, seeds: false }],
  publish: [{ id: 'castaway.fitted-head', draw: 'wendellHead' }], system: { id: 'pose', before: ['talks'] } };

test('figure rows admit the castaway shape and refuse an unknown object kind', () => {
  expect(v.parse(QuestFiguresSchema, { figures: [row] }).figures[0]?.objects).toHaveLength(2);
  expect(v.safeParse(QuestFiguresSchema, { figures: [{ ...row, objects: [{ ...row.objects[0], kind: 'script' }] }] }).success).toBe(false);
  expect(v.safeParse(QuestFiguresSchema, { figures: [row, { ...row, id: 'castaway-2' }] }).success).toBe(false); // one live figure per kit
});

test('the fire sits in the figure frame exactly where the castaway camp put it', () => {
  for (let i = 0; i < 64; i++) {
    const feet = { x: Math.sin(i) * 9, y: 0.3 * Math.cos(i), z: Math.cos(i * 1.7) * 7, yaw: i * 0.37 - 6 }, fire = { x: feet.x + Math.sin(i * 2.3) * 2, y: feet.y + 0.2, z: feet.z + Math.cos(i * 0.9) * 2 };
    const local = fireInFigureFrame(feet, fire), group = new Group();
    group.position.set(feet.x, feet.y, feet.z); group.rotation.y = feet.yaw; group.updateMatrixWorld(true);
    const world = local.clone().applyMatrix4(group.matrixWorld);
    expect(world.distanceTo(new Vector3(fire.x, fire.y, fire.z))).toBeLessThan(1e-9);
  }
});

test('named figure admission emits and enforces the same sixteen-part bound', () => {
  const schema = namedJsonSchema(QuestFiguresSchema), valid = { figures: [row] };
  const encode = (input: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(input));
  expect(validateNamedJsonSchema(schema, encode(valid))).toEqual(v.parse(QuestFiguresSchema, valid));
  const invalid = { figures: [{ ...row, parts: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`part${i}`, `draw${i}`])) }] };
  expect(v.safeParse(QuestFiguresSchema, invalid).success).toBe(false);
  expect(() => validateNamedJsonSchema(schema, encode(invalid))).toThrow();
});

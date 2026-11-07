import { expect, test } from 'vitest';
import * as v from 'valibot';
import { ForestNativeInputsSchema } from '@wildshard/format/forestNativeInputs';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { registeredJsonContract, validateRegisteredJson } from '@wildshard/format/registeredJson';
import { namedJsonSchema, registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const name = 'data/physics.generated.json';
const source = '@wildshard/format/forestNativeInputs#ForestNativeInputsSchema';
const good = { version: 1, profile: 'native', notice: 'Original owner facts',
  kingHit: { head: [0, 2, 1], body: [[0, 1, -1], [0, 2, 0]], fore: [[-.2, 2, 1], [.2, 2, 1]], ribs: [0, 1, 1], radius: .4 },
  trees: [[0, 0, 1]], shelterTrees: [[0, 0, 1, 1, .5]],
  pieces: [{ id: 'paths', name: 'Paths', category: 'ground', file: 'physics/paths', colliders: 31, active: true, surface: 'ground' }] };

test('G1004 admits the complete forest owner facts with the maintained native fixture as reader', () => {
  const before = JSON.stringify(good), value = structuredClone(good);
  expect(registeredJsonContract(name)?.schema).toBe(ForestNativeInputsSchema);
  expect(platformFileFamily(name, source)?.reader).toBe('src/game/shardfile/nativeAssembly.ts');
  expect(validatePlatformFile(name, source, value)).toBeDefined();
  validateRegisteredJson(name, value);
  expect(JSON.stringify(value)).toBe(before);
  const schema = registeredJsonSchema(name);
  expect(schema).toEqual({ ...namedJsonSchema(ForestNativeInputsSchema), $comment: source });
  expect(() => validateNamedJsonSchema(schema, new TextEncoder().encode(before))).not.toThrow();
});

test('the full forest root retains bounds and refuses opaque owner fields', () => {
  for (const value of [{ ...good, callback: true }, { ...good, version: 2 },
    { ...good, kingHit: { ...good.kingHit, radius: 0 } }, { ...good, trees: [[0, 0, -1]] },
    { ...good, shelterTrees: [[0, 0, 1, 1, 2]] }, { ...good, pieces: [{ ...good.pieces[0], surface: 'private' }] },
    { ...good, pieces: [{ ...good.pieces[0], colliders: -1 }] },
    { ...good, pieces: [{ ...good.pieces[0], follows: { matrix: [1], rotation: true } }] },
    { ...good, pieces: [{ ...good.pieces[0], callback: () => 1 }] }]) {
    expect(v.safeParse(ForestNativeInputsSchema, value).success).toBe(false);
  }
  const { pieces: _pieces, ...partial } = good;
  expect(v.safeParse(ForestNativeInputsSchema, partial).success).toBe(false);
});

test('forest approval grants only the exact name and defining schema provenance', () => {
  for (const file of ['data/physics.private.json', 'data/private/physics.generated.json']) {
    expect(platformFileFamily(file, source)).toBeUndefined();
    expect(registeredJsonContract(file)).toBeUndefined();
  }
  expect(platformFileFamily(name, undefined)).toBeUndefined();
  expect(platformFileFamily(name, '@wildshard/format/forestPage#ForestPageSchema')).toBeUndefined();
});

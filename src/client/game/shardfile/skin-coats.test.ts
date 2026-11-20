// @vitest-environment node
// ONE-FORMAT OF27b: a hull book's coat drawn as a skin. The PBR family draws a fur's sheen and backlit rim (the hull
// book's fur material, the same rim source), each skin variant wears its own material, and the loader transcodes the
// textures this tier's skin files name.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compilePbr } from '@wildshard/engine/render/families/pbr';
import { parseFamilyMaterial, type PbrMaterialParams } from '@wildshard/format/materialFamilies';
import { skinSpeciesLook, skinTextureRefs, type ClientSkin } from './clientSkins';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';

const textures = (): THREE.Texture => new THREE.Texture();
const pbr = (entry: Record<string, unknown>): PbrMaterialParams => {
  const params = parseFamilyMaterial({ family: 'pbr', ...entry });
  if (params.family !== 'pbr') throw new Error('expected a pbr entry');
  return params;
};

test('a fur sheen draws as three physical sheen; a plain surface stays standard', () => {
  const fur = compilePbr(pbr({ sheen: { amount: 0.3, colour: [0.45, 0.36, 0.26], roughness: 0.7 }, rim: [1, 0.72, 0.42] }), textures);
  expect(fur).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  if (!(fur instanceof THREE.MeshPhysicalMaterial)) throw new Error('unreachable');
  expect([fur.sheen, fur.sheenRoughness, fur.sheenColor.r]).toEqual([0.3, 0.7, 0.45]);
  // the rim is a program patch: its key joins the program cache key
  expect(fur.customProgramCacheKey()).toContain('pbr-rim');
  const plain = compilePbr(pbr({}), textures);
  expect(plain).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
  expect(plain.customProgramCacheKey()).not.toContain('pbr-rim');
});

const H = (c: string): string => c.repeat(64);
function shard(phone: boolean): Pick<Shardfile, 'rows' | 'files'> {
  const file = (hash: string, kind: Shardfile['files'][number]['kind'], dependencies: string[]): Shardfile['files'][number] =>
    ({ hash, kind, dependencies, compressed: 1, decoded: 1, gpu: 0, triangles: 0, draws: 0, critical: false });
  const look = { id: 'deer.look', species: 'deer', recipe: 'platform.skin', material: null,
    parameters: { skin: H('1'), variants: H('3'), ...(phone ? { phone: H('4') } : {}) },
    animation: { recipe: 'platform.clips', parameters: { attackSpan: 1 } } } as unknown as ShardRows['looks'][number];
  return { rows: { looks: [look] } as unknown as Shardfile['rows'], files: [
    file(H('1'), 'json', [H('a'), H('b'), H('n')]), file(H('2'), 'json', [H('a'), H('c'), H('n')]),
    file(H('3'), 'json', [H('1'), H('2')]), file(H('4'), 'json', [H('a'), H('p')]),
  ] };
}

test('the loader transcodes each tier\'s skin textures: every variant\'s coat, or the phone skin\'s', () => {
  expect(skinTextureRefs(shard(false), 'desktop').sort()).toEqual([H('b'), H('c'), H('n')]);
  expect(skinTextureRefs(shard(true), 'phone')).toEqual([H('p')]);
  expect(skinTextureRefs(shard(true), 'desktop').sort()).toEqual([H('b'), H('c'), H('n')]);
});

test('each skin variant draws in its own material', () => {
  const made = (id: string): ClientSkin => {
    const material = new THREE.MeshStandardMaterial(); material.name = id;
    return { id, geometry: new THREE.BufferGeometry(), bones: [], material: () => material, parts: [], clips: new Map(), skeleton: 'quadruped', sockets: [], attackSpan: 1 };
  };
  const skin: ClientSkin = { ...made('hind'), variants: new Map([['hind', made('hind')], ['ghost', made('ghost')]]) };
  const species = { id: 'deer', kind: 'deer', dims: { feet: [] }, body: { skeleton: 'quadruped' } } as unknown as ShardRows['species'][number];
  const look = skinSpeciesLook({ id: 'deer.look' } as ShardRows['looks'][number], species, skin);
  const sky = {} as Parameters<NonNullable<typeof look.material>>[0];
  expect(look.material?.(sky, undefined, undefined, { id: 'ghost' } as never).name).toBe('ghost');
  expect(look.material?.(sky).name).toBe('hind');
});

test('OF23f: a variant look\'s phone tier transcodes each phone variant\'s coat and none of the desktop maps', () => {
  const tiered = shard(true), look = tiered.rows.looks[0] as unknown as { parameters: Record<string, string> };
  look.parameters['phoneVariants'] = H('6');
  const file = (hash: string, dependencies: string[]): Shardfile['files'][number] =>
    ({ hash, kind: 'json', dependencies, compressed: 1, decoded: 1, gpu: 0, triangles: 0, draws: 0, critical: false });
  const files = [...tiered.files, file(H('5'), [H('a'), H('q')]), file(H('6'), [H('4'), H('5')])];
  expect(skinTextureRefs({ ...tiered, files }, 'phone').sort()).toEqual([H('p'), H('q')]);
  expect(skinTextureRefs({ ...tiered, files }, 'desktop').sort()).toEqual([H('b'), H('c'), H('n')]);
});

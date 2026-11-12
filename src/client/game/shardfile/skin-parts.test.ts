// @vitest-environment node
// TE-ENG10 (meta TEMPLATE-E2E-PLAN): a skin look maps a GLB material to a look material, so a creature's part glows.
// oxlint-disable-next-line import/no-nodejs-modules -- a test hashes its fixture skin's bytes as the format addresses them
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import { loadClientSkins, skinSpeciesLook } from './clientSkins';
import { Animal } from '@wildshard/engine/entities/AnimalView';
import type { AnimalModel, AnimalRig } from '@wildshard/engine/entities/AnimalFactory';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A two-joint skinned GLB: a body quad in `Body`, and (with `glow`) a head triangle in its own primitive and material. */
function skinGlb(glow: boolean): Uint8Array {
  const chunks: Buffer[] = [], views: object[] = [], accessors: object[] = [];
  let at = 0;
  const add = (data: ArrayBufferView, accessor: Record<string, unknown>): number => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength), pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length });
    chunks.push(bytes, Buffer.alloc(pad)); at += bytes.length + pad;
    accessors.push({ bufferView: views.length - 1, ...accessor });
    return accessors.length - 1;
  };
  const position = add(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, 0, 1.2, 0]), { componentType: 5126, count: 5, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 1.2, 0] });
  const normal = add(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), { componentType: 5126, count: 5, type: 'VEC3' });
  const joints = add(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]), { componentType: 5121, count: 5, type: 'VEC4' });
  const weights = add(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), { componentType: 5126, count: 5, type: 'VEC4' });
  const body = add(new Uint16Array(glow ? [0, 1, 2, 0, 2, 3] : [0, 1, 2, 0, 2, 3, 3, 2, 4]), { componentType: 5123, count: glow ? 6 : 9, type: 'SCALAR' });
  const head = glow ? add(new Uint16Array([3, 2, 4]), { componentType: 5123, count: 3, type: 'SCALAR' }) : -1;
  const binds = add(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]), { componentType: 5126, count: 2, type: 'MAT4' });
  const times = add(new Float32Array([0, 1]), { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] });
  const moves = add(new Float32Array([0, 1, 0, 0, 1.1, 0]), { componentType: 5126, count: 2, type: 'VEC3' });
  const attributes = { POSITION: position, NORMAL: normal, JOINTS_0: joints, WEIGHTS_0: weights };
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'test.glow', mesh: 0, skin: 0 }, { name: 'body', children: [2] }, { name: 'head', translation: [0, 1, 0] }],
    skins: [{ joints: [1, 2], inverseBindMatrices: binds }],
    meshes: [{ name: 'test.glow', primitives: [{ attributes, indices: body, material: 0 }, ...(glow ? [{ attributes, indices: head, material: 1 }] : [])] }],
    materials: [{ name: 'Body' }, ...(glow ? [{ name: 'Glow' }] : [])],
    animations: [{ name: 'idle', channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }], samplers: [{ input: times, output: moves, interpolation: 'LINEAR' }] }],
    accessors, bufferViews: views, buffers: [{ byteLength: at }],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  jh.writeUInt32LE(text.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([header, jh, text, bh, bin]));
}

async function loaded(glow: boolean, materials?: Record<string, string>) {
  await prepareGlbCost();
  const glb = skinGlb(glow), cost = parseGlbData(glb), file = sha(glb);
  const skin = new TextEncoder().encode(JSON.stringify({
    row: { id: 'test.glow', file, family: 'toon', rig: { skeleton: 'test.glow', joints: [['body', 'head']], clips: ['idle'], sockets: ['body', 'head'] },
      cost: { decoded: cost.decoded, gpu: cost.gpu, triangles: cost.triangles, draws: cost.draws } },
    binding: { skin: 'test.glow', material: { family: 'pbr', vertexColours: false }, ...(materials === undefined ? {} : { materials }), loops: ['idle'] },
  }));
  const look = { id: 'test.glow.look', species: 'test.glow', recipe: 'platform.skin', material: null, parameters: { skin: sha(skin) },
    animation: { recipe: 'platform.clips', parameters: { attackSpan: 1 } } };
  const source = { rows: { looks: [look] }, files: [{ hash: sha(skin), kind: 'json', dependencies: [file] }, { hash: file, kind: 'glb', dependencies: [] }],
    look: { materials: { 'test.eye': { family: 'emissive', colour: [1, 0.8, 0.2], intensity: 3 } } } };
  const compiled: THREE.Material[] = [];
  const compile = (entry: unknown): THREE.Material => {
    const family = (entry as { family?: string }).family;
    const material = family === 'emissive' ? new THREE.MeshBasicMaterial({ color: 0xffcc33 }) : new THREE.MeshStandardMaterial({ color: 0xb4583a });
    compiled.push(material); return material;
  };
  const skins = await loadClientSkins(source as never, new Map([[sha(skin), skin], [file, glb]]), compile, new Scope('skin parts'));
  const loadedSkin = skins.get('test.glow.look'); if (loadedSkin === undefined) throw new Error('skin not loaded');
  return { skin: loadedSkin, look, compiled };
}

test('a skin binding that maps a GLB material draws that part in its own look material, one group each', async () => {
  const { skin, look } = await loaded(true, { Glow: 'test.eye' });
  expect(skin.geometry.groups.map((group) => [group.start, group.count, group.materialIndex])).toEqual([[0, 6, 0], [6, 3, 1]]);
  const species = { id: 'test.glow', kind: 'test.glow', dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.5, headRadius: 0.2, legLen: 0.5, halfWidth: 0.5, feet: [] } };
  const speciesLook = skinSpeciesLook(look, species as never, skin);
  const first = speciesLook.partMaterials?.() ?? [], second = speciesLook.partMaterials?.() ?? [];
  expect(first).toHaveLength(1);
  expect(first[0]).toBeInstanceOf(THREE.MeshBasicMaterial);
  expect(second[0]).not.toBe(first[0]); // each rig its own (the hit flash writes it)
});

test('a skin with no map stays one material and one group, even over two GLB materials', async () => {
  for (const glow of [false, true]) {
    const { skin, look } = await loaded(glow);
    expect(skin.geometry.groups.map((group) => [group.start, group.count, group.materialIndex])).toEqual([[0, 9, 0]]);
    expect(skinSpeciesLook(look, { id: 'test.glow', kind: 'test.glow', dims: { feet: [] } } as never, skin).partMaterials).toBeUndefined();
  }
});

test('a mapped name the GLB does not draw is refused', async () => {
  await expect(loaded(true, { Gullet: 'test.eye' })).rejects.toThrow(/Gullet/u);
});

/** A rig with a glowing part (an emissive look material, unlit) beside its lit family body. */
function partRig(): { animal: Animal; fur: THREE.MeshStandardMaterial; eye: THREE.MeshBasicMaterial; lit: THREE.MeshStandardMaterial } {
  const fur = new THREE.MeshStandardMaterial({ color: 0xb4583a, emissive: 0x200804, emissiveIntensity: 0.3 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xffcc33 }), lit = new THREE.MeshStandardMaterial({ emissive: 0x332200, emissiveIntensity: 2 });
  const body = new THREE.Bone(), head = new THREE.Bone();
  body.name = 'body'; head.name = 'head'; body.add(head);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1); geometry.addGroup(6, 3, 2);
  const mesh = new THREE.SkinnedMesh(geometry, [fur, eye, lit]);
  mesh.add(body);
  const rig: AnimalRig = { mesh, bones: { body, head }, materials: [fur, fur, fur], parts: [eye, lit] };
  const dims = { bodyY: 1, bodyHalfLen: 1.2, bodyRadius: 0.5, halfWidth: 0.5, legLen: 0.8 };
  const species = { label: 'Dust Wyrm', rig: 'custom', aggressive: true, animate: (): void => undefined };
  const model = { kind: 'dust-wyrm', variant: 'base', species, variantDef: { id: 'base', label: '', rarity: 'common', hp: 100 }, dims, fur: new THREE.MeshStandardMaterial(), hard: new THREE.MeshStandardMaterial() } as unknown as AnimalModel;
  const animal = new Animal(rig, model, 0.25);
  animal.rowDriven = true;
  return { animal, fur, eye, lit };
}

test('a hit flashes every material of the rig, its glowing parts too, and each returns to its base', () => {
  const { animal, fur, eye, lit } = partRig();
  const bases = [fur.emissive.getHex(), eye.color.getHex(), lit.emissive.getHex()], intensities = [fur.emissiveIntensity, lit.emissiveIntensity];
  animal.hitFlash(1);
  expect([fur.emissive.getHex(), eye.color.getHex(), lit.emissive.getHex()]).toEqual([0xffffff, 0xffffff, 0xffffff]);
  let t = 0;
  const row = { x: 0, y: 0, z: 0, yaw: 0, state: 'idle', attack: 0, flinch: 0, strafe: 0, brace: 0, hp: 40, alive: true, rise: 0, act: 0 } as const;
  for (let i = 0; i < 30; i++) { animal.showRow(row, 1 / 60); animal.update(1 / 60, t, true); t += 1 / 60; }
  expect([fur.emissive.getHex(), eye.color.getHex(), lit.emissive.getHex()]).toEqual(bases);
  expect([fur.emissiveIntensity, lit.emissiveIntensity]).toEqual(intensities);
  animal.setDrawLod(2); // the far LOD never folds a glowing part into the body
  expect(animal.mesh.material).toEqual([fur, eye, lit]);
});

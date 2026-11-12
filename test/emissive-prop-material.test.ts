import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { installDeclaredProps } from '../src/client/engine/world/declaredProps';
import { familyMaterial } from '../src/client/engine/render/families/registry';
import { EmissiveLook } from '../src/client/engine/render/families/emissive';
import { ToonLook } from '../src/client/engine/render/families/toon';
import { propSurfaces } from '../src/client/game/shardfile/clientPropMaterials';
import { parseGlbData } from '@wildshard/format/glbCost';
import { propMaterialsOf } from '@wildshard/format/propMaterials';

// TEMPLATE-E2E LF1-2: a second prop material, emissive. A shard whose props draw in the dev-map "measure" look names a GLB
// material in `props.materials` and binds it to an emissive `look.materials` entry: that surface keeps its declared colour and
// intensity (it feeds bloom), never the role colour, and never its mesh's baked vertex colours unless it declares them. The
// stone beside it keeps the measure look, and a shard without `props.materials` draws exactly as before.

const h = (n: number): string => n.toString(16).padStart(64, '0');
const MEASURE = {
  floor: [0.42, 0.5, 0.27], label: { colour: [1, 0.93, 0.8], height: 0.36 }, lift: 0.4,
  line: { alpha: 0.45, colour: [1, 0.95, 0.82], floorAlpha: 0.3, width: 0.011 }, structure: [0.6, 0.57, 0.48], sub: { alpha: 0.08, step: 0.25 }, trim: [0.3, 0.44, 0.18],
};
const AMBER: [number, number, number] = [1, 0.62, 0.22];
/** a props section's admitted named materials, as the client reads them */
function admittedPropMaterials(materials: Record<string, { id: string }>): NonNullable<ReturnType<typeof propMaterialsOf>> {
  const named = propMaterialsOf({ materials }); if (named === undefined) throw new Error('no named materials'); return named;
}

/** A minimal static GLB: one node per primitive, each with positions, normals, vertex colours and its own material name. */
function glb(parts: readonly { material: string; colour: [number, number, number]; castShadow?: boolean }[]): Uint8Array {
  const chunks: number[] = [], views: object[] = [], accessors: object[] = [], meshes: object[] = [], nodes: object[] = [], materials: object[] = [];
  const add = (values: readonly number[], type: 'VEC3', extra: object = {}): number => {
    const offset = chunks.length * 4; chunks.push(...values);
    views.push({ buffer: 0, byteOffset: offset, byteLength: values.length * 4 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: values.length / 3, type, ...extra });
    return accessors.length - 1;
  };
  for (const part of parts) {
    const position = add([0, 0, 0, 1, 0, 0, 0, 1, 0], 'VEC3', { min: [0, 0, 0], max: [1, 1, 0] });
    const normal = add([0, 0, 1, 0, 0, 1, 0, 0, 1], 'VEC3');
    const color = add([...part.colour, ...part.colour, ...part.colour], 'VEC3');
    materials.push({ name: part.material, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } });
    meshes.push({ primitives: [{ attributes: { POSITION: position, NORMAL: normal, COLOR_0: color }, material: materials.length - 1 }] });
    nodes.push({ mesh: meshes.length - 1, ...(part.castShadow === false ? { extras: { castShadow: false } } : {}) });
  }
  const bin = new Uint8Array(new Float32Array(chunks).buffer);
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_n, i) => i) }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.length }] };
  let json = new TextEncoder().encode(JSON.stringify(doc));
  const pad = (4 - (json.length % 4)) % 4; if (pad > 0) json = new Uint8Array([...json, ...new Array<number>(pad).fill(0x20)]);
  const out = new Uint8Array(12 + 8 + json.length + 8 + bin.length), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  view.setUint32(20 + json.length, bin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
  return out;
}

const STONE_GREY: [number, number, number] = [0.53, 0.53, 0.53];
const TILE = glb([{ material: 'stone', colour: STONE_GREY }, { material: 'lamp', colour: STONE_GREY, castShadow: false }]);

function catalogue(scope: Scope): { measure: THREE.Material; glow: THREE.Material; materials: Map<string, THREE.Material> } {
  const ctx = { toon: new ToonLook(), emissive: new EmissiveLook(), textures: (): THREE.Texture => { throw new Error('no textures'); }, scope };
  const measure = familyMaterial({ family: 'pbr', vertexColours: true, faceted: true, roughness: 1, metalness: 0, measure: MEASURE }, ctx);
  const glow = familyMaterial({ family: 'emissive', colour: AMBER, intensity: 4 }, ctx);
  return { measure, glow, materials: new Map([['pbr', measure], ['test.glow', glow]]) };
}

async function drawn(surfaces: boolean): Promise<{ byName: Map<string, THREE.Material>; scope: Scope; glow: THREE.Material; measure: THREE.Material }> {
  const scope = new Scope('test.emissive-prop'), scene = new THREE.Group(), { measure, glow, materials } = catalogue(scope);
  const named = admittedPropMaterials({ stone: { id: 'pbr' }, lamp: { id: 'test.glow' } });
  const resolve = surfaces ? await propSurfaces(named, { look: {}, catalogue: materials, compile: () => { throw new Error('nothing to compile'); }, texture: () => { throw new Error('no textures'); }, file: () => undefined }) : undefined;
  const installed = await installDeclaredProps({ family: 'pbr', tiles: [{ lod: 0, x: 0, z: 0, file: h(1) }], panels: [], models: [], far: null, textures: [] }, {
    scene, scope, assets: new Map([[h(1), TILE]]), materials, ...(resolve === undefined ? {} : { surfaces: resolve }),
  });
  // the tile's meshes in node order: the stone, then the lamp
  const order = ['stone', 'lamp'], byName = new Map<string, THREE.Material>();
  installed.tiles.get('0/0/0')?.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) byName.set(order[byName.size] ?? '?', o.material); });
  return { byName, scope, glow, measure };
}

const programKey = (m: THREE.Material): string => m.customProgramCacheKey();

test('an emissive prop surface keeps its declared colour and intensity beside measure stone', async () => {
  const { byName, scope, glow, measure } = await drawn(true);
  try {
    const lamp = byName.get('lamp'), stone = byName.get('stone');
    expect(lamp).toBeInstanceOf(THREE.MeshBasicMaterial);
    if (!(lamp instanceof THREE.MeshBasicMaterial)) return;
    // the declared amber, not the grey its mesh was baked with: emissive declares no vertex colours
    expect(lamp.color.getHexString()).toBe((glow as THREE.MeshBasicMaterial).color.getHexString());
    expect(lamp.vertexColors).toBe(false);
    expect((lamp.userData['familyUniforms'] as Record<string, THREE.IUniform<number>>)['famEmitIntensity']?.value).toBe(4);
    expect(programKey(lamp)).toBe(programKey(glow));
    expect(programKey(lamp)).not.toContain('measure');
    // the stone keeps the measure program and its vertex colours
    expect(stone).toBeInstanceOf(THREE.MeshStandardMaterial);
    if (stone === undefined) return;
    expect(programKey(stone)).toBe(programKey(measure));
    expect(programKey(stone)).toContain('family.pbr.measure.v1');
    expect(stone.vertexColors).toBe(true);
  } finally { scope.dispose(); }
});

test('a shard without props.materials draws every prop with its one family, as before', async () => {
  const { byName, scope, measure } = await drawn(false);
  try {
    for (const name of ['stone', 'lamp']) {
      const m = byName.get(name);
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
      if (m === undefined) continue;
      expect(programKey(m)).toBe(programKey(measure));
      expect(m.vertexColors).toBe(true);
    }
  } finally { scope.dispose(); }
});

test('an emissive surface that declares vertex colours still takes them', async () => {
  const scope = new Scope('test.emissive-vc'), scene = new THREE.Group(), { materials } = catalogue(scope);
  const ctx = { toon: new ToonLook(), emissive: new EmissiveLook(), textures: (): THREE.Texture => { throw new Error('no textures'); }, scope };
  materials.set('test.tinted', familyMaterial({ family: 'emissive', colour: AMBER, intensity: 2, vertexColours: true }, ctx));
  try {
    const resolve = await propSurfaces(admittedPropMaterials({ stone: { id: 'pbr' }, lamp: { id: 'test.tinted' } }), { look: {}, catalogue: materials, compile: () => { throw new Error('nothing to compile'); }, texture: () => { throw new Error('no textures'); }, file: () => undefined });
    const installed = await installDeclaredProps({ family: 'pbr', tiles: [{ lod: 0, x: 0, z: 0, file: h(1) }], panels: [], models: [], far: null, textures: [] }, { scene, scope, assets: new Map([[h(1), TILE]]), materials, surfaces: resolve });
    const all: THREE.Material[] = []; installed.tiles.get('0/0/0')?.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) all.push(o.material); });
    const lamp = all.find((m) => m instanceof THREE.MeshBasicMaterial);
    expect(lamp?.vertexColors).toBe(true);
  } finally { scope.dispose(); }
});

test('the tile draw count charges the second material: one draw, two when it casts a shadow', () => {
  const stoneOnly = parseGlbData(glb([{ material: 'stone', colour: STONE_GREY }]));
  const withLamp = parseGlbData(TILE);
  const shadowedLamp = parseGlbData(glb([{ material: 'stone', colour: STONE_GREY }, { material: 'lamp', colour: STONE_GREY }]));
  expect(stoneOnly.draws).toBe(2); // the main draw and its shadow draw
  expect(withLamp.draws).toBe(3); // a lamp that casts no shadow is one more draw
  expect(shadowedLamp.draws).toBe(4);
});

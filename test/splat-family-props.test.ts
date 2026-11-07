import { expect, test } from 'vitest';
import * as THREE from 'three';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { installDeclaredProps } from '../src/client/engine/world/declaredProps';
import { staticGlb } from '../src/sharddev/bake/glb';
import { splatSurface, withSplatSurface } from '../src/client/game/shardfile/clientSplatTerrain';
import { SplatTerrainSchema, checkTileMaterialNames, splatTextureRefs, type SplatTerrain } from '@wildshard/format/splatTerrain';

// Tile streaming P1 (G227): a splat ground joins a shard's props tiles beside props that draw with the family (Pine's timber
// declares no named materials). The splat-named primitive draws with the splat material; every other name with the family.
const h = (n: number): string => n.toString(16).padStart(64, '0');
const SPLAT: SplatTerrain = v.parse(SplatTerrainSchema, {
  material: 'pine.ground',
  layers: { colour: [h(1), h(2), h(3), h(4)], normal: [h(5), h(6), h(7), h(8)], arm: [h(9), h(10), h(11), h(12)] },
  tints: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], boreal: null,
});
function layer(): THREE.CompressedTexture {
  return new THREE.CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, THREE.RGBA_ASTC_4x4_Format);
}
function primitive(name: string, channels: boolean): Parameters<typeof staticGlb>[0][number] {
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3)).setIndex([0, 2, 1]);
  if (channels) { g.setAttribute('splat', new THREE.Float32BufferAttribute(Array.from({ length: 12 }, () => 0.25), 4)); g.setAttribute('canopy', new THREE.Float32BufferAttribute([0, 0, 0], 1)); }
  const material = new THREE.MeshStandardMaterial(); material.name = name;
  return { geometry: g, material, castShadow: false, ...(channels ? { customAttributes: { _SPLAT: 'splat', _CANOPY: 'canopy' } } : {}) };
}

test('the splat ground and family-drawn timber share one props tile', async () => {
  const glb = staticGlb([primitive('pine.ground', true), primitive('planks', false)], 'tile');
  expect(() => { checkTileMaterialNames(undefined, SPLAT, glb); }).not.toThrow();
  expect(() => { checkTileMaterialNames({}, SPLAT, glb); }).toThrow('planks');
  const scope = new Scope('test.splat-family'), scene = new THREE.Group(), family = new THREE.MeshStandardMaterial();
  try {
    const textures = new Map(splatTextureRefs(SPLAT).map(ref => [ref, layer()]));
    const surface = splatSurface(SPLAT, { scope, texture: ref => { const t = textures.get(ref); if (t === undefined) throw new Error('no layer'); return t; } });
    const installed = await installDeclaredProps({ family: 'pbr', tiles: [{ lod: 0, x: 0, z: 0, file: h(99) }], panels: [], models: [], far: null, textures: [] }, {
      scene, scope, assets: new Map([[h(99), glb]]), materials: new Map([['pbr', family]]),
      surfaces: withSplatSurface({ name: SPLAT.material, binding: surface.binding }, null),
    });
    const drawn: unknown[] = []; installed.tiles.get('0/0/0')?.traverse(o => { if (o instanceof THREE.Mesh) { const material: unknown = o.material; drawn.push(material); } });
    expect(drawn).toHaveLength(2);
    expect(drawn).toContain(surface.material);
    expect(drawn.filter(m => m !== surface.material)).toHaveLength(1);
  } finally { scope.dispose(); }
});

test('a phone layer set draws on the phone; desktop draws layers; admission sees both', () => {
  const phone: SplatTerrain = v.parse(SplatTerrainSchema, { ...SPLAT, phone: { colour: [h(21), h(22), h(23), h(24)], normal: [h(25), h(26), h(27), h(28)], arm: [h(9), h(10), h(11), h(12)] } });
  expect(splatTextureRefs(phone, 'desktop')).toEqual(splatTextureRefs(SPLAT));
  expect(splatTextureRefs(phone, 'phone').slice(0, 8)).toEqual([21, 22, 23, 24, 25, 26, 27, 28].map(h));
  expect(splatTextureRefs(phone)).toHaveLength(12 + 8); // the shared ARM files count once
  expect(splatTextureRefs(SPLAT, 'phone')).toEqual(splatTextureRefs(SPLAT));
});

test('a trusted runtime streams its bound splat ground: primary files only', async () => {
  const { withSplatGround, splatGroundFiles } = await import('../src/client/game/shardfile/clientSplatTerrain');
  const file = (n: number, kind = 'glb') => ({ hash: h(n), kind, compressed: 1, decoded: 1, gpu: 1, triangles: 1, draws: 1, dependencies: [], critical: false });
  const props = { version: 1 as const, family: 'pbr', tiles: [{ lod: 0 as const, x: 0, z: 0, file: h(99), additionalFiles: [h(98)] }], panels: [], models: [], far: null, colliders: [], textures: [], splat: SPLAT };
  const full = { props, tiles: [{ lod: 0, x: 0, z: 0, files: [h(99), h(98)] }], files: [file(99), file(98), ...splatTextureRefs(SPLAT).map(ref => Object.assign(file(0, 'ktx2'), { hash: ref }))], library: splatTextureRefs(SPLAT) };
  const data = { props: { ...props, tiles: [] }, tiles: [], files: [], library: [] };
  type Source = Parameters<typeof withSplatGround>[0];
  const cast = (value: object): Source => value as Source; // a partial fixture of the fields read
  {
    const drawn = withSplatGround(cast(data), cast(full));
    expect(drawn.props?.tiles).toEqual([{ lod: 0, x: 0, z: 0, file: h(99) }]); // never the runtime's timber
    expect(drawn.tiles).toEqual([{ lod: 0, x: 0, z: 0, files: [h(99)] }]);
    expect(drawn.files.map(row => row.hash)).toEqual([h(99), ...splatTextureRefs(SPLAT)]);
    expect([...splatGroundFiles(drawn)].sort()).toEqual([h(99), ...splatTextureRefs(SPLAT)].sort());
  }
});

// GLSL parity (Sky Reach): a named surface bound to a graph look draws that graph as it is, on either back-end. A classic
// GLSL graph material went through the family-variant path and took the GLB's vertex colours on top of the graph's own.
test('a GLSL graph look draws as itself, never as a vertex-coloured family variant', async () => {
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3)).setIndex([0, 2, 1]);
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  const source = new THREE.MeshStandardMaterial(); source.name = 'isle-paint';
  const glb = staticGlb([{ geometry: g, material: source, castShadow: false }], 'tile');
  const scope = new Scope('test.graph-props'), scene = new THREE.Group(), family = new THREE.MeshStandardMaterial();
  const graph = Object.assign(new THREE.ShaderMaterial(), { isGraphShaderMaterial: true });
  const maps = { colour: null, normal: null, normalScale: 1, metallicRoughness: null, occlusion: null, occlusionStrength: 1, emissive: null };
  try {
    const installed = await installDeclaredProps({ family: 'pbr', tiles: [{ lod: 0, x: 0, z: 0, file: h(98) }], panels: [], models: [], far: null, textures: [] }, {
      scene, scope, assets: new Map([[h(98), glb]]), materials: new Map([['pbr', family]]),
      surfaces: name => name === 'isle-paint' ? { material: graph, maps } : null,
    });
    const drawn: unknown[] = []; installed.tiles.get('0/0/0')?.traverse(o => { if (o instanceof THREE.Mesh) { const material: unknown = o.material; drawn.push(material); } });
    expect(drawn).toEqual([graph]); expect(graph.vertexColors).toBe(false);
  } finally { scope.dispose(); graph.dispose(); }
});

test('splat terrain admits an explicit cell merge without changing layer loans', () => {
  const cell = v.parse(SplatTerrainSchema, {...SPLAT, merge:'cell'});
  expect(cell.merge).toBe('cell'); expect(splatTextureRefs(cell)).toEqual(splatTextureRefs(SPLAT));
  expect(v.parse(SplatTerrainSchema,SPLAT).merge).toBeUndefined();
  expect(()=>v.parse(SplatTerrainSchema,{...SPLAT,merge:'all-worlds'})).toThrow();
});

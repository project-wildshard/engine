import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { installDeclaredProps } from '../src/client/engine/world/declaredProps';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';

// ZONE-ENTRY ZE7c: Pastel Plain's and Ink-Cel Valley's props draw with their `rock` graph as the props family. The template's
// blocks carry the measure grey (0x888888, 0.246 linear) as vertex colours, and the family variant switched three's
// `vertexColors` on for them, so the pink-to-peach graph was multiplied down to grey: the graph never reads `vertexColour`.
// A graph reads the mesh's colour itself (`wsVertexColour`, glslProgram), so one that never reads it is not multiplied by it.

const h = (n: number): string => n.toString(16).padStart(64, '0');
const GREY = 0.2462;
/** one triangle with positions, normals and grey vertex colours */
function glb(): Uint8Array {
  const values = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, ...new Array<number>(9).fill(GREY)];
  const views = [0, 1, 2].map(i => ({ buffer: 0, byteOffset: i * 36, byteLength: 36 }));
  const accessors = [0, 1, 2].map(i => ({ bufferView: i, componentType: 5126, count: 3, type: 'VEC3', ...(i === 0 ? { min: [0, 0, 0], max: [1, 1, 0] } : {}) }));
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], materials: [{ name: 'block' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, material: 0 }] }], accessors, bufferViews: views, buffers: [{ byteLength: 108 }] };
  const bin = new Uint8Array(new Float32Array(values).buffer);
  let json = new TextEncoder().encode(JSON.stringify(doc));
  const pad = (4 - (json.length % 4)) % 4; if (pad > 0) json = new Uint8Array([...json, ...new Array<number>(pad).fill(0x20)]);
  const out = new Uint8Array(28 + json.length + bin.length), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  view.setUint32(20 + json.length, bin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
  return out;
}

const PEACH = { op: 'const', value: [1, 0.8, 0.7] };
const plainGraph = { version: 1, kind: 'material', model: 'standard', nodes: { c: PEACH }, stages: { surface: { colour: 'c' } }, effectState: { fog: false } };
const tintedGraph = { version: 1, kind: 'material', model: 'standard', nodes: { c: PEACH, vc: { op: 'vertexColour' }, t: { op: 'mul', in: ['c', 'vc'] } }, stages: { surface: { colour: 't' } }, effectState: { fog: false } };

async function drawnWith(graph: unknown): Promise<{ material: THREE.Material; scope: Scope }> {
  const scope = new Scope('test.graph-props-vc'), compiled = compileClassicGraph(graph);
  scope.onDispose(() => { compiled.material.dispose(); });
  const installed = await installDeclaredProps({ family: 'rock', tiles: [{ lod: 0, x: 0, z: 0, file: h(1) }], panels: [], models: [], far: null, textures: [] },
    { scene: new THREE.Group(), scope, assets: new Map([[h(1), glb()]]), materials: new Map([['rock', compiled.material]]) });
  let material: THREE.Material | null = null;
  installed.tiles.get('0/0/0')?.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) material = o.material; });
  if (material === null) throw new Error('no prop mesh drawn');
  return { material, scope };
}

test('a props-family graph that never reads vertexColour is not multiplied by the baked grey', async () => {
  const { material, scope } = await drawnWith(plainGraph);
  try {
    expect(material.name).toBe('graph:material');
    expect(material.vertexColors).toBe(false);
  } finally { scope.dispose(); }
});

test('a props-family graph that reads vertexColour keeps the props vertex colours as before', async () => {
  const { material, scope } = await drawnWith(tintedGraph);
  try { expect(material.vertexColors).toBe(true); } finally { scope.dispose(); }
});

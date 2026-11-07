import {expect, test} from 'vitest';
import {MeshStandardMaterial, PerspectiveCamera, Scene, type Vector2} from 'three';
import {CSM} from 'three/examples/jsm/csm/CSM.js';
import {dispatchRebind} from '../../../shared/engine/app/scope';
import {WeakShaderMap} from './weakShaderMap';

interface Shader { uniforms: {CSM_cascades: {value: Vector2[]}; cameraNear: {value: number}; shadowFar: {value: number}} }
const shader = (): Shader => ({uniforms: {CSM_cascades: {value: []}, cameraNear: {value: -1}, shadowFar: {value: -1}}});
function listeners(material: MeshStandardMaterial): number {
  const rows: unknown = Reflect.get(material, '_listeners'), dispose: unknown = typeof rows === 'object' && rows !== null ? Reflect.get(rows, 'dispose') : undefined;
  return Array.isArray(dispose) ? dispose.length : 0;
}

test('retirement drops disposed shader payloads while preserving weak final-cleanup keys', () => {
  const map = new WeakShaderMap<Shader>(), retired = new MeshStandardMaterial(), live = new MeshStandardMaterial();
  const held = [retired, live], a = shader(), b = shader();
  map.set(retired, a); map.set(live, b); retired.dispose();
  expect(held).toHaveLength(2); expect(map.size).toBe(2); expect(map.has(retired)).toBe(true); expect(map.get(retired)).toBeNull();
  const visited: (Shader | null)[] = []; map.forEach(value => { visited.push(value); }); expect(visited).toEqual([null, b]);
  map.clear(); live.dispose();
});

test('binding-only rebinds preserve the entry, while a later real retirement releases its payload', () => {
  const map = new WeakShaderMap<Shader>(), material = new MeshStandardMaterial(), value = shader();
  map.set(material, value); dispatchRebind(material);
  expect(map.get(material)).toBe(value); expect(map.size).toBe(1); expect(listeners(material)).toBe(1);
  material.dispose(); expect(map.get(material)).toBeNull(); expect(listeners(material)).toBe(0);
});

test('overwriting, explicit removal, clear and recompilation retain Map and listener semantics', () => {
  const map = new WeakShaderMap<Shader>(), material = new MeshStandardMaterial(), other = new MeshStandardMaterial();
  const first = shader(), second = shader(); map.set(material, first).set(material, second);
  expect(map.get(material)).toBe(second); expect(map.size).toBe(1); expect(listeners(material)).toBe(1);
  expect(map.delete(material)).toBe(true); expect(map.delete(material)).toBe(false); expect(listeners(material)).toBe(0);
  map.set(material, first); material.dispose(); expect(map.get(material)).toBeNull();
  // Three can compile the same material again: CSM's captured hook calls set again.
  map.set(material, second).set(other, first); expect(map.size).toBe(2);
  map.clear(); expect(map.size).toBe(0); expect(listeners(material)).toBe(0); expect(listeners(other)).toBe(0);
  material.dispose(); other.dispose();
});

test('actual CSM refits update every live shader and leave retired shader records untouched', () => {
  const camera = new PerspectiveCamera(72, .6, .1, 500), parent = new Scene();
  const csm = new CSM({camera, parent, cascades: 3, maxFar: 80}), map = new WeakShaderMap<Shader | null>();
  Reflect.set(csm, 'shaders', map);
  const live = new MeshStandardMaterial(), retired = new MeshStandardMaterial();
  csm.setupMaterial(live); csm.setupMaterial(retired);
  const a = shader(), b = shader(); map.set(live, a); map.set(retired, b);
  try {
    csm.updateFrustums(); const old = b.uniforms.cameraNear.value;
    retired.dispose(); camera.near = .25; camera.fov = 81; camera.updateProjectionMatrix(); csm.updateFrustums();
    expect(a.uniforms.cameraNear.value).toBe(.25); expect(a.uniforms.CSM_cascades.value).toHaveLength(3);
    expect(a.uniforms.shadowFar.value).toBe(80); expect(b.uniforms.cameraNear.value).toBe(old);
    expect(map.size).toBe(2); expect(map.get(retired)).toBeNull();
    const liveDefines = live.defines, retiredDefines = retired.defines;
    if (liveDefines === undefined || retiredDefines === undefined) throw new Error('Missing CSM defines');
    csm.dispose();
    expect(liveDefines['USE_CSM']).toBeUndefined(); expect(retiredDefines['USE_CSM']).toBeUndefined();
    expect(Object.hasOwn(live, 'onBeforeCompile')).toBe(false); expect(Object.hasOwn(retired, 'onBeforeCompile')).toBe(false);
  } finally { csm.dispose(); csm.remove(); map.clear(); live.dispose(); retired.dispose(); }
});

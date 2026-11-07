import * as THREE from 'three';
import { Scope } from '../../../shared/engine/app/scope';

/**
 * js-heap H1: the material an instanced draw wears. three keeps one current program per material and re-selects it
 * (getParameters, ~100 fields, and its key) whenever that material's draws switch between instanced and plain objects:
 * the idle Template re-selected a look library's family:pbr material twice a frame, drawn by instanced tile props and
 * by an ordinary mesh, and any classic material an instanced and a plain object share does the same. The shadow
 * ownership's draw hook (`shadowMaterialOwnership.ts`) hands each instanced draw of a classic material its twin: an
 * object whose prototype is the material, so every field, map, uniform and compile hook it reads is the material's own,
 * live (a look write, a curve, an emissive switch reach both), while three files the twin's program state apart
 * (renderer properties are keyed by object). Each program variant then compiles once, on the twin or the material
 * (programs are shared by key, so a precompiled variant links nothing again), and neither flips. This is the one allowed
 * second program of a lent look (the look library's no-recompile rule's exception): no shader, value or texture is
 * duplicated. The twin's version and needs-update follow the material's; it has its own events, and goes with the
 * material's dispose.
 */
const twins = new WeakMap<THREE.Material, THREE.Material>();
const made = new WeakSet<THREE.Material>();
const isMaterial = (value: unknown): value is THREE.Material => value instanceof THREE.Material;

/** `material`'s instanced twin (made once, kept while both live); a twin itself stays as it is */
export function instancedMaterial(material: THREE.Material): THREE.Material {
  if (made.has(material)) return material;
  const known = twins.get(material);
  if (known !== undefined) return known;
  const created: unknown = Object.create(material);
  if (!isMaterial(created)) throw new Error('An instanced twin is not a material');
  const twin = created;
  Reflect.defineProperty(twin, '_listeners', { value: {}, writable: true, configurable: true, enumerable: false });
  Reflect.defineProperty(twin, 'version', { get: () => material.version, set: (value: number) => { Reflect.set(material, 'version', value); }, configurable: true });
  Reflect.defineProperty(twin, 'needsUpdate', { get: () => false, set: (value: boolean) => { material.needsUpdate = value; }, configurable: true });
  // the twin's own lifetime: it goes with the material, and forgets the material when it goes first (a resident's owner)
  const lifetime = new Scope('render:instanced-twin');
  lifetime.listenOnceEmitter(material, 'dispose', () => { lifetime.dispose(); twin.dispose(); });
  lifetime.listenOnceEmitter(twin, 'dispose', () => { lifetime.dispose(); });
  lifetime.onDispose(() => { if (twins.get(material) === twin) twins.delete(material); });
  twins.set(material, twin); made.add(twin);
  return twin;
}

import type { BatchedMesh, Box3, InstancedMesh, Line, Material, Mesh, Object3D, Points, SkinnedMesh, Sprite } from 'three';
import type { Renderer } from '@wildshard/engine/render/renderer';

/** Independent actual-draw audit. Kept self-contained so the browser proof can serialize this function. */
export function inspectGridDraw(object: Object3D, material: Material, renderer?: Renderer, centres?: Readonly<Record<string, Readonly<{ x: number; z: number }>>>): { cell: string; object: string; outside: boolean; clipped: boolean; worldTop: number | null; issue: string | null } | null {
  let owner: Object3D | null = object;
  while (owner !== null && !/^(?:grid-cell|region):/u.test(owner.name)) owner = owner.parent;
  if (owner === null) return null; // page-owned road, floor, sky and traveller
  const cell = owner.name.slice(owner.name.indexOf(':') + 1);
  const isDraw = (value: Object3D): value is Mesh | Line | Points | Sprite => ['isMesh', 'isLine', 'isPoints', 'isSprite'].some(flag => Reflect.get(value, flag) === true);
  if (!isDraw(object)) return null;
  const isInstances = (value: Object3D): value is InstancedMesh => Reflect.get(value, 'isInstancedMesh') === true;
  const isBatch = (value: Object3D): value is BatchedMesh => Reflect.get(value, 'isBatchedMesh') === true;
  const isSkin = (value: Object3D): value is SkinnedMesh => Reflect.get(value, 'isSkinnedMesh') === true;
  if ((isInstances(object) && object.count === 0) || object.geometry.drawRange.count === 0 || (object.geometry.hasAttribute('position') && object.geometry.getAttribute('position').count === 0)) return null;
  let local: Box3 | null;
  if (isInstances(object) || isBatch(object)) { object.computeBoundingBox(); local = object.boundingBox; }
  else if (isSkin(object)) { object.computeBoundingBox(); local = object.boundingBox; }
  else local = object.geometry.boundingBox;
  if (local === null || ![...local.min, ...local.max].every(Number.isFinite)) return { cell, object: object.name, outside: false, clipped: false, worldTop: null, issue: 'unmeasured draw bounds' };
  const box = local.clone().applyMatrix4(object.matrixWorld), origin = centres?.[cell] ?? owner.getWorldPosition(owner.position.clone());
  const outside = box.min.x < origin.x - 250 || box.max.x > origin.x + 250 || box.min.z < origin.z - 250 || box.max.z > origin.z + 250;
  let clipped = material.customProgramCacheKey().includes('|grid-cell-clip');
  if (clipped && renderer !== undefined) {
    const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
    const properties: unknown = renderer.properties.get(material);
    const program: unknown = record(properties) ? properties['currentProgram'] : null;
    const fragment: unknown = record(program) ? program['fragmentShader'] : null;
    clipped = fragment instanceof WebGLShader && (renderer.getContext().getShaderSource(fragment)?.includes('wsCellFragment') ?? false);
  }
  return { cell, object: object.name, outside, clipped, worldTop: box.max.y, issue: outside && !clipped ? 'stray drawn object' : null };
}

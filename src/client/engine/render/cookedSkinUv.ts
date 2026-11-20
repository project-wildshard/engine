import { BufferAttribute, type BufferGeometry, type Material } from 'three';

const pending = new WeakMap<BufferGeometry, BufferAttribute>();
const rebound = Object.freeze({});

/** The same cooked hull can be used by the warm rig and by every live actor. */
export function prepareCookedSkinUv(geometry: BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  if (uv instanceof BufferAttribute && !('data' in uv)) pending.set(geometry, uv);
}

/**
 * WebKit can retain the warmed binding for a cooked hull's coat. Rebind it once
 * after the first mapped draw. Three checks attribute.data when it validates a
 * VAO. For a plain attribute, that identity is independent of its GPU buffer.
 */
export function rebindCookedSkinUv(geometry: BufferGeometry, material: Material): void {
  const uv = pending.get(geometry);
  if (uv === undefined) return;
  const map: unknown = Reflect.get(material, 'map');
  if (map === undefined || map === null) return;
  pending.delete(geometry);
  Object.defineProperty(uv, 'data', { value: rebound });
}

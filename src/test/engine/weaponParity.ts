// oxlint-disable-next-line import/no-nodejs-modules -- Exact automated geometry/pose proof hashes retained bytes.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { vi } from 'vitest';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

/** SHARD-PLATFORM SF36 parity traces: rounding, digests and per-object rows shared by the weapon family traces. */
export const round = (n: number): number => Math.round(n * 1e9) / 1e9;
/** FNV-1a over a window's JSON: a locatable digest without a Node module. */
export function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.codePointAt(i) ?? 0; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const v3 = (v: THREE.Vector3 | THREE.Euler): number[] => [round(v.x), round(v.y), round(v.z)];
export const q4 = (q: THREE.Quaternion): number[] => [round(q.x), round(q.y), round(q.z), round(q.w)];
export const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;
export function geometrySum(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  let sum = 0;
  for (let i = 0; i < position.count; i++) sum += position.getX(i) + position.getY(i) * 3 + position.getZ(i) * 7;
  return round(sum);
}
export function materialRow(material: THREE.Material | THREE.Material[]): unknown {
  return (Array.isArray(material) ? material : [material]).map((m) => ({ name: m.name, type: m.type, transparent: m.transparent, depthWrite: m.depthWrite,
    opacity: round(m.opacity), blending: m.blending,
    color: m instanceof THREE.MeshBasicMaterial || m instanceof THREE.MeshStandardMaterial ? m.color.getHexString() : null,
    emissive: m instanceof THREE.MeshStandardMaterial ? [m.emissive.getHexString(), round(m.emissiveIntensity)] : null }));
}
/** a Mesh's or Points' position buffer when it is rewritten per frame (stars, trail, arcs): its values are the trace */
export function dynamicPositions(o: THREE.Object3D): THREE.BufferAttribute | null {
  if (!isMesh(o) && !(o instanceof THREE.Points)) return null;
  const attributes: unknown = Reflect.get(Reflect.get(o, 'geometry') ?? {}, 'attributes') ?? {};
  const position: unknown = typeof attributes === 'object' && attributes !== null ? Reflect.get(attributes, 'position') : null;
  return position instanceof THREE.BufferAttribute && position.usage === THREE.DynamicDrawUsage ? position : null;
}
export function attributeSum(position: THREE.BufferAttribute): number {
  let sum = 0;
  for (let i = 0; i < position.count; i++) sum += position.getX(i) + position.getY(i) * 3 + position.getZ(i) * 7;
  return round(sum);
}
export function objectRow(o: THREE.Object3D): unknown {
  const row: unknown[] = [o.type, o.visible ? 1 : 0, ...v3(o.position), ...q4(o.quaternion), round(o.scale.x), round(o.scale.y), o.renderOrder];
  if (isMesh(o)) row.push(materialRow(o.material));
  const position = dynamicPositions(o);
  if (position !== null) row.push(attributeSum(position));
  if (o.children.length > 0) row.push(o.children.map(objectRow));
  return row;
}

/** happy-dom has no 2D raster backend: the procedural textures run against a pixel-buffer canvas port (call in beforeEach). */
export function mockCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    let pixels: ImageData = { data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: 'srgb' };
    const context: Partial<CanvasRenderingContext2D> = {
      createImageData: (input: number | ImageData, requestedHeight?: number) => {
        const width = typeof input === 'number' ? input : input.width;
        const height = typeof input === 'number' ? requestedHeight : input.height;
        if (height === undefined) throw new Error('Canvas height missing');
        return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: 'srgb' };
      },
      putImageData: (data) => { pixels = data; }, getImageData: () => pixels,
      strokeStyle: '', fillStyle: '', lineWidth: 1, beginPath: () => undefined, moveTo: () => undefined,
      lineTo: () => undefined, arc: () => undefined, stroke: () => undefined, fill: () => undefined,
      clearRect: () => undefined, fillRect: () => undefined, closePath: () => undefined, quadraticCurveTo: () => undefined,
      save: () => undefined, restore: () => undefined, rotate: () => undefined, translate: () => undefined,
      createLinearGradient: () => legacyDouble<CanvasGradient>({ addColorStop: () => undefined }),
      createRadialGradient: () => legacyDouble<CanvasGradient>({ addColorStop: () => undefined }),
    };
    return legacyDouble<CanvasRenderingContext2D>(context);
  });
}

/** Exact 390×844 portrait projection, hierarchy and raw geometry bytes of held parts.
 * This is pose/geometry parity; happy-dom supplies no raster backend. */
const portraitCamera = new THREE.PerspectiveCamera(72, 390 / 844, .08, 2600);
const portraitGeometry = new WeakMap<object, { versions: string; digest: string }>();
export function portraitHeldFrame(roots: readonly THREE.Object3D[]): string {
  const hash = createHash('sha256'), projection = new THREE.Matrix4();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      hash.update(JSON.stringify([object.type, object.visible, object.renderOrder, object.frustumCulled]));
      hash.update(new Uint8Array(Float64Array.from(object.matrixWorld.elements).buffer));
      projection.multiplyMatrices(portraitCamera.projectionMatrix, object.matrixWorld);
      hash.update(new Uint8Array(Float64Array.from(projection.elements).buffer));
      if (!(object instanceof THREE.Mesh)) return;
      const geometry: unknown = object.geometry, material: unknown = object.material;
      if (!(geometry instanceof THREE.BufferGeometry)) throw new Error('Missing portrait geometry');
      if (!(material instanceof THREE.Material) && !(Array.isArray(material) && material.every(item => item instanceof THREE.Material))) throw new Error('Missing portrait material');
      const input: unknown = geometry.attributes;
      if (input === null || typeof input !== 'object') throw new Error('Missing portrait attributes');
      const attributes = Object.entries(input).map(([name, attr]) => {
        if (!(attr instanceof THREE.BufferAttribute) && !(attr instanceof THREE.InterleavedBufferAttribute)) throw new Error('Missing raw geometry attribute');
        return [name, attr] as const;
      });
      const versions = attributes.map(([name, attr]) => `${name}:${attr instanceof THREE.InterleavedBufferAttribute ? attr.data.version : attr.version}`).join(',');
      let cached = portraitGeometry.get(geometry);
      if (cached === undefined || cached.versions !== versions) {
        const bytes = createHash('sha256');
        for (const [name, attr] of attributes) {
          bytes.update(JSON.stringify([name, attr.itemSize, attr.normalized]));
          const raw = attr instanceof THREE.InterleavedBufferAttribute ? attr.data.array : attr.array;
          bytes.update(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
        }
        const index = geometry.index;
        if (index !== null) bytes.update(new Uint8Array(index.array.buffer, index.array.byteOffset, index.array.byteLength));
        bytes.update(JSON.stringify([geometry.drawRange, geometry.groups]));
        cached = { versions, digest: bytes.digest('hex') }; portraitGeometry.set(geometry, cached);
      }
      hash.update(cached.digest);
      hash.update(JSON.stringify(materialRow(material)));
    });
  }
  return hash.digest('hex');
}

/** Full sequence digest of exact portrait frame hashes. */
export function portraitSequenceHash(frames: readonly string[]): string { return createHash('sha256').update(JSON.stringify(frames)).digest('hex'); }

import * as THREE from 'three';

/** one per-particle attribute after `position`: its width and whether it is rewritten every frame */
export interface ParticleAttr { readonly itemSize: 1 | 3; readonly dynamic: boolean }

/** A pool's data (E357 X5): its size, its extra attributes in geometry order, its material and draw order. */
export interface ParticlePoolSpec<K extends string> {
  readonly capacity: number;
  /** the attributes after `position`, in the geometry's order */
  readonly attributes: Readonly<Record<K, ParticleAttr>>;
  readonly material: THREE.Material;
  readonly renderOrder: number;
  /** where a free slot waits (y, metres): a pool whose material draws every point parks them out of sight. Omitted = 0 */
  readonly parkY?: number;
}

/**
 * One particle pool (E357 X5, 10 §X5): a ring of `capacity` points in one `THREE.Points` draw, never culled, with the
 * position / velocity / life arrays every pool steps and the pool's own attributes. A pool's emitter claims the next
 * slot (`claim()`, oldest first) and writes it; its update steps its own physics over the arrays and flags what changed.
 */
export class ParticlePool<K extends string = never> {
  readonly points: THREE.Points;
  readonly capacity: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly life: Float32Array;
  readonly posAttr: THREE.BufferAttribute;
  /** each declared attribute's array */
  readonly data: Readonly<Record<K, Float32Array>>;
  /** each declared attribute */
  readonly attr: Readonly<Record<K, THREE.BufferAttribute>>;
  private cursor = 0;

  constructor(spec: ParticlePoolSpec<K>) {
    const n = spec.capacity;
    this.capacity = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', (this.posAttr = new THREE.BufferAttribute(this.pos, 3)));
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    const data: Partial<Record<K, Float32Array>> = {}, attr: Partial<Record<K, THREE.BufferAttribute>> = {};
    for (const name of Object.keys(spec.attributes) as K[]) {
      const a = spec.attributes[name], arr = new Float32Array(n * a.itemSize), ba = new THREE.BufferAttribute(arr, a.itemSize);
      if (a.dynamic) ba.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, ba);
      data[name] = arr; attr[name] = ba;
    }
    this.data = data as Record<K, Float32Array>; this.attr = attr as Record<K, THREE.BufferAttribute>; // every key was filled above
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    if (spec.parkY !== undefined) for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = spec.parkY;
    this.points = new THREE.Points(g, spec.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = spec.renderOrder;
  }

  /** the next slot (the ring wraps onto the oldest) */
  claim(): number {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return i;
  }

  /** write slot `i`'s position */
  place(i: number, at: { x: number; y: number; z: number }): void {
    this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = at.y; this.pos[i * 3 + 2] = at.z;
  }
}

const _size = new THREE.Vector2();
/** pixels per metre at 1 m for a screen-sized point (`gl_PointSize = size * uScale / depth`): the drawing buffer's height
 *  over the camera's vertical field */
export function pointScale(renderer: { getDrawingBufferSize: (out: THREE.Vector2) => THREE.Vector2 }, camera: THREE.PerspectiveCamera): number {
  renderer.getDrawingBufferSize(_size);
  return _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

import * as THREE from 'three';
import { drawNeutral } from './drawNeutral';
import { ownedArray } from '../../../shared/engine/core/ownedBuffer';
import { GraphShaderMaterial } from './graph/glslMaterial';
import { copyShaderPatches, PATCH_ORDER, patchShader } from './shaderPatches';
import type { Scope } from '../../../shared/engine/app/scope';

/**
 * Cell-streamed instances (SHARD-PLATFORM W2, G441): the bookkeeping a scatter streamed round a viewer shares, with
 * nothing about what it places. `CellWindow` keys square cells, borrows authored or explicitly published cell data,
 * keeps at most `cacheMax` of them (oldest out first), and lists the cells within a radius, nearest first.
 * `InstanceTier` is one draw of instances as two InstancedMeshes on twin geometries (the model's attributes shared, the
 * per-instance ones each their own): the caller writes the next set into the back mesh, which uploads only what was
 * written, a byte budget at a time, and the two swap in one frame. What a cell holds, which instances show and what
 * each per-instance attribute means stay the caller's.
 *
 *   const cells = new CellWindow<number[]>(16, [{ cx: 0, cz: 0, value: [1, 2] }]);
 *   const tier = instanceTier(group, 'cover-fern', geometry, material, cap, [{ name: 'aTint', size: 3 }]);
 *   tier.begin(); const a = tier.arrays();
 *   for (const [cx, cz] of cells.within(x, z, r)) { … write a.matrix / a.attrs at instance tier.n, then tier.n++ }
 *   tier.upload(budgetBytes); if (tier.uploaded) tier.swap();
 */

/** Square cells of `size` m: each built once by `build` and cached (at most `cacheMax`, the oldest dropped first). */
export class CellWindow<T> {
  /** the most cells kept */
  cacheMax = 96;
  private readonly cells = new Map<string, T>();
  private readonly size: number;
  private readonly source = new Map<string, T>();

  /** Cells `size` m across, optionally seeded by plain authored rows. No content callback enters the cache. */
  constructor(size: number, rows: readonly { readonly cx: number; readonly cz: number; readonly value: T }[] = []) {
    if (!Number.isFinite(size) || size <= 0 || rows.length > 1048576 || rows.some(row => !Number.isSafeInteger(row.cx) || !Number.isSafeInteger(row.cz))) throw new Error('Invalid cell window rows');
    this.size = size;
    for (const row of rows) {
      const key = `${row.cx},${row.cz}`;
      if (this.source.has(key)) throw new Error('Duplicate cell window row');
      this.source.set(key, row.value);
    }
  }

  /** Whether cell (cx, cz) is built. */
  has(cx: number, cz: number): boolean { const key = `${cx},${cz}`; return this.cells.has(key) || this.borrowed.has(key); }
  /** authored cells read since the last `clear` (they count as built without entering the cache) */
  private readonly borrowed = new Set<string>();

  /** Read a cached or authored cell; unknown cells remain absent until explicitly published. An authored cell is read in
   *  place (G639: copying each into the 96-cell cache evicted and re-inserted hundreds of a scatter's cells every frame). */
  get(cx: number, cz: number): T | undefined {
    const key = `${cx},${cz}`, hit = this.cells.get(key);
    if (hit !== undefined) return hit;
    const authored = this.source.get(key);
    if (authored !== undefined) this.borrowed.add(key);
    return authored;
  }

  /** Publish one prepared cell and retain the existing oldest-first eviction policy. */
  set(cx: number, cz: number, made: T): T {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) throw new Error('Invalid cell window coordinates');
    const key = `${cx},${cz}`;
    if (this.cells.size > this.cacheMax) { const first = this.cells.keys().next().value; if (first !== undefined) this.cells.delete(first); }
    this.cells.set(key, made);
    return made;
  }

  /** Drop every built cell. */
  clear(): void { this.cells.clear(); this.borrowed.clear(); }

  private last: { px: number; pz: number; r: number; out: readonly [number, number, number][] } | null = null;
  /** The cells within `r` m of (px, pz) as [cx, cz, squared distance to the cell], nearest first. The same query as the
   *  last one returns its list again (a viewer standing still asks every frame); read it, never change it. */
  within(px: number, pz: number, r: number): readonly [number, number, number][] {
    const last = this.last;
    if (last?.px === px && last.pz === pz && last.r === r) return last.out;
    const out = this.query(px, pz, r); this.last = { px, pz, r, out }; return out;
  }
  private query(px: number, pz: number, r: number): [number, number, number][] {
    const c = this.size, out: [number, number, number][] = [];
    for (let cz = Math.floor((pz - r) / c); cz <= Math.floor((pz + r) / c); cz++) for (let cx = Math.floor((px - r) / c); cx <= Math.floor((px + r) / c); cx++) {
      const dx = Math.max(0, cx * c - px, px - (cx + 1) * c), dz = Math.max(0, cz * c - pz, pz - (cz + 1) * c);
      if (dx * dx + dz * dz <= r * r) out.push([cx, cz, dx * dx + dz * dz]);
    }
    return out.sort((a, b) => a[2] - b[2]);
  }
}

/** A per-instance attribute and its stored components. */
export interface InstanceAttr {
  readonly name: string;
  readonly size: number;
  readonly normalizedBytes?: boolean;
}

type InstanceWords = Float32Array | Uint8Array;
/** The back mesh's per-instance arrays: matrices, colours (a coloured tier) and the declared attributes in order. */
export interface InstanceArrays {
  readonly matrix: Float32Array;
  readonly yawScale: readonly [Float32Array, Float32Array] | null;
  readonly colour: Float32Array | null;
  readonly attrs: readonly InstanceWords[];
}

const floats = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): Float32Array => (a !== undefined && a.array instanceof Float32Array ? a.array : new Float32Array(0));

const STREAM_ORIGIN = 'wsStreamOrigin', STREAM_YAW_SCALE = 'wsStreamYawScale';

/** Exactly the matrix of a translation and a uniform yaw-scaled basis.
 * Three's raycast and bounds computations use the same coefficients as GLSL. */
class YawScaleMesh extends THREE.InstancedMesh {
  override getMatrixAt(index: number, target: THREE.Matrix4): THREE.Matrix4 {
    const position = this.geometry.getAttribute(STREAM_ORIGIN), basis = this.geometry.getAttribute(STREAM_YAW_SCALE);
    const c = basis.getX(index), s = basis.getY(index), sn = basis.getZ(index);
    return target.set(c, 0, sn, position.getX(index), 0, s, 0, position.getY(index), -sn, 0, c, position.getZ(index), 0, 0, 0, 1);
  }
}

function yawScaleMaterial(source: GraphShaderMaterial, owner: Scope): GraphShaderMaterial {
  const material = owner.own(source.clone());
  copyShaderPatches(source, material);
  patchShader(material, 'engine.streamed-yaw-scale', PATCH_ORDER.decorate, shader => {
    shader.vertexShader = `attribute vec3 ${STREAM_ORIGIN};
attribute vec3 ${STREAM_YAW_SCALE};
mat4 wsStreamMatrix() {
  vec3 q = ${STREAM_YAW_SCALE};
  return mat4( vec4( q.x, 0.0, -q.z, 0.0 ), vec4( 0.0, q.y, 0.0, 0.0 ),
    vec4( q.z, 0.0, q.x, 0.0 ), vec4( ${STREAM_ORIGIN}, 1.0 ) );
}
#define instanceMatrix wsStreamMatrix()
${shader.vertexShader}`;
  }, { key: key => `${key}|streamed-yaw-scale`, pureKey: true });
  return material;
}

/**
 * One draw of streamed instances on two meshes (see the module comment). The front one is drawn; `begin` starts the next
 * set in the back one, which is kept visible at count 0 while it fills — so three uploads what `upload` marked (only the
 * written instances) and draws none of it — and `swap` shows it in one frame.
 */
export class InstanceTier {
  /** the two meshes */
  readonly meshes: readonly [THREE.InstancedMesh, THREE.InstancedMesh];
  /** per-instance bytes */
  readonly bytesPer: number;
  /** instances written into the back mesh */
  n = 0;
  private readonly attrs: readonly InstanceAttr[];
  private readonly packed: boolean;
  private readonly coloured: boolean;
  private front = 0;
  private up = 0;
  /** each mesh has been drawn once, i.e. three has created its GPU buffers (a whole-cap bufferData): until then a mesh
   *  that leaves the front stays visible at count 0, so that happens in the boot's first frames, not mid-run */
  private readonly drawn = [false, false];

  /** The tier's two meshes and the per-instance attributes they carry. */
  constructor(meshes: readonly [THREE.InstancedMesh, THREE.InstancedMesh], attrs: readonly InstanceAttr[], packed = false, coloured: boolean = meshes[0].instanceColor !== null) {
    this.meshes = meshes;
    this.attrs = attrs;
    this.packed = packed; this.coloured = coloured;
    this.bytesPer = 4 * ((packed ? 6 : 16) + (coloured ? 3 : 0)) + attrs.reduce((bytes, attr) => bytes + attr.size * (attr.normalizedBytes === true ? 1 : 4), 0);
    meshes.forEach((m, i) => { m.onBeforeRender = drawNeutral(() => { this.drawn[i] = true; }); });
  }
  /** The mesh drawn. */
  get shown(): THREE.InstancedMesh { return this.meshes[this.front] ?? this.meshes[0]; }
  /** The mesh the next set is written into. */
  get back(): THREE.InstancedMesh { return this.meshes[1 - this.front] ?? this.meshes[1]; }
  /** The back mesh's per-instance arrays, to write the next set into. */
  arrays(): InstanceArrays {
    const b = this.back, col = this.coloured ? b.instanceColor : null;
    const attrs = this.attrs.map(({ name }): InstanceWords => {
      const attr = b.geometry.getAttribute(name);
      return attr?.array instanceof Uint8Array ? attr.array : floats(attr);
    });
    const yawScale = this.packed ? [floats(b.geometry.getAttribute(STREAM_ORIGIN)), floats(b.geometry.getAttribute(STREAM_YAW_SCALE))] as const : null;
    return { matrix: floats(b.instanceMatrix), yawScale, colour: col ? floats(col) : null, attrs };
  }
  /** Start the next set in the back mesh. */
  begin(): void { this.n = 0; this.up = 0; const b = this.back; b.count = 0; b.visible = true; }
  /** Everything written is marked for upload. */
  get uploaded(): boolean { return this.up >= this.n; }
  /** Mark up to `bytes` more of what was written for upload (Infinity: all of it); returns the bytes marked. */
  upload(bytes: number): number {
    const k = Math.min(this.n - this.up, Math.floor(bytes / this.bytesPer));
    if (k <= 0) return 0;
    const b = this.back;
    const pose = this.packed ? [b.geometry.getAttribute(STREAM_ORIGIN), b.geometry.getAttribute(STREAM_YAW_SCALE)] : [b.instanceMatrix];
    for (const a of [...pose, this.coloured ? b.instanceColor : null, ...this.attrs.map((x) => b.geometry.getAttribute(x.name))]) {
      if (!(a instanceof THREE.BufferAttribute)) continue;
      a.addUpdateRange(this.up * a.itemSize, k * a.itemSize); a.needsUpdate = true;
    }
    this.up += k;
    return k * this.bytesPer;
  }
  /** Show the back set (it must be uploaded) and retire the front one. */
  swap(): void {
    const b = this.back, f = this.shown;
    b.count = this.n; f.count = 0; f.visible = !(this.drawn[this.front] ?? false);
    this.front = 1 - this.front;
  }
}

/**
 * A tier of `cap` instances of `geometry` in `material` added to `parent`: the second mesh on a twin of the model (its
 * attributes shared: one GPU copy), each with its own dynamic matrices, colours (`coloured`) and `attrs`. Both start
 * visible at count 0, so the boot's first frames create both meshes' GPU buffers. Neither is frustum culled (the
 * window moves with the viewer) and neither casts a shadow unless `castShadow`.
 */
export function instanceTier(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, cap: number,
  attrs: readonly InstanceAttr[], options: { readonly coloured?: boolean; readonly castShadow?: boolean; readonly yawScaleOwner?: Scope } = {}): InstanceTier {
  const packedMaterial = material instanceof GraphShaderMaterial && options.yawScaleOwner !== undefined && options.castShadow !== true
    ? yawScaleMaterial(material, options.yawScaleOwner) : null;
  const packed = packedMaterial !== null, coloured = options.coloured === true;
  const twin = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geometry.attributes)) twin.setAttribute(k, a);
  twin.setIndex(geometry.getIndex());
  for (const gr of geometry.groups) twin.addGroup(gr.start, gr.count, gr.materialIndex);
  twin.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
  const make = (g: THREE.BufferGeometry): THREE.InstancedMesh => {
    const mesh = packedMaterial === null ? new THREE.InstancedMesh(g, material, cap) : new YawScaleMesh(g, packedMaterial, 0);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = options.castShadow ?? false; mesh.receiveShadow = true;
    if (packed) for (const attribute of [STREAM_ORIGIN, STREAM_YAW_SCALE]) {
      const words = ownedArray(Float32Array, cap * 3, { owner: 'engine/streamed-instances', asset: attribute, kind: 'array-buffer' });
      g.setAttribute(attribute, new THREE.InstancedBufferAttribute(words, 3).setUsage(THREE.DynamicDrawUsage));
    }
    else mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (coloured) { mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    else if (packedMaterial?.instanceColour === true) {
      const words = ownedArray(Float32Array, cap * 3, { owner: 'engine/streamed-instances', asset: 'white', kind: 'array-buffer' }).fill(1);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(words, 3);
    }
    for (const attr of attrs) {
      const label = { owner: 'engine/streamed-instances', asset: `${name}/${attr.name}`, kind: 'array-buffer' } as const;
      const array = attr.normalizedBytes === true ? ownedArray(Uint8Array, cap * attr.size, label) : ownedArray(Float32Array, cap * attr.size, label);
      const channel = new THREE.InstancedBufferAttribute(array, attr.size, attr.normalizedBytes === true);
      channel.setUsage(THREE.DynamicDrawUsage); g.setAttribute(attr.name, channel);
    }
    parent.add(mesh);
    return mesh;
  };
  return new InstanceTier([make(geometry), make(twin)], attrs, packed, coloured);
}

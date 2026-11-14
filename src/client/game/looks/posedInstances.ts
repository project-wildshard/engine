import { PosedLibrarySchema } from '@wildshard/format/namedJsonContracts';
import * as THREE from 'three';
import * as v from 'valibot';
import { TIER } from '@wildshard/engine/core/tier';
import { uploadTexture } from '@wildshard/engine/core/assets';
import { pageScope } from '@wildshard/engine/app/resources';
import { defineBakedModels } from '@wildshard/engine/models/model';
import { loadingSpecimen } from '@wildshard/engine/models/gear';
import { live, type RosterEntry } from '@wildshard/engine/models/live';
import { posedAssets, type PosedAssetSet } from '../plugin/geometry';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { lentLook, setLentParam, setLentTexture } from '../shardfile/lentLooks';
import type { PosedBufferPool, PosedBufferView } from './posedBufferPool';

/** One dynamic instance owner for shader-posed crowds. Geometry attributes,
 * material, channel meanings, decisions and clocks belong to the caller.
 * Owns only its wrapper and live matrix/vec4 buffers; source arrays are lent.
 * Pine uses two channels, Nalati's flock uses one `iAnim` channel (G441 W3).
 */

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One instanced mesh of posable packed models (see the module comment). */
export class PosedInstances {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly anim2: THREE.InstancedBufferAttribute | null;
  private readonly shared: PosedBufferView | null;
  private readonly m = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3(); private readonly s = new THREE.Vector3();
  private n = 0;

  /** `capacity` instances of the packed `src` (authored geometry) drawn in `material` (the shard's posed look) */
  constructor(capacity: number, name: string, material: THREE.Material, src: () => THREE.BufferGeometry, readonly channels: readonly [string, string?], buffers?: PosedBufferPool) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096 || channels.some(channel => channel !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(channel)) || channels[0] === channels[1]) throw new Error('Invalid posed instance capacity or channels');
    this.capacity = capacity;
    this.shared = buffers?.reserve(capacity, channels) ?? null;
    this.anim = new THREE.InstancedBufferAttribute(this.shared?.first ?? new Float32Array(capacity * 4), 4); this.anim.setUsage(THREE.DynamicDrawUsage);
    this.anim2 = channels[1] === undefined ? null : new THREE.InstancedBufferAttribute(this.shared?.second ?? new Float32Array(capacity * 4), 4); this.anim2?.setUsage(THREE.DynamicDrawUsage);
    const geo = this.wrap(src(), true);
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    if (this.shared !== null) this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(this.shared.matrix, 16);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(this.shared === null ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    // parked at zero scale until the first frame packs the live ones (the boot's precompile sees a drawn instance)
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** `src`'s attributes and index on an instanced geometry carrying this mesh's per-instance pose (`bound`: an
   *  everywhere bounding sphere, as the drawn mesh has) */
  wrap(src: THREE.BufferGeometry, bound: boolean): THREE.InstancedBufferGeometry {
    const geo = new THREE.InstancedBufferGeometry();
    for (const [key, attribute] of Object.entries(src.attributes)) geo.setAttribute(key, attribute);
    geo.setIndex(src.getIndex());
    if (this.shared !== null) geo.setAttribute('instanceMatrix', this.shared.matrixAttribute);
    geo.setAttribute(this.channels[0], this.shared?.firstAttribute ?? this.anim);
    if (this.anim2 !== null && this.channels[1] !== undefined) geo.setAttribute(this.channels[1], this.shared?.secondAttribute ?? this.anim2);
    if (bound) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return geo;
  }

  /** vertices in the shared geometry */
  get vertexCount(): number { return this.mesh.geometry.getAttribute('position').count; }

  /** start a frame: no instance drawn until `add`ed */
  begin(): void { this.n = 0; }
  /** draw one instance this frame at (x, y, z), turned by (−pitch, yaw, roll) in YXZ order, scaled; (a0..a3) → the first channel,
   *  (b0..b3) → the optional second channel (the live instances are packed at the front: nothing parked costs a vertex) */
  add(x: number, y: number, z: number, pitch: number, yaw: number, roll: number, scale: number, a0: number, a1: number, a2: number, a3: number, b0 = 0, b1 = 0, b2 = 0, b3 = 0): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.e.set(-pitch, yaw, roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale));
    this.mesh.setMatrixAt(i, this.m);
    const a = this.anim.array, b = this.anim2?.array, k = i * 4;
    a[k] = a0; a[k + 1] = a1; a[k + 2] = a2; a[k + 3] = a3;
    if (b !== undefined) { b[k] = b0; b[k + 1] = b1; b[k + 2] = b2; b[k + 3] = b3; }
  }
  /** draw exactly the instances added since `begin`. An empty draw reads no instance, so its arrays are not uploaded (Pine:
   *  an idle flock's draw sent all three every frame, 6 buffer calls with the page's own draw where legacy made 3); the
   *  next commit with copies uploads them whole. */
  commit(): void {
    this.mesh.count = this.n;
    if (this.n === 0) return;
    if (this.shared !== null) { this.shared.publish(); return; }
    this.mesh.instanceMatrix.needsUpdate = true; this.anim.needsUpdate = true; if (this.anim2 !== null) this.anim2.needsUpdate = true;
  }
}

/** Named numeric channels, with an optional threshold union selecting one lane. */
export type PosedLane = number | string | { readonly any: readonly { readonly field: string; readonly op: 'gt' | 'lt'; readonly value: number }[]; readonly yes: number; readonly no: number };
/** Channel meaning is data; the draw owns no motion or random stream. */
export interface PosedLayout {
  readonly name: string;
  readonly attributes: readonly [string, string?];
  readonly channels: readonly [readonly [PosedLane, PosedLane, PosedLane, PosedLane], (readonly [PosedLane, PosedLane, PosedLane, PosedLane])?];
  readonly scale?: number;
  /** turns every instance by this much about +y (a model authored facing the other way) */
  readonly yaw?: number | undefined;
  readonly glow?: string | undefined;
}
interface PosedLibrary { readonly name: string; readonly preload: () => Promise<void>; readonly draw: (capacity: number, buffers?: PosedBufferPool) => PosedDraw; readonly models: readonly RosterEntry[];
  /** the loaded library as a flock's look (its own posed draw packs it) */
  readonly look: () => { readonly name: string; readonly geometry: THREE.BufferGeometry; readonly material: THREE.Material; readonly yaw?: number } }
interface DrawPose { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number; readonly roll: number; readonly scale?: number }

/** Data-driven pose packing shared by free wildlife and platform flock draws.
 * The optional library reads named product geometry and Explorer rest cards;
 * both use precisely the same layout, material and immutable source arrays. */
export class PosedDraw {
  private static readonly libraries = new Map<string, Promise<PosedLibrary>>();
  readonly mesh: THREE.InstancedMesh;
  readonly look: { readonly name: string; readonly geometry: THREE.BufferGeometry; readonly material: THREE.Material };
  readonly glow: { value: number };
  private readonly posed: PosedInstances;
  private readonly lanes: readonly ((pose: DrawPose) => number)[];
  constructor(private readonly row: PosedLayout, capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material, buffers?: PosedBufferPool) {
    this.look = { name: row.name, geometry, material };
    this.posed = new PosedInstances(capacity, row.name, material, () => geometry, row.attributes, buffers?.supports(row.attributes) === true ? buffers : undefined);
    this.mesh = this.posed.mesh;
    const read = (pose: DrawPose, field: string): number => {
      const value: unknown = Reflect.get(pose, field);
      if (typeof value !== 'number') throw new Error(`Missing numeric posed field ${field}`);
      return value;
    };
    this.lanes = [...row.channels[0], ...row.channels[1] ?? [0, 0, 0, 0]].map(lane => {
      if (typeof lane === 'number') return () => lane;
      if (typeof lane === 'string') return pose => read(pose, lane);
      const checks = lane.any.map(test => test.op === 'gt'
        ? (pose: DrawPose) => read(pose, test.field) > test.value : (pose: DrawPose) => read(pose, test.field) < test.value);
      return pose => { for (const check of checks) if (check(pose)) return lane.yes; return lane.no; };
    });
    let glow = 0;
    this.glow = { get value() { return glow; }, set value(value: number) {
      if (value !== glow) { glow = value; if (row.glow !== undefined) setLentParam(row.name, row.glow, value); }
    } };
  }
  /** Begin packing the current visible roster. */
  begin(): void { this.posed.begin(); }
  /** Pack one pose without changing the caller's state or allocating a frame buffer. */
  add(pose: DrawPose): void {
    const lanes = this.lanes;
    this.posed.add(pose.x, pose.y, pose.z, pose.pitch, pose.yaw + (this.row.yaw ?? 0), pose.roll, this.row.scale ?? pose.scale ?? 1,
      lanes[0]?.(pose) ?? 0, lanes[1]?.(pose) ?? 0, lanes[2]?.(pose) ?? 0, lanes[3]?.(pose) ?? 0,
      lanes[4]?.(pose) ?? 0, lanes[5]?.(pose) ?? 0, lanes[6]?.(pose) ?? 0, lanes[7]?.(pose) ?? 0);
  }
  /** Publish exactly the packed instances. */
  commit(): void { this.posed.commit(); }

  /** Admit a named product library without eagerly loading its model assets.
   * Cards retain the normal loading specimen until their shared geometry is ready. */
  static library(product: Pick<ShardFolder, 'file' | 'url'>, name: string, load: typeof posedAssets = posedAssets): Promise<PosedLibrary> {
    const key = product.url(name);
    let library = this.libraries.get(key);
    if (library === undefined) { library = this.admitLibrary(product, name, load); this.libraries.set(key, library); }
    return library;
  }
  private static async admitLibrary(product: Pick<ShardFolder, 'file' | 'url'>, name: string, load: typeof posedAssets): Promise<PosedLibrary> {
    const row = v.parse(PosedLibrarySchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await product.file(name))));
    let assets: PosedAssetSet | null = null, loading: Promise<void> | null = null;
    const preload = (): Promise<void> => (loading ??= (async () => {
      const files = row.tiers[TIER];
      const set = await load({ ...row.assets, geometry: product.url(files.geometry), ...(files.atlas === undefined ? {} : { atlas: product.url(files.atlas) }) });
      // The library is page-wide but its atlas belongs to the scope that first drew it: a retired resident frees the
      // GPU allocation, and its compressed mips were dropped at that first draw, so it cannot upload again. Forget the
      // set with it; the next entry's preload loads a fresh one (a grid re-entry hit "lost its allocation" here).
      if (set.atlas !== null) pageScope.listenOnceEmitter(set.atlas, 'dispose', () => { if (assets === set) { assets = null; loading = null; } });
      assets = set;
    })());
    const ready = (): PosedAssetSet => { if (assets === null) throw new Error('Required posed library is not loaded'); return assets; };
    const draw = (capacity: number, buffers?: PosedBufferPool): PosedDraw => {
      const set = ready(), view = new PosedDraw(row, capacity, set.geometry, lentLook(row.name), buffers);
      if (row.atlas !== undefined && set.atlas !== null) { setLentTexture(row.name, row.atlas, set.atlas); uploadTexture(set.atlas); }
      return view;
    };
    const models = row.models.map(model => {
      const specimen = (): THREE.InstancedMesh => {
        const range = ready().ranges.find(entry => entry.kind === model.kind);
        if (range === undefined) throw new Error('Missing authored posed kind');
        const view = draw(1);
        view.mesh.geometry.setDrawRange(range.start, range.count);
        view.mesh.geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...range.box.slice(0, 3)), new THREE.Vector3(...range.box.slice(3)));
        view.begin(); view.add({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, scale: 1, ...model.pose }); view.commit();
        return view.mesh;
      };
      const metadata = { id: model.id, name: model.name, category: 'creatures' as const, pipeline: model.pipeline, file: model.file, surface: 'flesh' as const };
      const definition = defineBakedModels([metadata], () => assets === null ? loadingSpecimen(model.id, model.box, async () => { await preload(); return specimen(); }) : specimen())[0];
      if (definition === undefined) throw new Error('Missing posed model definition');
      return live(definition, { copies: model.copies, drawnAs: 'instanced' });
    });
    return { name: row.name, preload, draw, models, look: () => ({ name: row.name, geometry: ready().geometry, material: lentLook(row.name), ...(row.yaw === undefined ? {} : { yaw: row.yaw }) }) };
  }
}

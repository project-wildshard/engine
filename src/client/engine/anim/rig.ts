
import { retried } from '../boot/retry';
import {readModuleGroups} from '../boot/download';
import { type AnimationClip, type Object3D, type Texture, BufferGeometry, DefaultLoadingManager, InstancedBufferAttribute, InstancedMesh, LoadingManager, SkinnedMesh } from 'three';
import type * as RigParser from './rigParser';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rigAtlasReader } from './rigAtlas';
import { labelObjectTree } from '../render/gpuLabels';

export type ClipName = `${'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'die' | 'turn' | 'swim' | 'fly'}${'' | `.${string}`}`;
export type SocketName = string;
export interface RigContract { skeleton: string; clips: readonly ClipName[]; sockets: readonly SocketName[] }
/** Canonical → authored names. Metadata renames clips; the GLB and its tracks remain untouched. */
export interface RigBake {
  skeleton: string;
  clips?: Readonly<Partial<Record<ClipName, string>>>;
  sockets?: Readonly<Record<SocketName, string>>;
  /** Ordered joints per skin, as exported by the bake (never traversal order). */
  joints?: readonly (readonly string[])[];
  /** Procedural poses are declarations, not fabricated AnimationClips. */
  procedural?: readonly ClipName[];
}
export interface RigInstance {
  readonly root: Object3D;
  readonly contract: RigContract;
  readonly clips: ReadonlyMap<ClipName, AnimationClip>;
  readonly sockets: ReadonlyMap<SocketName, Object3D>;
}
export interface RigRef { url: string; contract: RigContract; bake: RigBake }

let preparing: Promise<typeof RigParser> | undefined;
/** Check compiler selection before the original asynchronous module import.
 * Parsed files and loader instances remain with their original owners. */
export function prepareRigLoader(): Promise<typeof RigParser> {
  readModuleGroups(['models.gltf']);
  if (preparing === undefined) {
    const pending = retried(() => import('./rigParser'));
    preparing = pending;
    void pending.catch(() => { if (preparing === pending) preparing = undefined; });
  }
  return preparing;
}

let loader: RigParser.RigLoader | undefined;
/** Cache/clone policy stays with the owning asset scope. All rig GLBs use this parser.
 * Optional resource aliases match the resolved URL pathname; both aliases and
 * ordinary dependencies retain the default manager's tier/pack resolution. */
export async function loadRigFile(url: string, aliases: Readonly<Record<string, string>> = {}): Promise<GLTF> {
  const { createRigLoader } = await prepareRigLoader();
  loader ??= createRigLoader();
  const read = Object.keys(aliases).length === 0 ? loader : createRigLoader(new LoadingManager());
  if (read !== loader) {
    const page = new URL(location.href), original = new URL(url, page);
    // Aliased glTFs can declare root-relative images. Three needs an absolute
    // original base to resolve those, rather than appending /assets twice.
    if (original.protocol === 'http:' || original.protocol === 'https:') read.setResourcePath(new URL('.', original).href);
    read.manager.setURLModifier(path => {
      const resolved = new URL(path, page);
      // The tier/pack tables use local paths; preserve that routing after Three
      // has resolved dependencies. External, data and blob URLs stay untouched.
      const request = (resolved.protocol === 'http:' || resolved.protocol === 'https:') && resolved.origin === page.origin
        ? `${resolved.pathname}${resolved.search}${resolved.hash}` : path;
      const served = DefaultLoadingManager.resolveURL(request), key = new URL(served, page).pathname;
      return DefaultLoadingManager.resolveURL(aliases[key] ?? request);
    });
  }
  const gltf = await read.loadAsync(url);
  applyExactInstanceMatrices(gltf.scene);
  labelObjectTree(gltf.scene, 'engine/loadRigFile', url);
  return gltf;
}

/** Decode verified product bytes through the same bounded parser, exact matrices and memory labels as a URL rig.
 * The caller owns byte admission; this performs no fetch and retains no settled wire buffer. */
export async function parseRigFile(bytes: Uint8Array, url: string): Promise<GLTF> {
  const { createRigLoader } = await prepareRigLoader();
  loader ??= createRigLoader();
  const file = await loader.parseBytesAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
  applyExactInstanceMatrices(file.scene);
  labelObjectTree(file.scene, 'engine/loadRigFile', url);
  return file;
}

/** Read the original first indexed/UV standard-material atlas for separately prepared geometry.
 * Uses the same bounded native parser; complex rigs retain full file intake. */
export async function loadRigAtlas(url: string): Promise<Texture | null> {
  const { createRigLoader } = await prepareRigLoader();
  const read = createRigLoader(), atlas = rigAtlasReader(read);
  const file = await read.loadAsync(url);
  return atlas(file.scene);
}

/** A loaded file's root object (its default scene's group): what a level's runtime reads instead of the loader's raw
 *  field. */
export function rigRoot(file: Pick<GLTF, 'scene'>): GLTF['scene'] { return file.scene; }

/** Check authored metadata against the actual loaded scene, without posing or rebinding it. */
export function bindRig(root: Object3D, animations: readonly AnimationClip[], contract: RigContract, bake: RigBake): RigInstance {
  const fail = (detail: string): never => { throw new Error(`[anim] ${contract.skeleton}: ${detail}`); };
  if (contract.skeleton === '' || bake.skeleton !== contract.skeleton) fail(`skeleton mismatch (${bake.skeleton})`);
  const clips = new Map<ClipName, AnimationClip>();
  for (const name of contract.clips) {
    const source = bake.clips?.[name] ?? name;
    const clip = animations.find((candidate) => candidate.name === source);
    if (clip !== undefined) clips.set(name, clip);
    else if (!bake.procedural?.includes(name)) fail(`missing clip ${name} (authored ${source})`);
  }
  const sockets = new Map<SocketName, Object3D>();
  for (const name of contract.sockets) {
    const source = bake.sockets?.[name] ?? name;
    const socket = root.getObjectByName(source);
    if (socket === undefined) fail(`missing socket ${name} (authored ${source})`);
    else sockets.set(name, socket);
  }
  if (bake.joints !== undefined) {
    const skins: string[][] = [];
    root.traverse((node) => { if (node instanceof SkinnedMesh) skins.push(node.skeleton.bones.map((bone) => bone.name)); });
    // Several meshes can share one exported skin; deduplicate by ordered joint array.
    const unique = [...new Map(skins.map((joints) => [JSON.stringify(joints), joints])).values()];
    const expected = [...new Map(bake.joints.map((joints) => [JSON.stringify(joints), joints])).values()];
    if (unique.length !== expected.length || expected.some((joints) => !unique.some((actual) => actual.length === joints.length && actual.every((name, i) => name === joints[i])))) fail('skin joint order differs from bake');
  }
  return { root, contract, clips, sockets };
}
export async function loadRig(ref: RigRef): Promise<RigInstance> {
  const file = await loadRigFile(ref.url);
  return bindRig(file.scene, file.animations, ref.contract, ref.bake);
}

/**
 * Restore admitted EXT_mesh_gpu_instancing._MATRIX float32 columns verbatim.
 * GLTFLoader retains this application attribute but otherwise composes identity
 * TRS; copy it before upload, then drop the unused geometry attribute. It already
 * loads _COLOR_0 directly into instanceColor without colour conversion. Absent
 * _MATRIX leaves the existing loader path and matrices untouched.
 */
export function applyExactInstanceMatrices(root: Object3D): void {
  root.traverse(object => {
    if (!(object instanceof InstancedMesh)) return;
    const geometry: unknown = object.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Invalid instance geometry');
    const matrix: unknown = geometry.getAttribute('_MATRIX');
    if (!(matrix instanceof InstancedBufferAttribute)) return;
    if (matrix.itemSize !== 16 || matrix.count !== object.count || matrix.normalized || !(matrix.array instanceof Float32Array)) throw new Error('Invalid exact instance matrix attribute');
    for (let i = 0; i < object.count; i++) for (let c = 0; c < 16; c++) object.instanceMatrix.setComponent(i, c, matrix.getComponent(i, c));
    object.instanceMatrix.needsUpdate = true;
    object.boundingBox = null; object.boundingSphere = null;
    geometry.deleteAttribute('_MATRIX');
  });
}

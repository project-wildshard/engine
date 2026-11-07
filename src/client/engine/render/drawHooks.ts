import { BatchedMesh, BufferGeometry, CompressedTexture, InstancedMesh, Material, MeshDepthMaterial, MeshDistanceMaterial, RenderTarget, Texture } from 'three';
import type { Renderer } from './renderer';
import { renderCounter } from './frameCounter';

type Draw = Renderer['renderBufferDirect'];
type ShadowDraw = (draw: Draw, camera: Parameters<Draw>[0], scene: Parameters<Draw>[1], geometry: Parameters<Draw>[2],
  material: MeshDepthMaterial | MeshDistanceMaterial, object: Parameters<Draw>[4], group: Parameters<Draw>[5]) => void;
type DrawTarget = Pick<Renderer, 'renderBufferDirect'>;
interface PropertyTarget { readonly properties: Pick<Renderer['properties'], 'get'> & Partial<Pick<Renderer['properties'], 'remove' | 'dispose'>> }

/** Renderer-local phases, in draw order. A material substitution encloses every
 * observer; admission precedes ownership, and only a successful submission can
 * retire CPU data. Registration never adds another renderer wrapper. */
interface DrawHooks {
  shadow?: ShadowDraw;
  depth: number;
  generation: number;
  ownerToken: symbol | null;
  retire?: ((complete: boolean) => void) | undefined;
  labels?: Draw | undefined;
  material?: (...args: Parameters<Draw>) => Parameters<Draw>[3] | null;
  ownership?: (draw: Draw, ...args: Parameters<Draw>) => void;
  memory?: Draw;
  uploads?: (() => void) | undefined;
}

interface Pipeline { draw: DrawHooks | undefined; properties: PropertyHooks | undefined; epoch: number }
const pipelines = new WeakMap<object, Pipeline>();
function pipelineOf(renderer: object): Pipeline {
  let pipeline = pipelines.get(renderer);
  if (pipeline === undefined) { pipeline = { draw: undefined, properties: undefined, epoch: 0 }; pipelines.set(renderer, pipeline); }
  return pipeline;
}
let observationRevision = 0;
/** A new upload callback rearms its texture even within a render. Omit the
 * texture to invalidate all ownership observations after native disposal. */
export function invalidatePropertyObservation(texture?: Texture): void {
  if (texture === undefined) observationRevision++;
  else resourceKind(texture).uploadRevision++;
}

/** The sole engine renderBufferDirect hook. Keep the renderer's current target:
 * third-party draw adapters installed before us must still run. */
export function drawHooks(renderer: DrawTarget): DrawHooks {
  const pipeline = pipelineOf(renderer), installed = pipeline.draw;
  if (installed !== undefined) return installed;
  const hooks: DrawHooks = { depth: 0, generation: 0, ownerToken: null };
  pipeline.draw = hooks;
  const draw = renderer.renderBufferDirect.bind(renderer);
  let continuation = false;
  const continueShadow: Draw = (camera, scene, geometry, material, object, group) => {
    continuation = true; submit(camera, scene, geometry, material, object, group);
  };
  function submit(camera: Parameters<Draw>[0], scene: Parameters<Draw>[1], geometry: Parameters<Draw>[2],
    material: Parameters<Draw>[3], object: Parameters<Draw>[4], group: Parameters<Draw>[5]): void {
    // Consume this continuation before entering native draw code: any nested
    // cast still takes its own shadow substitution and restores its own state.
    const continued = continuation; continuation = false;
    const shadow = continued || hooks.shadow === undefined ? null : resourceKind(material).shadow;
    if (shadow !== null && hooks.shadow !== undefined) {
      hooks.shadow(continueShadow, camera, scene, geometry, shadow, object, group); return;
    }
    if (hooks.depth === 0) hooks.generation++;
    hooks.depth++; pipeline.epoch++;
    let complete = false, submitted = false;
    try {
      hooks.labels?.(camera, scene, geometry, material, object, group);
      const selected = hooks.material === undefined ? material : hooks.material(camera, scene, geometry, material, object, group);
      if (selected !== null) {
        if (hooks.ownership === undefined) draw(camera, scene, geometry, selected, object, group);
        else hooks.ownership(draw, camera, scene, geometry, selected, object, group);
        submitted = true;
      }
      complete = true;
    } finally {
      hooks.depth--; pipeline.epoch++;
      if (hooks.depth === 0 && hooks.retire !== undefined) {
        const retire = hooks.retire; hooks.retire = undefined; retire(complete);
      }
    }
    hooks.memory?.(camera, scene, geometry, material, object, group);
    if (submitted) hooks.uploads?.();
  }
  renderer.renderBufferDirect = submit;
  return hooks;
}

interface PropertyHooks {
  texture?: (resource: Texture) => void;
  uploaded?: (resource: Texture) => void;
  compressed?: { before: (resource: CompressedTexture) => void; after: (resource: CompressedTexture, properties: unknown) => void };
  ownership?: (resource: unknown) => void;
  labels?: (resource: unknown, properties: unknown) => unknown;
  labelsVersion?: () => number;
}
interface ResourceKind { uploadRevision: number; texture: Texture | null; compressed: CompressedTexture | null; target: boolean; owned: boolean; shadow: MeshDepthMaterial | MeshDistanceMaterial | null }
const KIND = Symbol('renderer resource kind');
const frozenKinds = new WeakMap<object, ResourceKind>();
function resourceKind(resource: object): ResourceKind {
  const tagged: { readonly [KIND]?: ResourceKind } = resource;
  const known = tagged[KIND] ?? frozenKinds.get(resource);
  if (known !== undefined) return known;
  const texture = resource instanceof Texture ? resource : null, target = resource instanceof RenderTarget;
  const kind: ResourceKind = { uploadRevision: 0, texture, compressed: resource instanceof CompressedTexture ? resource : null, target,
    shadow: resource instanceof MeshDepthMaterial || resource instanceof MeshDistanceMaterial ? resource : null,
    owned: texture !== null || target || resource instanceof BufferGeometry || resource instanceof Material || resource instanceof InstancedMesh || resource instanceof BatchedMesh };
  // This non-enumerable record holds only its own resource. It has
  // no renderer, callback or Scope edge, so it cannot extend their lifetimes.
  if (Object.isExtensible(resource)) Object.defineProperty(resource, KIND, { value: kind });
  else frozenKinds.set(resource, kind);
  return kind;
}

/** One native property lookup, shared by allocation observers. The original
 * property identity reaches ownership/retirement before diagnostic proxies. */
export function propertyHooks(renderer: PropertyTarget): PropertyHooks {
  const pipeline = pipelineOf(renderer), installed = pipeline.properties;
  if (installed !== undefined) return installed;
  const hooks: PropertyHooks = {};
  pipeline.properties = hooks;
  const get = renderer.properties.get.bind(renderer.properties);
  let counter = renderCounter(renderer);
  // Reuse each weakly owned enrollment stamp across renders and retain it
  // beside the native row. Hot compressed reads need no second weak lookup.
  interface Enrollment { frame: number; revision: number; version: number }
  interface Observation { enrollment: Enrollment | null; native: unknown; textureVersion: number; kind: ResourceKind; frame: number; metadata: boolean; owner: symbol | null; revision: number; labels: number | undefined; value: unknown }
  let observed = new WeakMap<object, Observation>(), texturesSeen = new WeakMap<object, Enrollment>();
  let nativeEpoch = 0;
  const remove = renderer.properties.remove?.bind(renderer.properties), dispose = renderer.properties.dispose?.bind(renderer.properties);
  if (remove !== undefined) renderer.properties.remove = resource => {
    nativeEpoch++;
    if (typeof resource === 'object' && resource !== null) { observed.delete(resource); texturesSeen.delete(resource); }
    remove(resource);
  };
  if (dispose !== undefined) renderer.properties.dispose = () => { nativeEpoch++; observed = new WeakMap(); texturesSeen = new WeakMap<object, Enrollment>(); dispose(); };
  renderer.properties.get = (resource: unknown) => {
    if (typeof resource !== 'object' || resource === null) return get(resource);
    if (counter === undefined) {
      const frameCounter = renderCounter(renderer);
      if (frameCounter !== undefined) {
        counter = frameCounter;
        // The real renderer installs upload observation before its render
        // counter. Its first counted render must not reuse a per-draw epoch.
        observed = new WeakMap(); texturesSeen = new WeakMap<object, Enrollment>();
      }
    }
    const prior = observed.get(resource);
    // Native metadata has no upload, owner or label observer. Its mutable row
    // keeps one identity until the native remove/dispose paths above reset it.
    if (prior?.metadata === true) return prior.value;
    const drawing = pipeline.draw;
    const active = drawing !== undefined && drawing.depth > 0;
    const kind = prior?.kind ?? resourceKind(resource);
    // Compressed allocations keep their original once-per-submission checks.
    // Other native rows are mutable records: reuse their exact identity for
    // this render/consumer, until native removal or observer policy changes.
    const frame = counter !== undefined && kind.compressed === null ? counter.n : pipeline.epoch;
    const owner = drawing?.ownerToken ?? null;
    // Material/geometry/Source records always stay native. A texture-label
    // policy change cannot replace their rows or require another census read.
    const labelable = kind.texture !== null || kind.target;
    const labels = hooks.labels === undefined || !labelable ? 0 : hooks.labelsVersion?.();
    if (active && prior !== undefined && prior.frame === frame && prior.owner === owner
      && prior.revision === observationRevision && labels !== undefined && prior.labels === labels
      && (kind.texture === null || (prior.enrollment?.revision === observationRevision && prior.textureVersion === kind.uploadRevision))) return prior.value;
    const epoch = nativeEpoch;
    const texture = kind.texture, compressed = kind.compressed, textureVersion = kind.uploadRevision;
    // Enrollment is per texture/render; consuming-owner residency and
    // compressed sampler/allocation checks keep their original stamps below.
    // A late upload listener rearms only its resource; disposal keeps the
    // global revision invalidation for ownership and all enrollment stamps.
    let enrollment: Enrollment | null = prior?.enrollment ?? null;
    if (texture !== null) {
      const currentFrame = counter?.n ?? pipeline.epoch, enrollmentRevision = observationRevision;
      if (enrollment === null) {
        enrollment = texturesSeen.get(texture) ?? null;
        if (enrollment === null) {
          enrollment = { frame: -1, revision: -1, version: -1 };
          texturesSeen.set(texture, enrollment);
        }
      }
      if (!active || enrollment.frame !== currentFrame || enrollment.revision !== enrollmentRevision || enrollment.version !== textureVersion) {
        hooks.texture?.(texture); hooks.uploaded?.(texture);
        if (active) { enrollment.frame = currentFrame; enrollment.revision = enrollmentRevision; enrollment.version = textureVersion; }
      }
    }
    if (compressed !== undefined && compressed !== null) hooks.compressed?.before(compressed);
    // Native Source/camera/object metadata is not a disposable upload. The
    // ownership consumer previously repeated six class checks to ignore it.
    if (kind.owned) hooks.ownership?.(resource);
    const revision = observationRevision;
    // Three keeps a texture's mutable native row until remove/dispose. Keep
    // allocation and consuming-owner observations above on their original
    // cadence; reuse only that row identity, including its live upload fields.
    // An observer can invalidate it synchronously, so check the epoch after
    // every observer and fall back to the native producer on that path.
    const native: unknown = texture !== null && prior !== undefined && remove !== undefined && dispose !== undefined && epoch === nativeEpoch
      && prior.native !== null && typeof prior.native === 'object' ? prior.native : get(resource);
    const nativeAt = nativeEpoch;
    if (compressed !== undefined && compressed !== null) hooks.compressed?.after(compressed, native);
    const value = hooks.labels === undefined || !labelable ? native : hooks.labels(resource, native);
    if (nativeAt !== nativeEpoch) { observed.delete(resource); return value; }
    const metadata = !kind.owned && remove !== undefined && dispose !== undefined
      && native !== null && typeof native === 'object';
    if (prior === undefined) observed.set(resource, { enrollment, native, textureVersion, kind, frame: active ? frame : -1, metadata, owner, revision, labels, value });
    else { prior.enrollment = enrollment; prior.native = native; prior.textureVersion = textureVersion; prior.frame = active ? frame : -1; prior.metadata = metadata; prior.owner = owner; prior.revision = revision; prior.labels = labels; prior.value = value; }
    return value;
  };
  return hooks;
}

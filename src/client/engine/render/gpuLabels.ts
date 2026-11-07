import { Bone, BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Material, Object3D, RenderTarget, Skeleton, Texture, WebGLRenderTarget } from 'three';
import type { Renderer } from './renderer';
import { arrayReleased } from './releasedArrays';
import { isDev } from '../core/devMode';
import { memoryAttribution, withMemoryLabel } from '../../../shared/engine/core/memoryAttribution';
import { observeImageMemory, relabelImageMemory } from './memoryImages';
import { sceneObjectOwner, sceneResourceOwner } from '../app/sceneOwnership';
import { drawHooks, propertyHooks } from './drawHooks';

interface Label { owner: string; asset: string; priority: number }
const labels = new WeakMap<object, Label>();
let labelGeneration = 0;
let skeletonBridgeInstalled = false;
const isTexture = (value: unknown): value is Texture => value instanceof Texture;
const isGeometry = (value: unknown): value is BufferGeometry => value instanceof BufferGeometry;
const isMaterial = (value: unknown): value is Material => value instanceof Material;
const isObject = (value: unknown): value is Object3D => value instanceof Object3D;
const isTarget = (value: unknown): value is WebGLRenderTarget => value instanceof WebGLRenderTarget;
/** the GL handles three keeps in a resource's properties (the keys `/^__webgl(Texture|Depthbuffer|ColorRenderbuffer|DepthRenderbuffer)$/`) */
const GL_HANDLES = ['__webglTexture', '__webglDepthbuffer', '__webglColorRenderbuffer', '__webglDepthRenderbuffer'] as const;
const GL_ROLES = GL_HANDLES.map((key) => key.slice(7));
const GL_HANDLE_KEY = /^__webgl(?:Texture|Depthbuffer|ColorRenderbuffer|DepthRenderbuffer)$/u;
/**
 * SF57: the census walks the whole scene on every render and every draw. Its labels are now stable objects (interned per
 * parent label and role, cached per texture / draw / render target) and a source whose label, resolved label and identity
 * are unchanged is not observed or emitted again, so the walk allocates nothing once a resource is labelled. Before, its
 * fresh label objects, strings, entry arrays and WeakRefs were ≈ 80 % of the soak's JS allocation (≈ 275 MB/s against
 * ≈ 50 MB/s without the census, Chromium) and WebKit's footprint carried the garbage as 40–113 MB transients. The
 * resulting labels are identical: every skipped write would have rewritten the same value.
 */
const derived = new WeakMap<Label, Map<string, Label>>();
function derive(label: Label, role: string): Label {
  let roles = derived.get(label);
  if (roles === undefined) { roles = new Map(); derived.set(label, roles); }
  let child = roles.get(role);
  if (child === undefined) { child = { owner: label.owner, asset: `${label.asset}/${role}`, priority: label.priority }; roles.set(role, child); }
  return child;
}
/** the label `remember(resource, label)` would keep, without keeping it */
function resolved(resource: object, label: Label): Label {
  const previous = labels.get(resource);
  return previous && previous.priority >= label.priority ? previous : label;
}
const RENDERER_INTERNAL: Label = { owner: 'engine/renderer', asset: 'renderer-internal', priority: 0 };
function hook(name: string): unknown { return typeof window === 'undefined' ? undefined : Reflect.get(window, name); }
function census(): boolean { return typeof hook('__sc_label_gl') === 'function'; }
function sampledCensus(): boolean { return hook('__sc_gl_sample_labels') === true; }
function enabled(): boolean { return isDev() || census(); }
/** the census hooks as read at the current render's start (G639: two window lookups a draw were read per draw) */
let drawCensus = false, drawSampled = false;
function emit(name: string, resource: object, label: Label, identity?: object): void {
  if (name === '__sc_label_gl' && label.priority > 0) memoryAttribution.label(resource, label);
  const fn = hook(name);
  if (typeof fn === 'function') Reflect.apply(fn, window, [resource, label.owner, label.asset, identity]);
}
function remember(resource: object, label: Label): Label {
  const previous = labels.get(resource);
  if (previous && previous.priority >= label.priority) return previous;
  labels.set(resource, label);
  labelGeneration++;
  if (label.priority > 0) memoryAttribution.label(resource, label);
  return label;
}
/** Asset labels are weak scalar metadata; full scene walks remain Developer/census-only. */
export function labelAsset<T extends object>(resource: T, owner: string, asset: string): T {
  const label = remember(resource, { owner, asset: asset.split('?')[0] ?? asset, priority: 3 });
  if (enabled() && isTexture(resource)) markTexture(resource, label);
  return resource;
}
/** Texture clones retain the resolved file identity, including a KTX2 stand-in's actual URL. */
export function labelClone<T extends object>(resource: T, source: object, owner: string, asset: string): T {
  remember(resource, labels.get(source) ?? { owner, asset, priority: 3 });
  return resource;
}
export function labelledCreation<T>(owner: string, asset: string, create: () => T): T {
  const fn = hook('__sc_gl_scope');
  return withMemoryLabel({ owner, asset }, () => typeof fn === 'function' ? Reflect.apply(fn, window, [owner, asset, create]) as T : create());
}
interface Observed { label: Label; resolved: Label; identity: object | undefined }
const observed = new WeakMap<object, Observed>();
function data(source: unknown, label: Label, identity?: object): void {
  if (source === null || typeof source !== 'object') { observeImageMemory(source, label); return; }
  const seen = observed.get(source);
  if (seen?.label === label && seen.identity === identity && seen.resolved === resolved(source, label)) {
    relabelImageMemory(source, label); // a shared backing store or image keeps the census's last-write-wins label
    return;
  }
  observeImageMemory(source, label);
  const kept = remember(source, label);
  emit('__sc_label_source', source, kept, identity);
  if (seen === undefined) observed.set(source, { label, resolved: kept, identity });
  else { seen.label = label; seen.resolved = kept; seen.identity = identity; }
}
interface Named { inherited: Label; url: unknown; name: string; label: Label }
const named = new WeakMap<Texture, Named>();
/** the texture's file (or embedded-name) label for this inherited label, cached while its inputs stay the same */
function textureLabel(texture: Texture, inherited: Label, url: unknown): Label {
  const cached = named.get(texture);
  if (cached?.inherited === inherited && cached.url === url && cached.name === texture.name) return cached.label;
  const file = typeof url === 'string' && url.length > 0 && !url.startsWith('blob:') ? url.split('?')[0] : texture.name ? `${inherited.asset}/${texture.name}` : undefined;
  const label = file ? { ...inherited, asset: file } : inherited;
  named.set(texture, { inherited, url, name: texture.name, label });
  return label;
}
function markTexture(texture: Texture, fallback: Label): Label {
  const image: unknown = texture.image;
  // Three's ordinary clone shares its Source; the CPU image can also outlive the original loaded texture.
  const sourceLabel = labels.get(texture.source) ?? (image !== null && typeof image === 'object' ? labels.get(image) : undefined);
  const inherited = sourceLabel && sourceLabel.priority > fallback.priority ? sourceLabel : fallback;
  const current: unknown = image !== null && typeof image === 'object' ? Reflect.get(image, 'currentSrc') : undefined;
  const src: unknown = image !== null && typeof image === 'object' ? Reflect.get(image, 'src') : undefined;
  const url = typeof current === 'string' && current.length > 0 ? current : src;
  const label = remember(texture, textureLabel(texture, inherited, url));
  data(texture.source, label);
  data(image, label);
  if (image !== null && typeof image === 'object') data(Reflect.get(image, 'data'), label);
  for (const mip of texture.mipmaps) data(Reflect.get(mip, 'data'), label);
  return label;
}
function markMaterial(material: Material, label: Label): void {
  for (const role in material) {
    if (!Object.hasOwn(material, role)) continue;
    const value: unknown = Reflect.get(material, role);
    if (isTexture(value)) markTexture(value, derive(label, role));
  }
  const uniforms: unknown = Reflect.get(material, 'uniforms');
  if (uniforms !== null && typeof uniforms === 'object') for (const role in uniforms) {
    if (!Object.hasOwn(uniforms, role)) continue;
    const uniform: unknown = Reflect.get(uniforms, role);
    const value: unknown = uniform !== null && typeof uniform === 'object' ? Reflect.get(uniform, 'value') : undefined;
    if (Array.isArray(value)) { for (const item of value as readonly unknown[]) if (isTexture(item)) markTexture(item, derive(label, `uniform/${role}`)); }
    else if (isTexture(value)) markTexture(value, derive(label, `uniform/${role}`));
  }
}
function markGeometry(geometry: BufferGeometry, fallback: Label): void {
  const label = remember(geometry, fallback);
  const attribute = (value: BufferAttribute | InterleavedBufferAttribute, role: string): void => {
    if (arrayReleased(value)) return; // the Memory saver let its CPU copy go: touching `array` would read it back (SF22d)
    const array = value instanceof InterleavedBufferAttribute ? value.data.array : value.array;
    data(array, derive(label, role), value instanceof InterleavedBufferAttribute ? value.data : value);
  };
  if (geometry.index) attribute(geometry.index, 'index');
  const attributes = geometry.attributes, morphs = geometry.morphAttributes;
  for (const role in attributes) if (Object.hasOwn(attributes, role)) { const value = attributes[role]; if (value !== undefined) attribute(value, role); }
  for (const role in morphs) if (Object.hasOwn(morphs, role)) {
    const values: unknown = Reflect.get(morphs, role);
    if (Array.isArray(values)) for (let index = 0; index < values.length; index++) {
      const value: unknown = values[index];
      if (value instanceof BufferAttribute || value instanceof InterleavedBufferAttribute) attribute(value, `morph/${role}/${index}`);
    }
  }
}
function nodeResources(node: Object3D, label: Label): void {
  const geo: unknown = Reflect.get(node, 'geometry'), mats: unknown = Reflect.get(node, 'material');
  if (isGeometry(geo)) markGeometry(geo, label);
  for (const mat of Array.isArray(mats) ? mats : [mats]) if (isMaterial(mat)) markMaterial(mat, label);
  const skeleton: unknown = Reflect.get(node, 'skeleton');
  const bones: unknown = skeleton !== null && typeof skeleton === 'object' ? Reflect.get(skeleton, 'boneTexture') : undefined;
  if (skeleton instanceof Skeleton) {
    const owner = isGeometry(geo) ? labels.get(geo) ?? label : label;
    const boneLabel = remember(skeleton, derive(owner, 'skeleton/bones'));
    if (isTexture(bones)) markTexture(bones, boneLabel);
  } else if (isTexture(bones)) {
    const owner = isGeometry(geo) ? labels.get(geo) ?? label : label;
    markTexture(bones, derive(owner, 'skeleton/bones'));
  }
  for (const role in node) {
    if (!Object.hasOwn(node, role)) continue;
    const value: unknown = Reflect.get(node, role);
    if (value instanceof BufferAttribute) { if (!arrayReleased(value)) data(value.array, derive(label, role)); }
    else if (isTexture(value)) markTexture(value, derive(label, role));
  }
}
/** The scene walk's generic owner. SF64: a node under it is charged to its nearest owned ancestor, else to its first named
 *  ancestor below the drawn root (`scene:grid-deck`, `scene:region:pine-hollow`), so "engine/scene" keeps only unnamed paths. */
const SCENE_OWNER = 'engine/scene';
function subtreeOwner(name: string): string { return `scene:${name.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/?/iu, '').split('?')[0] ?? name}`; }
function walkOwner(owner: string, parent: Label | undefined, name: string): string {
  if (owner !== SCENE_OWNER) return owner;
  const inherited = parent === undefined || parent.owner === 'unattributed' || parent.owner === RENDERER_INTERNAL.owner ? SCENE_OWNER : parent.owner;
  return inherited === SCENE_OWNER && name.length > 0 ? subtreeOwner(name) : inherited;
}
function tree(root: Object3D, owner: string, asset: string, priority: number): void {
  // a node already labelled at this priority or higher keeps its label, so its path is built only when it is new
  const visit = (node: Object3D, parent: Label | null, index: number): void => {
    const previous = labels.get(node);
    const label = previous !== undefined && previous.priority >= priority ? previous
      : remember(node, { owner: parent === null ? owner : walkOwner(owner, parent, node.name),
        asset: parent === null ? asset : `${parent.asset}/${node.name || `${node.type}[${index}]`}`, priority });
    nodeResources(node, label);
    const children = node.children;
    for (let i = 0; i < children.length; i++) { const child = children[i]; if (child !== undefined) visit(child, label, i); }
  };
  visit(root, null, 0);
}
/**
 * SF69: the per-render walks (the scene each render, the drawn object each draw) without the census harness are
 * amortized. A node or drawn object is (re)labelled when it is new, when its geometry / material / skeleton changed, and
 * otherwise once per refresh window, spread over the window by its id, so labels for late-loaded images and new
 * attributes still arrive within the window and no single frame re-walks the world. A sampled census flushes exact labels on read; the explicit full-label harness keeps the full
 * walk on every render and draw. (Walking ~1.4 k visible nodes three times a frame with fresh strings was ≈ 40 % of the
 * desktop grid spawn's main thread, the periodic doubled frame.)
 */
const REFRESH = 240; // renders: ≈ 1–2 s at the game's three to four renders a frame
let generation = 0;
interface Walked { geometry: unknown; material: unknown; skeleton: unknown; version: number; at: number }
const walked = new WeakMap<object, Walked>();
const drawn = new WeakMap<object, Walked>();
function materialVersion(material: unknown): number {
  if (material instanceof Material) return material.version;
  let sum = 0;
  if (Array.isArray(material)) for (const m of material) if (m instanceof Material) sum += m.version;
  return sum;
}
/** true (and recorded) when `node`'s resources are due a (re)label this render */
function due(cache: WeakMap<object, Walked>, node: Object3D, geometry: unknown, material: unknown): boolean {
  const skeleton: unknown = Reflect.get(node, 'skeleton'), version = materialVersion(material);
  const seen = cache.get(node);
  if (seen !== undefined && seen.geometry === geometry && seen.material === material && seen.skeleton === skeleton && seen.version === version
    && Math.floor((generation + node.id) / REFRESH) === Math.floor((seen.at + node.id) / REFRESH)) return false;
  if (seen === undefined) cache.set(node, { geometry, material, skeleton, version, at: generation });
  else { seen.geometry = geometry; seen.material = material; seen.skeleton = skeleton; seen.version = version; seen.at = generation; }
  return true;
}
/**
 * The scene walk outside the census, swept in slices (op-floor, 2026-10-09). Visiting every node on every render, even
 * only to ask `due()`, was still ≈ 28 % of Pine Hollow's Developer main thread (work p95 15 ms against 8.5 ms with
 * Developer off; its cabin pose is GPU-bound at vsync, so the stalled submission doubled frames,
 * progress/frame-floor/2026-10-09-head/). The scene is flattened (pre-order, so a parent's label precedes its children)
 * once per sweep window (`SWEEP_WINDOW`, four refresh windows), and each render labels the next slice of that list. The
 * whole scene is covered within half a sweep window. Explicit census frames also label drawn objects immediately;
 * ordinary Developer draws leave that traversal to the sweep. Labels are diagnostics.
 */
interface Sweep { nodes: Object3D[]; parents: (Object3D | null)[]; indices: number[]; cursor: number; built: number }
const sweeps = new WeakMap<Object3D, Sweep>();
// G639 frame floor: the sweep re-walks the scene once every four refresh windows (≈ 4–8 s), not every window (~0.75 ms of a
// Developer Pine grid frame at 3080f174e5); explicit census frames still inspect every drawn object immediately
const SWEEP_WINDOW = REFRESH * 4;
const SWEEP_SLICES = SWEEP_WINDOW / 2;
// nodes a render labels at least, so a small scene is labelled within its first renders (G639: 64 a render was ~1.4 ms of a
// Pine frame at phone 4x, mostly on bones; the remaining scene still sweeps in well under a second)
const SWEEP_MIN = 16;
const onlyBones = (node: Object3D): boolean => node instanceof Bone && node.children.every(onlyBones);
function flatten(root: Object3D, built: number): Sweep {
  const sweep: Sweep = { nodes: [], parents: [], indices: [], cursor: 0, built };
  const visit = (node: Object3D, parent: Object3D | null, index: number): void => {
    // a hidden bone subtree (entities/animalMatrices.ts hides an animal's all-bone chains, ~80 % of Pine's scene graph)
    // holds nothing to label: bones own no resources, their skeleton's bone texture is labelled as it is allocated, and a
    // child attached later shows its chain again
    if (parent !== null && !node.visible && onlyBones(node)) return;
    sweep.nodes.push(node); sweep.parents.push(parent); sweep.indices.push(index);
    const children = node.children;
    for (let i = 0; i < children.length; i++) { const child = children[i]; if (child !== undefined) visit(child, node, i); }
  };
  visit(root, null, 0);
  return sweep;
}
function amortizedTree(root: Object3D, owner: string, asset: string, priority: number): void {
  let sweep = sweeps.get(root);
  if (sweep === undefined || generation - sweep.built >= SWEEP_WINDOW) { sweep = flatten(root, generation); sweeps.set(root, sweep); }
  const { nodes, parents, indices } = sweep, count = nodes.length;
  const end = Math.min(count, sweep.cursor + Math.max(SWEEP_MIN, Math.ceil(count / SWEEP_SLICES)));
  for (let k = sweep.cursor; k < end; k++) {
    const node = nodes[k], parent = parents[k] ?? null, index = indices[k] ?? 0;
    if (node === undefined || !due(walked, node, Reflect.get(node, 'geometry'), Reflect.get(node, 'material'))) continue;
    const parentLabel = parent === null ? undefined : labels.get(parent);
    const path = parent === null ? asset : `${parentLabel?.asset ?? asset}/${node.name || `${node.type}[${index}]`}`;
    const charged = parent === null ? owner : walkOwner(owner, parentLabel, node.name);
    nodeResources(node, remember(node, { owner: charged, asset: path, priority }));
  }
  sweep.cursor = end;
  if (end >= count) { sweep.nodes = []; sweep.parents = []; sweep.indices = []; sweep.cursor = 0; } // done: hold no retired nodes until the next window
}
/** Registered pieces and loaded GLBs keep a content path for procedural as well as file-backed geometry. */
export function labelObjectTree(root: Object3D, owner: string, asset: string): void {
  if (enabled()) tree(root, owner, asset, 2);
}
function resourceLabel(value: unknown): Label {
  if (value !== null && typeof value === 'object') {
    const known = labels.get(value);
    if (known) return known;
    if (isTexture(value)) {
      const owner = sceneResourceOwner(value);
      return markTexture(value, { owner: owner?.name ?? 'unattributed', asset: 'generated/texture', priority: owner === null ? 0 : 2 });
    }
    if (isTarget(value)) return targetLabel(value);
  }
  return RENDERER_INTERNAL;
}
interface TargetLabel { owner: string; name: string; width: number; height: number; label: Label }
const targets = new WeakMap<WebGLRenderTarget, TargetLabel>();
function targetLabel(target: WebGLRenderTarget): Label {
  const owner = sceneResourceOwner(target)?.name ?? 'engine/render-target', name = target.texture.name, cached = targets.get(target);
  if (cached?.owner === owner && cached.name === name && cached.width === target.width && cached.height === target.height) return cached.label;
  const label = { owner, asset: name || `generated/render-target/${target.width}x${target.height}`, priority: 1 };
  targets.set(target, { owner, name, width: target.width, height: target.height, label });
  return label;
}
interface DrawLabel { owner: string | null; own: Label | undefined; generated: string; label: Label }
const drawLabels = new WeakMap<object, DrawLabel>();
/** a draw's label: its scene owner's, else the object's own, else a generated one; cached while those stay the same */
function drawLabel(object: Object3D, mat: Material): Label {
  const owner = sceneObjectOwner(object)?.name ?? null, own = labels.get(object), generated = owner === null ? mat.name || mat.type : object.name || mat.name || mat.type;
  const cached = drawLabels.get(object);
  if (cached?.owner === owner && cached.own === own && cached.generated === generated) return cached.label;
  const label = owner === null ? own ?? { owner: 'unattributed', asset: `generated/${generated}`, priority: 0 }
    : { owner, asset: own?.asset ?? `generated/${generated}`, priority: 2 };
  drawLabels.set(object, { owner, own, generated, label });
  return label;
}
type LabelRenderer = Pick<Renderer, 'render' | 'compile' | 'compileAsync' | 'renderBufferDirect'> & {
  readonly properties: Pick<Renderer['properties'], 'get' | 'has'>;
};
const censusFlushers = new WeakMap<LabelRenderer, () => void>();
/** Developer/census-only upload labels; public property reads and draws bypass resource traversal. */
export function installGpuLabels(renderer: LabelRenderer, developer: () => boolean = isDev): void {
  // Bone textures are allocated inside Three after the scene walk, including one-shot warm draws and pooled rigs.
  // Tag that allocation immediately: a later scene walk cannot recover models that already left the visible tree.
  if (!skeletonBridgeInstalled) {
    skeletonBridgeInstalled = true;
    const compute: unknown = Reflect.get(Skeleton.prototype, 'computeBoneTexture');
    if (typeof compute !== 'function') throw new Error('Three Skeleton has no bone-texture allocator');
    Skeleton.prototype.computeBoneTexture = function computeBoneTexture() {
      Reflect.apply(compute, this, []);
      if (enabled() && this.boneTexture) markTexture(this.boneTexture, labels.get(this) ?? { owner: 'engine/skeleton', asset: 'generated/skeleton/bones', priority: 1 });
      return this;
    };
  }
  // Both directions are weak: neither the harness nor this registry keeps retired scenes/renderers alive.
  const sceneRefs = new Set<WeakRef<Object3D>>(), sceneSeen = new WeakSet<Object3D>();
  const resourceRefs = new Set<WeakRef<object>>(), resourceSeen = new WeakSet();
  const sampled = sampledCensus();
  const flush = (): void => {
    for (const weak of sceneRefs) {
      const scene = weak.deref();
      if (scene === undefined) sceneRefs.delete(weak);
      else tree(scene, SCENE_OWNER, `generated/${scene.name || scene.type}`, 1);
    }
    // The full walk can improve a texture label after its GL handle already exists.
    for (const weak of resourceRefs) {
      const resource = weak.deref();
      if (resource === undefined) resourceRefs.delete(weak);
      else if (renderer.properties.has(resource)) renderer.properties.get(resource);
    }
  };
  const register = hook('__sc_gl_register_labels');
  if (sampled && typeof register === 'function') {
    censusFlushers.set(renderer, flush);
    Reflect.apply(register, window, [flush]);
  }
  const proxies = new WeakMap<object, { proxy: object; label: Label; dirty: boolean }>();
  const tags = new WeakMap<object, { owner: string; base: string; priority: number }>();
  const tag = (resource: unknown, value: unknown, role: string): void => {
    if (Array.isArray(value)) { for (let index = 0; index < value.length; index++) tag(resource, value[index], `${role}/${index}`); return; }
    if (value === null || typeof value !== 'object') return;
    const label = resourceLabel(resource);
    // SF69: outside the census, a handle already tagged with this label is not re-tagged on every property read
    const last = tags.get(value);
    const same = last !== undefined && last.owner === label.owner && last.base === label.asset && last.priority === label.priority;
    // the census hooks as this render read them (G639: two window lookups a tagged handle on every properties read)
    if (same && (!drawCensus || drawSampled)) return;
    if (!same) tags.set(value, { owner: label.owner, base: label.asset, priority: label.priority });
    emit('__sc_label_gl', value, derive(label, role));
  };
  const property = propertyHooks(renderer);
  property.labelsVersion = () => drawCensus && !drawSampled ? Number.NaN : labelGeneration * 2 + (developer() || census() ? 1 : 0);
  property.labels = (resource, properties) => {
    if (!developer() && !census()) return properties;
    if (properties === null || typeof properties !== 'object' || (!isTexture(resource) && !(resource instanceof RenderTarget))) return properties;
    const label = resourceLabel(resource), prior = proxies.get(properties);
    // A proxy observes every later allocation write. Revisit existing handles
    // only for a changed label, writes made while diagnostics were off, or an
    // explicit full census. Ordinary material/geometry properties stay raw.
    if (prior !== undefined && prior.label === label && !prior.dirty && (!drawCensus || drawSampled)) return prior.proxy;
    if (sampled && resource !== null && typeof resource === 'object' && !resourceSeen.has(resource)) { resourceSeen.add(resource); resourceRefs.add(new WeakRef(resource)); }
    if (isTarget(resource)) {
      remember(resource.texture, derive(label, 'color'));
      if (resource.depthTexture) remember(resource.depthTexture, derive(label, 'depth'));
    }
    // three keeps the GL handles (GL_HANDLES) only in a texture's or a render target's properties: a material's, a
    // geometry's or an object's stay the plain object. Proxied, every field three reads of them on every draw (setProgram's
    // dozens) went through the proxy, which JavaScriptCore runs off its inline caches: the top render frame of a steady
    // Nalati Simulator profile with Developer on (sp-x1, b17146eb2f: NodeProgramVariants.select 217 of 5980 samples).
    // Assets initialized before joining a scene acquire their authored identity later; update the existing GL tag.
    for (let index = 0; index < GL_HANDLES.length; index++) {
      const key = GL_HANDLES[index], role = GL_ROLES[index];
      const value: unknown = key === undefined ? undefined : Reflect.get(properties, key);
      if (value !== undefined && role !== undefined) tag(resource, value, role);
    }
    if (prior !== undefined) { prior.label = label; prior.dirty = false; return prior.proxy; }
    const record = { proxy: properties, label, dirty: false };
    const stamp = (value: unknown, role: string): unknown => {
      if (Array.isArray(value)) {
        tag(resource, value, role);
        return new Proxy(value, { set(target, key, item: unknown) {
          if (!developer() && !census()) { record.dirty = true; return Reflect.set(target, key, item); }
          return Reflect.set(target, key, stamp(item, `${role}/${String(key)}`));
        } });
      }
      tag(resource, value, role);
      return value;
    };
    const proxy = new Proxy(properties, { set(target, key, value: unknown) {
      if (!developer() && !census()) { record.dirty = true; return Reflect.set(target, key, value); }
      const tagged = typeof key === 'string' && GL_HANDLE_KEY.test(key) ? stamp(value, key.slice(7)) : value;
      return Reflect.set(target, key, tagged);
    } });
    record.proxy = proxy; proxies.set(properties, record);
    return proxy;
  };
  const hooks = drawHooks(renderer);
  const labelDraw: Renderer['renderBufferDirect'] = (_camera, _scene, geo, mat, object) => {
    const own: unknown = Reflect.get(object, 'material');
    if (drawSampled && !due(drawn, object, geo, own)) return;
    const label = drawLabel(object, mat);
    markGeometry(geo, label); markMaterial(mat, label);
    if (Array.isArray(own)) for (const m of own as readonly unknown[]) if (isMaterial(m) && m !== mat) markMaterial(m, label);
  };
  for (const method of ['render', 'compile', 'compileAsync'] as const) {
    const original: unknown = Reflect.get(renderer, method);
    if (typeof original !== 'function') continue;
    Reflect.set(renderer, method, function labelledRender(this: Renderer, ...args: unknown[]): unknown {
      generation++; drawCensus = census(); drawSampled = sampledCensus();
      // Developer's amortized scene walk owns ordinary labels. Per-draw
      // traversal is reserved for explicit census frames.
      hooks.labels = drawCensus ? labelDraw : undefined;
      const scene = args[0];
      if ((developer() || census()) && isObject(scene)) {
        if (sampled && !sceneSeen.has(scene)) { sceneSeen.add(scene); sceneRefs.add(new WeakRef(scene)); }
        if (census() && !sampledCensus()) tree(scene, SCENE_OWNER, `generated/${scene.name || scene.type}`, 1);
        else amortizedTree(scene, SCENE_OWNER, `generated/${scene.name || scene.type}`, 1);
      }
      const result: unknown = Reflect.apply(original, this, args);
      return result;
    });
  }
}

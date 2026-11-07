import { BufferGeometry, Material, Texture, WebGLRenderTarget, Object3D, InstancedMesh, BatchedMesh } from 'three';
import { Scope, type Disposable3 } from '../../../shared/engine/app/scope';
import type { AssetService } from './assets';

/**
 * Each material's reachable resources (itself, its textures, targets and nested materials), kept until the current task
 * ends: a region's teardown releases its pieces one by one, and every piece's walk re-walked the same shared materials'
 * whole property graphs (node materials' graphs are deep; G639: 400-750 ms frames leaving Nine Dragon at phone 4x). A
 * material is not rewired while its owners tear down in one task, and the next task walks afresh.
 */
let materialWalks: WeakMap<Material, readonly Disposable3[]> | null = null;
const isMaterial = (value: object): value is Material => value instanceof Material;
const isTexture = (value: object): value is Texture => value instanceof Texture;
function materialResources(material: Material): readonly Disposable3[] {
  if (materialWalks === null) { const walks = new WeakMap<Material, readonly Disposable3[]>(); materialWalks = walks; queueMicrotask(() => { if (materialWalks === walks) materialWalks = null; }); }
  let known = materialWalks.get(material);
  if (known === undefined) { const walk = resourceCollector(undefined, material); walk.visit(material); known = [...walk.resources]; materialWalks.set(material, known); }
  return known;
}
/** One capture-local walk: shared materials and uniforms are inspected once, without retaining resources afterward.
 *  `walking`: the material this walk is for (walked here; any other material comes from `materialResources`). */
function resourceCollector(excludeNodes?: Pick<WeakSet<object>, 'has'>, walking?: Material): { resources: Set<Disposable3>; visit: (value: unknown) => void } {
  const resources = new Set<Disposable3>(), visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || visited.has(value) || ArrayBuffer.isView(value)) return;
    visited.add(value);
    if (isMaterial(value) && value !== walking && excludeNodes === undefined) { for (const resource of materialResources(value)) resources.add(resource); return; }
    if (value instanceof BufferGeometry || value instanceof Material || value instanceof Texture || value instanceof WebGLRenderTarget) {
      resources.add(value);
      if (value instanceof Texture || value instanceof BufferGeometry) return;
    }
    if (value instanceof Object3D) {
      if (!excludeNodes || excludeNodes.has(value)) return;
      value.traverse((node) => {
        for (const key of ['geometry', 'material', 'customDepthMaterial', 'customDistanceMaterial', 'shadow']) visit(Reflect.get(node, key));
      });
      return;
    }
    if (Reflect.get(value, 'isWebGLRenderer') === true || (typeof Node !== 'undefined' && value instanceof Node)) return;
    if (value instanceof Map || value instanceof Set) { for (const child of value.values()) visit(child); return; }
    for (const child of Object.values(value)) visit(child);
  };
  return { resources, visit };
}

/** Walk resource containers, stopping at scene nodes so the whole scene is never mistaken for an asset. */
export function containerResources(container: unknown, excludeNodes?: Pick<WeakSet<object>, 'has'>): Set<Disposable3> {
  const collector = resourceCollector(excludeNodes); collector.visit(container); return collector.resources;
}
interface DelegatedScene { scope: Scope; capture: () => void }
const delegatedScenes = new WeakMap<Object3D, DelegatedScene>();
/**
 * Each owned resource's owner, held weakly. A resource can outlive its owner (a cached or shared geometry reused by the
 * next visit), and a strong back-reference kept the owner's closed scope, and through its registries that visit's whole
 * world, alive for the resource's life: every retired grid region stayed resident (live P0, Driftwood -> Sky Reach ->
 * Driftwood on the phone; O18). Read through `ownerOf`: while the scope object lives it is returned as before (closed or
 * closing included); once collected, the owner reads as one closed scope.
 */
const resourceOwners = new WeakMap<object, WeakRef<Scope>>();
let collectedOwner: Scope | null = null;
function ownerOf(resource: object): Scope | undefined {
  const ref = resourceOwners.get(resource);
  if (ref === undefined) return undefined;
  const owner = ref.deref();
  if (owner !== undefined) return owner;
  if (collectedOwner === null) { collectedOwner = new Scope('collected-owner'); collectedOwner.dispose(); }
  return collectedOwner;
}
const textureLeases = new WeakMap<object, Set<Scope>>();
const resourceKeys = new WeakMap<object, string>();
let nextResourceKey = 0;
function resourceKey(resource: object): string {
  const known = resourceKeys.get(resource);
  if (known !== undefined) return known;
  const uuid: unknown = Reflect.get(resource, 'uuid');
  const key = typeof uuid === 'string' ? `scene:${uuid}` : `scene:object:${++nextResourceKey}`;
  resourceKeys.set(resource, key);
  return key;
}

/** Explicit owner of a captured scene resource; renderer observers keep counting it but never free it again. */
export function sceneResourceOwner(resource: object): Scope | null { return ownerOf(resource) ?? null; }

const standIns = new WeakMap<Object3D, { source: Object3D; owner: Scope | null }>();
let ownerGeneration = 0;
/** A detached copy drawn or compiled in place of `source` (the shader warm-up's stand-ins, SF57) uploads for `source`'s
 *  owner: its materials and geometry are `source`'s. */
export function linkStandIn(copy: Object3D, source: Object3D): void { standIns.set(copy, { source, owner: sceneObjectOwner(source) }); ownerGeneration++; }

const ownerPaths = new WeakMap<Object3D, { generation: number; parent: Object3D | null; root: WeakRef<Object3D> | null }>();
const watchedOwners = new WeakSet<Object3D>();
const ownerPathChanged = (): void => { ownerGeneration++; };

function rememberOwnerPath(node: Object3D, root: Object3D | null): void {
  // Three emits added/removed on the moved subtree root. Watch every ancestor
  // in the resolved path, so moving a whole branch invalidates its descendants.
  // Listeners capture no node or Scope; the object alone owns its listener.
  for (let parent: Object3D | null = node; parent !== root && parent !== null; parent = parent.parent) if (!watchedOwners.has(parent)) {
    watchedOwners.add(parent);
    parent.addEventListener('added', ownerPathChanged); parent.addEventListener('removed', ownerPathChanged);
  }
  ownerPaths.set(node, { generation: ownerGeneration, parent: node.parent, root: root === null ? null : new WeakRef(root) });
}

/** Nearest explicitly owned scene subtree, including meshes drawn through a shared page renderer. */
export function sceneObjectOwner(node: Object3D): Scope | null {
  const cached = ownerPaths.get(node);
  if (cached !== undefined && cached.generation === ownerGeneration && cached.parent === node.parent) {
    if (cached.root === null) return null;
    const root = cached.root.deref(), delegated = root === undefined ? undefined : delegatedScenes.get(root);
    if (delegated !== undefined) return delegated.scope;
  }
  for (let parent: Object3D | null = node; parent !== null; parent = parent.parent) {
    const delegated = delegatedScenes.get(parent);
    if (delegated !== undefined) { rememberOwnerPath(node, parent); return delegated.scope; }
    const source = standIns.get(parent);
    if (source !== undefined) return sceneObjectOwner(source.source) ?? source.owner;
  }
  rememberOwnerPath(node, null);
  return null;
}

/** Adopt scene resources; shared textures retire only after every using scope leaves.
 * Pass the asset service for cached inputs: their acquired references remain the sole disposal authority. */
export function ownSceneResource(resource: Disposable3, scope: Scope, assets?: Pick<AssetService, 'acquireResource'>): void {
  const releaseAsset = assets?.acquireResource(resource);
  if (releaseAsset !== undefined && releaseAsset !== null) { scope.onDispose(releaseAsset); return; }
  const owner = ownerOf(resource);
  // A final tree capture runs after this scope's resource cleanups. Its existing ownership still prevents a second
  // native disposal; only newly discovered resources need immediate capture on the already-closing scope.
  if (!isTexture(resource)) {
    if (owner !== undefined && (!owner.disposed || owner === scope || scope.sharesTeardown(owner))) {
      // O18: a live owner forgot the resource when it was disposed; a later use uploads it again, so it owns it again
      if (!owner.disposed && !owner.owns(resource)) owner.own(resource);
      return;
    }
    markResourceOwner(resource, scope); scope.own(resource); return;
  }
  if (owner === scope || (owner !== undefined && scope.sharesTeardown(owner))) return;
  let leases = textureLeases.get(resource);
  if (owner !== undefined && !owner.disposed && leases === undefined) return;
  if (leases?.has(scope)) return;
  if (leases === undefined || leases.size === 0) {
    leases = new Set();
    textureLeases.set(resource, leases);
  }
  const users = leases;
  users.add(scope);
  if (owner === undefined || owner.disposed) markResourceOwner(resource, scope);
  captureTextureLease(resource, scope, users);
}

// Keep the release closures' context out of the already-owned draw fast path.
function captureTextureLease(resource: Texture, scope: Scope, users: Set<Scope>): void {
  const release = (): boolean => {
    users.delete(scope);
    const next = users.values().next();
    if (!next.done) {
      if (ownerOf(resource) === scope) markResourceOwner(resource, next.value);
      return false;
    }
    return true;
  };
  // A backdrop may explicitly free a sampler before its delegated scope closes. Native disposal remains exact once.
  let disposed = false;
  const released = (): void => { disposed = true; };
  resource.addEventListener('dispose', released);
  scope.capture('textures', () => { resource.removeEventListener('dispose', released); if (release() && !disposed) resource.dispose(); });
}

function markResourceOwner(resource: Disposable3, scope: Scope): void {
  resourceOwners.set(resource, new WeakRef(scope));
  if (resource instanceof BatchedMesh) {
    // The batch frees these private allocations itself; renderer observations must not free them separately.
    for (const key of ['geometry', '_matricesTexture', '_indirectTexture', '_colorsTexture']) {
      const part: unknown = Reflect.get(resource, key);
      if (part instanceof BufferGeometry || part instanceof Texture) resourceOwners.set(part, new WeakRef(scope));
    }
  }
}

/** Give a subtree one explicit resource owner. Parent scene captures retain its census under that owner and never
 * take or free its resources. Nested delegated roots are independent; disposing them in either order is safe. */
export function ownSceneTree(root: Object3D, scope: Scope, assets: Pick<AssetService, 'isAcquired'>): void {
  if (scope.disposed || delegatedScenes.has(root)) throw new Error('Scene subtree requires one live owner');
  const capture = (): void => {
    const delegated: DelegatedScene[] = [];
    for (const resource of collectSceneResources(root, scope, delegated)) if (!assets.isAcquired(resource)) {
      ownSceneResource(resource, scope);
    }
    // Keep parent adoption before child capture, without a second full walk to rediscover the delegated roots.
    // A sibling retiring in this same synchronous parent teardown will run its own final capture shortly.
    // Live independent owners still need capture now; they can outlive this root.
    for (const child of delegated) if (!scope.sharesTeardown(child.scope)) child.capture();
  };
  delegatedScenes.set(root, { scope, capture });
  ownerGeneration++;
  // G598: a sliced retirement walks the subtree 256 nodes a step, then frees its resources 16 a step (Driftwood's world held
  // single 9-15 ms steps); `dispose()` runs it whole, in the same order. A stepped owner hides its tree first (a retiring
  // region's root)
  scope.onDisposeSteps(function* releaseSceneTree() {
    const delegated: DelegatedScene[] = [], collector = resourceCollector();
    yield* walkSceneResources(root, scope, delegated, collector);
    const resources = [...collector.resources];
    yield;
    for (let at = 0; at < resources.length; at += 16) {
      for (const resource of resources.slice(at, at + 16)) if (!assets.isAcquired(resource)) ownSceneResource(resource, scope);
      yield;
    }
    for (const child of delegated) if (!scope.sharesTeardown(child.scope)) child.capture();
    root.removeFromParent(); root.clear(); delegatedScenes.delete(root); ownerGeneration++;
  });
}
function captureDelegatedScenes(root: Object3D): void {
  const delegated = delegatedScenes.get(root);
  if (delegated !== undefined) { delegated.capture(); return; }
  for (const child of root.children) captureDelegatedScenes(child);
}

/** Resources a caller may own; explicit subtree owners are respected even when passed as the root. */
export function sceneResources(root: Object3D, owner?: Scope): Set<Disposable3> { return collectSceneResources(root, owner); }
function collectSceneResources(root: Object3D, owner?: Scope, delegatedRoots?: DelegatedScene[]): Set<Disposable3> {
  const collector = resourceCollector(), walk = walkSceneResources(root, owner, delegatedRoots, collector);
  while (walk.next().done !== true) { /* the whole walk at once */ }
  return collector.resources;
}
/** G598: the same pre-order walk over an explicit stack, yielding every 256 nodes (a stepped release walks a world's tree
 *  over several steps); delegated subtrees are left to their own owners. */
function* walkSceneResources(root: Object3D, owner: Scope | undefined, delegatedRoots: DelegatedScene[] | undefined,
  { resources, visit: collect }: ReturnType<typeof resourceCollector>): Generator<undefined, void> {
  const stack: Object3D[] = [root];
  for (let visited = 1; stack.length > 0; visited++) {
    const node = stack.pop();
    if (node === undefined) break;
    const delegated = delegatedScenes.get(node);
    if (delegated !== undefined && (node !== root || delegated.scope !== owner)) { delegatedRoots?.push(delegated); continue; }
    if (node instanceof InstancedMesh || node instanceof BatchedMesh) resources.add(node);
    for (const key of ['geometry', 'material', 'customDepthMaterial', 'customDistanceMaterial', 'shadow', 'environment', 'background', 'skeleton']) {
      // BatchedMesh.dispose owns its private aggregate geometry and internal textures.
      if (node instanceof BatchedMesh && key === 'geometry') continue;
      collect(Reflect.get(node, key));
    }
    for (let i = node.children.length - 1; i >= 0; i--) { const child = node.children[i]; if (child !== undefined) stack.push(child); }
    if (visited % 256 === 0) yield;
  }
}

export class SceneOwnership {
  /** The page's own nodes, held weakly: a node retained with the page can still leave with a narrower owner. The camera's
   *  subtree at the kit's retain holds the boot resident's held weapon, and a strong hold kept that weapon's material, and
   *  through its lighting hooks the boot resident's whole world, for the page's life (live P0, Driftwood -> Sky Reach ->
   *  Driftwood). `engineRefs` is the same census, walkable; refs to collected or forgotten nodes drop as it is walked. */
  private readonly engineNodes = new WeakSet<Object3D>();
  private readonly engineRefs = new Set<WeakRef<Object3D>>();
  private readonly nodeOwners = new WeakMap<Object3D, Scope>();
  private readonly acquired = new Set<Disposable3>();
  private readonly roots = new Set<Object3D>();
  private readonly scene: Object3D;
  private readonly level: Scope;
  private readonly assets: AssetService;
  constructor(scene: Object3D, level: Scope, assets: AssetService) { this.scene = scene; this.level = level; this.assets = assets; }
  retain(root: Object3D, scope: Scope = this.level): void {
    const nodes: Object3D[] = [];
    root.traverse((node) => { if (!this.engineNodes.has(node)) { this.engineNodes.add(node); this.engineRefs.add(new WeakRef(node)); } this.nodeOwners.set(node, scope); nodes.push(node); });
    // a retired owner's nodes leave the page's census with it (live P0: a retired grid region's nodes, and through their
    // materials the region, stayed in this set for the page's life)
    if (scope !== this.level) scope.onDispose(() => { for (const node of nodes) if (this.nodeOwners.get(node) === scope) this.engineNodes.delete(node); });
    for (const resource of sceneResources(root)) this.acquire(resource, scope);
  }
  retainContainer(container: unknown, scope: Scope = this.level): void {
    for (const resource of containerResources(container, this.engineNodes)) this.acquire(resource, scope);
    // Shadow targets and bone textures are allocated lazily after the engine nodes were first retained.
    for (const node of this.liveEngineNodes()) for (const key of ['geometry', 'material', 'customDepthMaterial', 'customDistanceMaterial', 'shadow', 'environment', 'background', 'skeleton']) {
      for (const resource of containerResources(Reflect.get(node, key))) this.acquire(resource, this.nodeOwners.get(node) ?? this.level);
    }
  }
  private *liveEngineNodes(): Generator<Object3D> {
    for (const ref of this.engineRefs) {
      const node = ref.deref();
      if (node === undefined || !this.engineNodes.has(node)) this.engineRefs.delete(ref); else yield node;
    }
  }
  retainedNodeCount(): number {
    let count = 0; this.scene.traverse((node) => { if (this.engineNodes.has(node)) count++; }); return count;
  }
  private acquire(resource: Disposable3, scope = this.level): void {
    const owner = sceneResourceOwner(resource);
    if (this.acquired.has(resource) || (owner !== null && !owner.disposed)) return;
    let release = this.assets.acquireResource(resource);
    if (release === null) {
      const key = resourceKey(resource);
      this.assets.register(key, resource);
      this.assets.acquire(key);
      release = () => { this.assets.release(key); };
    }
    this.acquired.add(resource);
    scope.onDispose(() => { release(); this.acquired.delete(resource); });
  }
  capture(): void {
    if (this.level.disposed) return;
    const visit = (node: Object3D): void => {
      const delegated = delegatedScenes.get(node);
      if (delegated !== undefined) { delegated.capture(); return; }
      captureDelegatedScenes(node);
      if (this.engineNodes.has(node)) { for (const child of node.children) visit(child); return; }
      if (!this.roots.has(node)) {
        this.roots.add(node);
        this.level.capture('nodes', () => { node.removeFromParent(); });
      }
      for (const resource of sceneResources(node)) {
        if (this.assets.isAcquired(resource)) this.acquire(resource);
        else ownSceneResource(resource, this.level);
      }
    };
    for (const child of this.scene.children) visit(child);
  }
}

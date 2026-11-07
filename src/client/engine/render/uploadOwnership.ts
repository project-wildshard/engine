import { BufferGeometry, Material, Texture, WebGLRenderTarget, InstancedMesh, BatchedMesh, type Object3D, type WebGLRenderer } from 'three';
import { ownSceneResource, sceneObjectOwner, sceneResourceOwner } from '../app/sceneOwnership';
import type { Scope } from '../../../shared/engine/app/scope';
import type { AssetService } from '../app/assets';
import { shaderPatchTextures } from './shaderPatches';
import { renderCount, type Renders } from './frameCounter';
import { drawHooks, invalidatePropertyObservation, propertyHooks } from './drawHooks';

function eventMethod(resource: object, method: 'addEventListener' | 'removeEventListener', listener: () => void): void {
  const fn: unknown = Reflect.get(resource, method);
  if (typeof fn === 'function') Reflect.apply(fn, resource, ['dispose', listener]);
}

const postSamplers = new WeakSet<Texture>();
/** A generated backdrop sampler retires with its layer. Unowned full-screen
 * post passes borrow it; explicitly owned scene consumers can still share it.
 * Cached inputs keep the asset service as their sole disposal authority.
 */
export function ownPostSampler(texture: Texture, owner: Scope): void {
  ownSceneResource(texture, owner); postSamplers.add(texture);
}

type Resource = BufferGeometry | Material | Texture | WebGLRenderTarget | InstancedMesh | BatchedMesh;
const isResource = (value: unknown): value is Resource => value instanceof BufferGeometry || value instanceof Material ||
  value instanceof Texture || value instanceof WebGLRenderTarget || value instanceof InstancedMesh || value instanceof BatchedMesh;
type ObservedRenderer = Pick<WebGLRenderer, 'properties' | 'renderBufferDirect'> & Partial<Pick<WebGLRenderer, 'compile' | 'compileAsync' | 'render'>>;
const renders = (renderer: ObservedRenderer): renderer is ObservedRenderer & Renders => renderer.render !== undefined;
/** The resources a material's program and samplers upload with: the material, its maps and its uniform samplers. */
function materialUploads(material: Resource): Resource[] {
  const out: Resource[] = [material];
  if (material instanceof Material) out.push(...shaderPatchTextures(material));
  for (const value of Object.values(material)) if (value instanceof Texture) out.push(value);
  const uniforms: unknown = Reflect.get(material, 'uniforms');
  if (typeof uniforms === 'object' && uniforms !== null) {
    for (const uniform of Object.values(uniforms)) {
      const value: unknown = typeof uniform === 'object' && uniform !== null ? Reflect.get(uniform, 'value') : undefined;
      if (value instanceof Texture) out.push(value);
    }
  }
  return out;
}

/** Renderer-local ownership of uploaded resources, including generated and detached resources.
 * No EventDispatcher prototype changes: this renderer reports its own property lookups and draws.
 *
 * SF57 round 4 (every GPU upload has an owner): an upload is attributed to its owner when it is made: the drawn object's
 * scene owner, or, for a `compile()` (the shader warm-up's detached stand-ins), the owner of each compiled object (a
 * stand-in resolves to the mesh it stands in for, `linkStandIn`). An owned upload is freed with that owner. What has no
 * owner at upload (an engine-global resource, or a build's resource whose scene owner is not known yet) is held weakly:
 * the page level still frees it at its end, and a later owned draw adopts it, but this set never keeps it alive. One
 * collected without a dispose is counted (`orphansCollected`), so an unowned allocation stays visible.
 */
export class UploadOwnership {
  /** Uploads with an owner (or a named acquisition): their owner keeps them alive and frees them. */
  private readonly owned = new Set<Resource>();
  /** Uploads with no owner yet, held weakly. */
  private readonly orphans = new Set<WeakRef<Resource>>();
  private readonly orphanRefs = new WeakMap<Resource, WeakRef<Resource>>();
  /** Every observed upload's lifetime hooks, registered once. */
  private readonly tracked = new WeakSet<Resource>();
  private collected = 0;
  /** A compiled object's samplers and geometry, with that object's owner: their own upload (the warm-up's texture pass,
   *  a later draw) is attributed to it when no drawn owner is known then. A hint never observes a resource by itself, and
   *  never keeps its owner alive: a cached resource outlives the region that first drew it (live P0; O18). */
  private readonly hints = new WeakMap<Resource, WeakRef<Scope>>();
  private readonly acquisitions = new WeakMap<Resource, WeakSet<Scope>>();
  /** Resources whose dispose is being dispatched now: three's own dispose handler looks them up after ours ran
   *  (deallocateTexture / deallocateMaterial call properties.get), which is not an upload. Cleared after the task. */
  private readonly releasing = new WeakSet();
  private readonly finalizer = new FinalizationRegistry<{ ref: WeakRef<Resource>; forget: () => void }>((held) => {
    if (this.orphans.delete(held.ref)) this.collected++;
    held.forget();
  });
  private readonly level: Scope;
  private readonly assets: AssetService;
  private drawOwner: Scope | null = null;
  /** the current draw's owner token (`ownerIds` of `drawOwner`), resolved once a draw; undefined = none resolved (no draw,
   *  or a compile walk), which no observation matches */
  private drawOwnerId: symbol | null | undefined = undefined;
  private drawDepth = 0;
  /** G639 frame floor: the engine render a draw belongs to (a test double without `render`: one generation per draw). A
   *  resource already observed in this render for the same consumer is not observed again: three asks for a material's
   *  and texture's properties several times a draw, and a shared material or texture is drawn many times a render. */
  private drawGen = 0;
  private drawGens = 0;
  // A long-lived sampler must not keep its last resident Scope/world alive.
  // Tokens preserve identity; neither a token nor a weak key retains its Scope.
  private readonly ownerIds = new WeakMap<Scope, symbol>();
  private readonly observedIn = new WeakMap<object, { render: number; owner: symbol | null }>();
  /** Stable lifetime authority is independent of the per-render residency pulse.
   * Tokens retain neither the resource's owner nor its last consuming scope. */
  private readonly settledIn = new WeakMap<Resource, { consumer: symbol | null; owner: symbol | null; acquired: boolean; drawing: boolean }>();
  private readonly settledOwners = new WeakMap<Resource, WeakMap<Scope, { owner: symbol | null; acquired: boolean }>>();
  constructor(level: Scope, assets: AssetService) { this.level = level; this.assets = assets; }
  /** A snapshot of the live uploads (owned, and the unowned ones not yet collected). */
  resources(): ReadonlySet<object> {
    const out = new Set<object>(this.owned);
    for (const ref of this.orphans) { const resource = ref.deref(); if (resource !== undefined) out.add(resource); }
    return out;
  }
  has(resource: object): boolean {
    return isResource(resource) && (this.owned.has(resource) || this.isOrphan(resource));
  }
  /** Live unowned uploads, and how many were garbage collected without a dispose (their GPU allocation was never freed). */
  orphanCensus(): { readonly live: number; readonly collected: number } {
    let live = 0; for (const ref of this.orphans) if (ref.deref() !== undefined) live++;
    return { live, collected: this.collected };
  }
  private ownerId(scope: Scope | null): symbol | null {
    if (scope === null) return null;
    let owner = this.ownerIds.get(scope);
    if (owner === undefined) { owner = Symbol('upload owner'); this.ownerIds.set(scope, owner); }
    return owner;
  }
  private isOrphan(resource: Resource): boolean {
    const ref = this.orphanRefs.get(resource);
    return ref !== undefined && this.orphans.has(ref);
  }
  observe(value: unknown): void {
    // FC: a resource already observed in this render for this draw's owner, the common case (several property reads a
    // draw, shared materials and textures), returns before the type checks; `observedIn` only ever holds resources
    if (this.drawDepth > 0 && typeof value === 'object' && value !== null) {
      const seen = this.observedIn.get(value);
      if (seen !== undefined && seen.render === this.drawGen && seen.owner === this.drawOwnerId) return;
    }
    if (this.level.disposed || !isResource(value)) return;
    this.observeResource(value);
  }
  /** Draw arguments are already typed resources; avoid repeating runtime
   * classification and its first cache lookup on every submission. */
  private observeResource(resource: Resource): void {
    if (this.level.disposed) return;
    if (this.drawDepth > 0) {
      const owner = this.drawOwnerId ?? null;
      const seen = this.observedIn.get(resource);
      if (seen === undefined) this.observedIn.set(resource, { render: this.drawGen, owner });
      else if (seen.render === this.drawGen && seen.owner === owner) return;
      else { seen.render = this.drawGen; seen.owner = owner; }
    }
    const acquired = this.assets.isAcquired(resource);
    const consumer = this.drawOwner ?? (this.drawDepth > 0 ? this.level : this.hints.get(resource)?.deref() ?? null);
    const previousOwner = sceneResourceOwner(resource), settled = this.settledIn.get(resource);
    const drawing = this.drawDepth > 0, consumerKey = drawing ? this.drawOwnerId ?? null : this.ownerId(consumer);
    if (settled !== undefined && settled.drawing === drawing && settled.consumer === consumerKey && settled.acquired === acquired
      && settled.owner === this.ownerId(previousOwner) && (previousOwner === null || !previousOwner.disposed)) {
      // Lifetime ownership/acquisition is already installed. Residency still
      // observes the first use in EVERY render, preserving eviction authority.
      this.assets.observeResidency(resource, acquired ? consumer ?? previousOwner : previousOwner ?? this.drawOwner);
      return;
    }
    if (drawing && consumer !== null) {
      const known = this.settledOwners.get(resource)?.get(consumer);
      if (known !== undefined && known.acquired === acquired && known.owner === this.ownerId(previousOwner)
        && (previousOwner === null || !previousOwner.disposed)) {
        // Alternating consumers keep their already-installed lifetime leases.
        // Residency still sees every original render/owner transition.
        this.assets.observeResidency(resource, acquired ? consumer : previousOwner ?? this.drawOwner);
        return;
      }
    }
    if (acquired && consumer !== null) this.retainAsset(resource, consumer);
    // Uniform samplers and lazily allocated targets need not be reachable from the material's public properties.
    // Their actual draw still identifies the subtree owner, even if an asynchronous build uploaded them earlier.
    if (!acquired) {
      // A full-screen post draw has no delegated scene owner. It samples a region's LUT
      // without becoming another lifetime owner of that explicitly owned texture.
      const existing = sceneResourceOwner(resource);
      const using = this.drawOwner ?? (this.drawDepth > 0 && resource instanceof Texture && (!postSamplers.has(resource) || existing === null || existing.disposed) ? this.level : null);
      if (using !== null && !using.disposed) ownSceneResource(resource, using);
      else if (sceneResourceOwner(resource)?.disposed === true) {
        // SF57: three's own dispose handlers look the resource up (deallocateMaterial / deallocateTexture call
        // properties.get) while its owner is tearing it down. That lookup is not a use: adopting there made the page's
        // level own every retired resident's materials and textures for the page's life.
        if (sceneResourceOwner(resource)?.disposing === true) return;
        // A CPU-backed sampler can be uploaded again outside its former subtree. Its expired owner cannot
        // retire that new allocation; adopt it into this live renderer lifetime before the property lookup.
        ownSceneResource(resource, this.level);
      } else if (sceneResourceOwner(resource) === null) {
        const hint = this.hints.get(resource)?.deref();
        if (hint !== undefined && !hint.disposed) ownSceneResource(resource, hint);
      }
    }
    const owner = sceneResourceOwner(resource);
    this.assets.observeResidency(resource, acquired ? consumer ?? owner : owner ?? this.drawOwner);
    if (owner !== null || acquired) this.hold(resource);
    else this.holdWeakly(resource);
    if (owner !== null || acquired) {
      const authority = this.ownerId(owner);
      if (settled === undefined) this.settledIn.set(resource, { consumer: consumerKey, owner: authority, acquired, drawing });
      else { settled.consumer = consumerKey; settled.owner = authority; settled.acquired = acquired; settled.drawing = drawing; }
      if (drawing && consumer !== null) {
        let consumers = this.settledOwners.get(resource);
        if (consumers === undefined) { consumers = new WeakMap(); this.settledOwners.set(resource, consumers); }
        const known = consumers.get(consumer);
        if (known === undefined) consumers.set(consumer, { owner: authority, acquired });
        else { known.owner = authority; known.acquired = acquired; }
      }
    }
  }
  /** A sampler binding is a real cache consumer, including page meshes outside delegated cell roots. */
  private retainAsset(resource: Resource, owner: Scope): void {
    if (owner.disposed || this.acquisitions.get(resource)?.has(owner)) return;
    const release = this.assets.acquireResource(resource);
    if (release === null) return;
    let users = this.acquisitions.get(resource);
    if (users === undefined) { users = new WeakSet(); this.acquisitions.set(resource, users); }
    users.add(owner); owner.onDispose(release);
  }
  private hold(resource: Resource): void {
    if (this.owned.has(resource)) return;
    const ref = this.orphanRefs.get(resource);
    if (ref !== undefined) { this.orphans.delete(ref); this.orphanRefs.delete(resource); this.finalizer.unregister(ref); }
    this.owned.add(resource);
    this.track(resource);
  }
  private holdWeakly(resource: Resource): void {
    if (this.owned.has(resource) || this.isOrphan(resource)) return;
    const ref = new WeakRef(resource);
    this.orphans.add(ref); this.orphanRefs.set(resource, ref);
    const forget = this.track(resource);
    this.finalizer.register(resource, { ref, forget }, ref);
  }
  /** The dispose listener and the level's end-of-life capture, once per resource; neither keeps the resource alive.
   *  SF57 leak5: the two closures are made in separate functions. Made in one, they shared one closure context, and the
   *  level's capture (and the finalizer's `forget`) then held the resource through the listener's binding: every weakly
   *  held upload stayed alive until the page level ended. */
  private track(resource: Resource): () => void {
    if (this.tracked.has(resource)) return () => { /* Already tracked. */ };
    this.tracked.add(resource);
    const forget = this.captureAtLevelEnd(new WeakRef(resource));
    this.listenForRelease(resource, forget);
    return forget;
  }
  /** The page level's end of life frees what is still live, unowned and not acquired. Holds only a WeakRef. */
  private captureAtLevelEnd(ref: WeakRef<Resource>): () => void {
    return this.level.capture('resources', () => {
      const live = ref.deref();
      if (live === undefined) return;
      const owner = sceneResourceOwner(live);
      if ((this.owned.has(live) || this.isOrphan(live)) && !this.assets.isAcquired(live) && owner === null) live.dispose();
      // Engine/acquired resources remain visible to the independent GPU census after level disposal.
    });
  }
  /** The resource's own dispose event forgets it. Reachable only from the resource's listeners. */
  private listenForRelease(resource: Resource, forget: () => void): void {
    const released = (): void => {
      this.releasing.add(resource); queueMicrotask(() => { this.releasing.delete(resource); });
      this.observedIn.delete(resource); // a re-upload later in the same render is observed again
      this.settledIn.delete(resource);
      this.settledOwners.delete(resource);
      invalidatePropertyObservation();
      this.retire(resource);
      eventMethod(resource, 'removeEventListener', released); forget();
      // Three deletes colour attachments with their target but does not dispatch their dispose events. Those events
      // also retire derived GPU allocations (WebGLEnvironments' cube/PMREM maps). Calling only our listener silently
      // forgot the source and its level cleanup while leaving the derived allocation alive (SF57 leak5).
      // Colour attachments have no standalone native texture-disposal listener: the target still deletes their GL
      // storage after this listener returns. Depth attachments dispatch dispose in Three's own target deallocator.
      if (resource instanceof WebGLRenderTarget) for (const texture of resource.textures) texture.dispose();
    };
    eventMethod(resource, 'addEventListener', released);
  }
  private retire(resource: Resource): void {
    this.tracked.delete(resource);
    this.owned.delete(resource);
    const weak = this.orphanRefs.get(resource);
    if (weak !== undefined) { this.orphans.delete(weak); this.orphanRefs.delete(resource); this.finalizer.unregister(weak); }
  }
  /** A `compile()` is a draw of every object in it: each object's material program is that object's owner's upload, and its
   *  samplers and geometry carry that owner as a hint for their own upload. */
  private compiled(root: Object3D): void {
    root.traverse((node) => {
      const material: unknown = Reflect.get(node, 'material');
      if (material === undefined || material === null) return;
      const delegated = sceneObjectOwner(node), owner = delegated ?? this.level;
      if (owner.disposed) return;
      const prior = this.drawOwner, priorId = this.drawOwnerId; this.drawOwner = owner; this.drawOwnerId = undefined;
      try {
        const materials: unknown[] = Array.isArray(material) ? material : [material];
        const geometry: unknown = Reflect.get(node, 'geometry');
        for (const m of materials) {
          if (!isResource(m)) continue;
          // three's compile builds the material's program now: that upload is this object's
          this.observe(m);
          for (const r of materialUploads(m)) if (r !== m) {
            if (r instanceof Texture && !this.assets.isAcquired(r)) {
              const existing = sceneResourceOwner(r);
              if (delegated !== null || !postSamplers.has(r) || existing === null || existing.disposed) ownSceneResource(r, owner);
            }
            this.retainAsset(r, owner);
            if (sceneResourceOwner(r) === null) this.hints.set(r, new WeakRef(owner));
          }
        }
        if (isResource(geometry) && sceneResourceOwner(geometry) === null) this.hints.set(geometry, new WeakRef(owner));
      } finally { this.drawOwner = prior; this.drawOwnerId = priorId; }
    });
  }
  attach(renderer: ObservedRenderer): void {
    propertyHooks(renderer).ownership = (object) => {
      // a lookup outside any draw while the resource's dispose is dispatched is three's own teardown, not an upload
      if (this.drawOwner !== null || typeof object !== 'object' || object === null || !this.releasing.has(object)) this.observe(object);
    };
    const counted = renders(renderer) ? renderer : null;
    const hooks = drawHooks(renderer);
    hooks.ownership = (draw, camera, scene, geometry, material, object, group) => {
      const priorOwner = this.drawOwner, priorId = this.drawOwnerId, priorGeneration = this.drawGen;
      this.drawOwner = sceneObjectOwner(object); this.drawOwnerId = this.ownerId(this.drawOwner);
      hooks.ownerToken = this.drawOwnerId;
      this.drawDepth++; this.drawGen = counted === null ? ++this.drawGens : renderCount(counted);
      try {
        // A batch claims private aggregate allocations before native property reads.
        if (object instanceof InstancedMesh || object instanceof BatchedMesh) this.observeResource(object);
        this.observeResource(geometry); this.observeResource(material);
        draw(camera, scene, geometry, material, object, group);
      } finally {
        this.drawDepth--; this.drawOwner = priorOwner; this.drawOwnerId = priorId; this.drawGen = priorGeneration;
        hooks.ownerToken = priorId ?? null;
      }
    };
    // Test doubles carry only the draw path.
    if (renderer.compile !== undefined) {
      const compile = renderer.compile.bind(renderer);
      renderer.compile = (scene, camera, target) => {
        this.compiled(scene); const programs = compile(scene, camera, target); this.compiled(scene); return programs;
      };
    }
    if (renderer.compileAsync !== undefined) {
      const compileAsync = renderer.compileAsync.bind(renderer);
      renderer.compileAsync = (scene, camera, target) => {
        this.compiled(scene);
        return compileAsync(scene, camera, target).then(programs => { this.compiled(scene); return programs; });
      };
    }
  }
}

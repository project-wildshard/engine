import { BufferGeometry, InstancedMesh, Mesh, Object3D, SkinnedMesh, Sphere, Vector3, type Camera } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';

/** Temporary live-frame presentation only. Preparation renders do not use it. */
export interface FrameDrawRange { enabled: boolean; readonly distance: number }
interface RangeLease { readonly range: FrameDrawRange; readonly owner: Scope }
/** D188 (G815): objects an arrival left unwarmed sit out every live draw until released; the warm-up's own 1×1
 *  draws and every other view still see them. Released with its owner. */
export interface FrameGate { release: (objects: Iterable<Object3D>) => void; readonly size: () => number }

/** Scope-owned draw ranges, independent of world construction and readiness.
 * Existing native bounds conservatively retain nearby static draws, skies,
 * dynamic/custom objects and any object without a trustworthy bound. */
export class FrameDrawRanges {
  private readonly ranges: RangeLease[] = [];
  private readonly matrixRoots = new Map<Object3D, Scope>();
  private readonly gated = new Set<Object3D>();
  private readonly hidden: Object3D[] = [];
  private readonly eye = new Vector3();
  private readonly sphere = new Sphere();
  bind(owner: Scope, distance: number): FrameDrawRange {
    if (owner.disposed || owner.disposing || !Number.isFinite(distance) || distance <= 0) throw new Error('Frame draw range requires a live owner and positive distance');
    const range: FrameDrawRange = { enabled: false, distance }, lease = { range, owner }; this.ranges.push(lease);
    owner.onDispose(() => { const index = this.ranges.indexOf(lease); if (index !== -1) this.ranges.splice(index, 1); });
    return range;
  }
  /** Whether a live owner's range is enabled: the frame draws a held view (D178 pauses the post chain for it). */
  holding(): boolean {
    for (const lease of this.ranges) if (lease.range.enabled && !lease.owner.disposed && !lease.owner.disposing) return true;
    return false;
  }
  /** D188: hold `objects` out of the live draw until each is released (or `owner` leaves). */
  gate(owner: Scope, objects: Iterable<Object3D>): FrameGate {
    if (owner.disposed || owner.disposing) throw new Error('Frame gate requires a live owner');
    const mine = new Set(objects);
    for (const object of mine) this.gated.add(object);
    const release = (list: Iterable<Object3D>): void => { for (const object of list) if (mine.delete(object)) this.gated.delete(object); };
    owner.onDispose(() => { release([...mine]); });
    return { release, size: () => mine.size };
  }
  /** A parked root may leave ordinary frame matrix walks while hidden. Explicit
   * construction/preparation updates outside this draw remain unchanged. */
  trackHiddenRoot(owner: Scope, root: Object3D): void {
    if (owner.disposed || owner.disposing || this.matrixRoots.has(root)) throw new Error('Hidden frame root requires one live owner');
    this.matrixRoots.set(root, owner);
    owner.onDispose(() => { this.matrixRoots.delete(root); });
  }
  /** Only the ordinary synchronous live draw is masked. Always restore before
   * a yielded builder, offscreen warm-up or another view can inspect the scene. */
  draw(root: Object3D, camera: Camera, renderer: { render: (delta: number) => void }, delta: number): void {
    let distance = Infinity;
    for (let i = 0; i < this.ranges.length; i++) {
      const lease = this.ranges[i];
      if (lease !== undefined && lease.range.enabled && !lease.owner.disposed && !lease.owner.disposing) distance = Math.min(distance, lease.range.distance);
    }
    const parked: { readonly root: Object3D; readonly descriptor: PropertyDescriptor | undefined }[] = [];
    for (const [candidate, owner] of this.matrixRoots) {
      if (candidate.visible || owner.disposed || owner.disposing || candidate === root) continue;
      let parent = candidate.parent;
      while (parent !== null && parent !== root) parent = parent.parent;
      if (parent !== root) continue;
      const descriptor = Object.getOwnPropertyDescriptor(candidate, 'updateMatrixWorld');
      if (descriptor === undefined && !Object.isExtensible(candidate)) continue;
      if (descriptor !== undefined && (descriptor.configurable !== true || !('value' in descriptor))) continue;
      parked.push({ root: candidate, descriptor });
    }
    if (this.hidden.length > 0) throw new Error('Frame draw range is already drawing');
    if (!Number.isFinite(distance) && (parked.length === 0 || !root.matrixWorldAutoUpdate)) {
      if (this.gated.size === 0) { renderer.render(delta); return; }
      try { this.hideGated(); renderer.render(delta); }
      finally { for (const node of this.hidden) node.visible = true; this.hidden.length = 0; }
      return;
    }
    const restore = (): void => {
      for (const item of parked) {
        if (item.descriptor === undefined) Reflect.deleteProperty(item.root, 'updateMatrixWorld');
        else Object.defineProperty(item.root, 'updateMatrixWorld', item.descriptor);
      }
      parked.length = 0;
    };
    // G782: the root's matrices are current from here; its passes' renders skip the scene's own second walk (Nalati's held
    // crossing spent ~245 ms of updateMatrixWorld in the renders after this one)
    const auto = root.matrixWorldAutoUpdate;
    try {
      // Hidden content has no draw in this frame. Suppress only the parent's
      // ordinary walk, then restore before renderer callbacks or preparation.
      for (const item of parked) Object.defineProperty(item.root, 'updateMatrixWorld', { value: (): void => undefined, configurable: true, writable: true });
      root.updateMatrixWorld(); restore();
      if (Number.isFinite(distance)) {
        camera.getWorldPosition(this.eye);
        root.traverseVisible(node => {
          // Keep sky/backdrop draws and moving/custom pipelines unchanged. A
          // mesh with children cannot be hidden by its own geometry's bound.
          if (!(node instanceof Mesh) || node instanceof SkinnedMesh || !node.frustumCulled || node.children.length > 0
            || node.onBeforeRender !== Object3D.prototype.onBeforeRender || node.onAfterRender !== Object3D.prototype.onAfterRender
            || node.onBeforeShadow !== Object3D.prototype.onBeforeShadow || node.onAfterShadow !== Object3D.prototype.onAfterShadow) return;
          const geometry: unknown = node.geometry;
          if (!(geometry instanceof BufferGeometry)) return;
          for (const key in geometry.morphAttributes) if (Object.hasOwn(geometry.morphAttributes, key)) return;
          const bound: unknown = node instanceof InstancedMesh ? node.boundingSphere : geometry.boundingSphere;
          if (!(bound instanceof Sphere)) return;
          const sphere = this.sphere.copy(bound).applyMatrix4(node.matrixWorld);
          if (!Number.isFinite(sphere.radius) || sphere.radius < 0 || !Number.isFinite(sphere.center.lengthSq())) return;
          if (sphere.distanceToPoint(this.eye) <= distance) return;
          node.visible = false; this.hidden.push(node);
        });
      }
      this.hideGated();
      root.matrixWorldAutoUpdate = false;
      renderer.render(delta);
    } finally {
      restore();
      root.matrixWorldAutoUpdate = auto;
      for (const node of this.hidden) node.visible = true;
      this.hidden.length = 0;
    }
  }
  /** D188: the gated objects showing now sit out this draw (restored with the range's own hidden nodes). */
  private hideGated(): void { for (const node of this.gated) if (node.visible) { node.visible = false; this.hidden.push(node); } }
}

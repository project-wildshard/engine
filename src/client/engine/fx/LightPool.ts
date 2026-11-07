import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';

/**
 * LightPool — a fixed set of scene PointLights driven by intensity only (B7). three.js bakes the NUMBER of lights into
 * every lit program, so adding, removing or hiding (`visible = false`, or hiding a parent) a light mid-play recompiles
 * every lit material in view — a multi-second hitch on iOS. The pool's lights are created during boot (as they are
 * acquired), live in one always-visible group at the scene root, and are never removed: a released light just sits at
 * intensity 0. The pool SEALS itself on the scene's first real render (after the boot's precompile), so from then on
 * the light count is fixed: a mid-play `acquire()` reuses a released light, and when none is free it hands back a
 * detached light (not in the scene: it lights nothing, costs nothing, never recompiles) and warns once.
 *
 *   const light = LightPool.for(scene).acquire(0xffb257, 18, 11, 1.6);   // colour, intensity, distance, decay
 *   light.position.set(x, y, z);                                          // WORLD space (the pool group sits at the origin)
 *   light.intensity = …;                                                  // drive it every frame
 *   LightPool.for(scene).release(light);                                  // intensity 0, free for the next acquire
 *
 * A light that `yields` (a shared site light, which lights nothing far from its site) gives its place to a `borrow` when a
 * sealed pool has none free: the count stands, and the borrower has a real light for as long as it holds it.
 *
 * Shadows are never cast by a pooled light. `LightPool.for(scene).size` / `.free` for the perf meter / dev.
 *
 * An `owner` (optional) ties a light to the object it lights for: every render of the pool's scene dims an owned light
 * whose owner, or any ancestor, is hidden or detached, so a parked or retired region's lights keep the count but light
 * nothing (a grid region's own lights would otherwise leave with its root and recompile every lit program on the road).
 *
 * A pool of a scene nested in another (a grid region's own scene, whose content asks `LightPool.for(its scene)`) counts in
 * three's light hash only while its root shows: showing Pine Hollow's region added its five cabin lights to every lit
 * program on the page (each rebuilt: 1 → 6 point lights, ~40 builds of its after-play). The page `reserve`s that many
 * dark lights of its own before its first render, and `mirrorInto` takes the nested pool's lights out of three's count
 * (no layer: no camera sees them) and copies each shown one onto a reserved page light on every page render (colour,
 * intensity, reach, decay, world position), so the page's light count never moves.
 */
export class LightPool {
  private static pools = new WeakMap<THREE.Scene, LightPool>();
  /** the pool of `scene` (made, and hooked to seal on the first render, on first use) */
  static for(scene: THREE.Scene): LightPool {
    let p = LightPool.pools.get(scene);
    if (p === undefined) { p = new LightPool(scene); LightPool.pools.set(scene, p); }
    return p;
  }

  readonly group: THREE.Group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private busy = new Set<THREE.PointLight>();
  private readonly owners = new Map<THREE.PointLight, THREE.Object3D>();
  private sealed = false;
  private warned = false;
  /** the page lights `reserve` keeps for mirrored pools (dark when no shown nested light takes them) */
  private readonly reserved: THREE.PointLight[] = [];
  /** the nested pools whose lights this pool's reserved lights show (`mirrorInto`) */
  private readonly sources = new Set<LightPool>();
  /** this nested pool's page pool, while mirrored */
  private mirroredBy: LightPool | null = null;
  private warnedMirror = false;
  /** Lights their owners can do without while a fight stands far from them (`yields`). */
  private readonly yielding = new Set<THREE.PointLight>();
  /** A borrowed light and the yielding light whose place in the scene it holds. */
  private readonly lent = new Map<THREE.PointLight, THREE.PointLight>();

  private constructor(scene: THREE.Scene) {
    this.group.name = 'light-pool';
    scene.add(this.group);
    // seal on the first real render (compileAsync in the boot's precompile does not call it; firstFrame's render does)
    const prev = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = (...args) => { this.sealed = true; this.dimHidden(); this.showMirrors(); prev(...args); };
  }

  get size(): number { return this.lights.length; }
  get free(): number { return this.lights.length - this.busy.size; }
  /** stop growing now (tests / a dev harness that renders before its pickups exist) */
  seal(): void { this.sealed = true; }

  /** Keep `count` dark page lights for mirrored pools (`mirrorInto`), made now: before the first render, or the count
   *  moves once (and every lit program is built again). */
  reserve(count: number): void {
    if (this.sealed && this.reserved.length < count) console.warn('[LightPool] reserved after the first render: the light count moves once');
    while (this.reserved.length < count) {
      const light = new THREE.PointLight(0xffffff, 0); light.castShadow = false;
      this.reserved.push(light); this.group.add(light);
    }
  }

  /** Show this (nested) pool's lights through `page`'s reserved lights while `scope` lives (see the module comment):
   *  its lights, now and later, leave three's light count; `page` copies the shown ones onto its reserved lights. */
  mirrorInto(page: LightPool, scope: Scope): void {
    if (page === this) throw new Error('A light pool cannot mirror into itself');
    this.mirroredBy = page; page.sources.add(this);
    for (const light of this.lights) light.layers.disableAll();
    scope.onDispose(() => { page.sources.delete(this); if (this.mirroredBy === page) this.mirroredBy = null; for (const light of this.lights) light.layers.enable(0); });
  }

  /** Make `count` free dark lights now (counted, never mirrored), for content known to ask after the first render: a
   *  later `acquire` takes one instead of growing a sealed pool, so the count, and every lit program built at boot, stays.
   *  A spare nobody takes is a dark light: no pixel changes. */
  spare(count: number): void {
    if (this.sealed) console.warn('[LightPool] spares after the first render: the light count moves once');
    for (let free = this.lights.length - this.busy.size; free < count; free++) {
      const light = new THREE.PointLight(0xffffff, 0); light.castShadow = false;
      if (this.mirroredBy !== null) light.layers.disableAll();
      this.lights.push(light); this.group.add(light);
    }
  }

  /** `grow` (G808): a sealed, full pool adds the light anyway (the count moves this once) instead of handing out a detached
   *  one. For content that keeps its lights for the session and would otherwise add them to the scene itself: as its own
   *  scene lights they left the count whenever their content hid (home content seen from another cell), so every lit
   *  program was built again; pooled and owned, they dim and stay counted. */
  acquire(color: THREE.ColorRepresentation, intensity: number, distance: number, decay = 2, owner?: THREE.Object3D, grow = false): THREE.PointLight {
    let light = this.lights.find((l) => !this.busy.has(l));
    if (light === undefined) {
      light = new THREE.PointLight();
      light.castShadow = false;
      if (this.sealed && !grow) {
        if (!this.warned) { this.warned = true; console.warn('[LightPool] sealed and full: a mid-play light was asked for — handing out an unlit one (no recompile)'); }
        light.color.set(color); light.intensity = intensity; light.distance = distance; light.decay = decay;
        return light; // detached: never in the scene
      }
      if (this.mirroredBy !== null) light.layers.disableAll();
      this.lights.push(light); this.group.add(light);
    }
    this.busy.add(light);
    if (owner !== undefined) this.owners.set(light, owner);
    light.color.set(color); light.intensity = intensity; light.distance = distance; light.decay = decay;
    return light;
  }

  /** `light` may give its place to a `borrow`: its owner keeps writing to it, and nothing shows until it is back. */
  yields(light: THREE.PointLight): void { this.yielding.add(light); }

  /** `acquire` for a light a sealed, full pool can't otherwise give: it stands in for a light that `yields`, so three still
   *  counts the same lights and no lit program is rebuilt. None yielding, it is `acquire`'s detached light. `release` puts
   *  the yielding light back. */
  borrow(color: THREE.ColorRepresentation, intensity: number, distance: number, decay = 2): THREE.PointLight {
    const taken = new Set(this.lent.values()), lender = [...this.yielding].reverse().find(light => !taken.has(light) && light.parent === this.group);
    if (lender === undefined || !this.sealed || this.free > 0) return this.acquire(color, intensity, distance, decay);
    const light = new THREE.PointLight(color, intensity, distance, decay);
    light.castShadow = false; light.layers.mask = lender.layers.mask;
    this.group.remove(lender); this.group.add(light); this.lent.set(light, lender);
    return light;
  }

  /** back to the pool: dark, still in the scene (a detached light from a full pool is simply dropped) */
  release(light: THREE.PointLight): void {
    light.intensity = 0;
    const lender = this.lent.get(light);
    if (lender !== undefined) { this.lent.delete(light); this.group.remove(light); this.group.add(lender); return; }
    this.busy.delete(light); this.owners.delete(light);
  }
  /** each shown nested light onto a reserved light, in pool order; the rest dark */
  private showMirrors(): void {
    let next = 0;
    for (const source of this.sources) {
      if (!shownUnder(source.group, this.group.parent)) continue;
      for (const light of source.lights) {
        if (light.intensity <= 0) continue;
        const owner = source.owners.get(light);
        if (owner !== undefined && !shownUnder(owner, this.group.parent)) continue;
        const slot = this.reserved[next];
        if (slot === undefined) {
          if (!this.warnedMirror) { this.warnedMirror = true; console.warn(`[LightPool] more shown region lights than the ${String(this.reserved.length)} reserved: the rest stay dark`); }
          break;
        }
        next++;
        slot.color.copy(light.color); slot.intensity = light.intensity; slot.distance = light.distance; slot.decay = light.decay;
        // three posed the scene before this hook: the slot's world matrix is set here, from the light's
        slot.position.setFromMatrixPosition(light.matrixWorld); slot.updateMatrixWorld();
      }
    }
    for (; next < this.reserved.length; next++) { const slot = this.reserved[next]; if (slot !== undefined) slot.intensity = 0; }
  }
  private dimHidden(): void {
    for (const [light, owner] of this.owners) {
      let shown = owner.parent !== null;
      for (let at: THREE.Object3D | null = owner; shown && at !== null; at = at.parent) shown = at.visible;
      if (!shown) light.intensity = 0;
    }
  }
}

/** `node` and its ancestors visible, and it under `root` */
function shownUnder(node: THREE.Object3D, root: THREE.Object3D | null): boolean {
  for (let at: THREE.Object3D | null = node; at !== null; at = at.parent) {
    if (!at.visible) return false;
    if (at === root) return true;
  }
  return false;
}

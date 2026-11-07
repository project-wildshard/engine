import * as THREE from 'three';

/**
 * SiteLights — a few shared point lights that visit the lit site nearest the eye, and flicker every light handed to
 * them, by intensity only (B7: the light count never changes, so no lit program recompiles). A site is a place with
 * light anchors (a building's fire and lanterns, a lone lamp, a brazier); each frame the pool's lights take the nearest
 * lit site's anchors in rank order (a site's room anchors first once the eye is inside one of its rooms or near its
 * door), copy each anchor's colour, reach and decay, and follow the anchors. Lights of their own (`addFlicker`) flicker
 * the same way without moving. Every number is the caller's look row; the lights come from the caller (usually
 * `LightPool.for(scene).acquire(…)`, or one light the caller keeps in its scene).
 *
 *   const lights = new SiteLights({ flicker: { depth: 1, waves: [[11, 0, 0.07], [23, 1, 0.05]] } });
 *   lights.addLight(pooledLight);
 *   lights.addLamp(anchor, 0xff7a30, 9, 10, { lit: true });    // mutable state published by the page
 *   lights.step(t, eye);                                        // per frame: the clock, the eye (world), [each kind's gain]
 */

/** `fire`: a flame (a hearth, a brazier); `lamp`: a lantern or a room light. The caller sets each kind's gain a frame. */
export type SiteLightKind = 'fire' | 'lamp';
/** A flickering light: its base intensity, flicker seed and kind. */
export interface SiteFlicker { light: THREE.PointLight; base: number; seed: number; kind: SiteLightKind }
/** A shared light's slot at a site: where, how it looks, and its rank (lower ranks take the pool first). */
export interface SiteLightAnchor { anchor: THREE.Object3D; color: number; intensity: number; distance: number; decay: number; seed: number; kind: SiteLightKind; rank: number }
/** A room's floor rectangle in its site root's frame (the eye inside: the room anchors take the pool first). */
export interface SiteRoom { x: number; z: number; hw: number; hd: number }
/** Page-owned ignition state. Publish before stepping; no gameplay callback enters the light host. */
export interface SiteLightState { readonly lit: boolean }
/** A place the shared lights may visit: its root (the distance is measured to `root.position`), its anchors, whether
 *  it is lit (absent: always), and its rooms and door (x, z) in the root's frame. */
export interface LightSite { root: THREE.Object3D; anchors: SiteLightAnchor[]; state?: SiteLightState; rooms?: readonly SiteRoom[]; door?: readonly [number, number] }
/** One wave of a flicker: sin(t × rate + seed × seedScale) × amount. */
export type SiteWave = readonly [rate: number, seedScale: number, amount: number];
/** How the lights flicker (intensity × (1 + depth × Σ waves)) and, for sites with rooms, which anchor ranks light a
 *  room first once the eye is within `doorRadius` m of its door or over one of its rooms. */
export interface SiteLightsLook {
  readonly flicker: { readonly depth: number; readonly waves: readonly SiteWave[] };
  readonly indoor?: { readonly doorRadius: number; readonly ranks: readonly number[] };
}

/** every kind at full strength (the default gain) */
const FULL: Readonly<Record<SiteLightKind, number>> = { fire: 1, lamp: 1 };
/** the most shared lights a pool moves (a phone's pool holds a handful) */
const POOL_MAX = 8;

/** Shared lights that visit the nearest lit site, and the flicker of every light handed over (see the module comment). */
export class SiteLights {
  private readonly look: SiteLightsLook;
  private readonly sites: LightSite[] = [];
  private readonly shared: THREE.PointLight[] = [];
  private flickers: SiteFlicker[] = [];
  private nearestSite = -1;
  private indoors = false;
  /** the nearest site's anchors in the order the shared lights take them */
  private order: readonly SiteLightAnchor[] = [];
  private readonly local = new THREE.Vector3();

  constructor(look: SiteLightsLook) {
    this.look = look;
  }

  /** a site the shared lights may visit (ties go to the one added first) */
  addSite(site: LightSite): void { this.sites.push(site); }
  /** a shared light the nearest site's anchors take (dark until a site is lit) */
  addLight(light: THREE.PointLight): THREE.PointLight { this.shared.push(light); return light; }
  /** a light of its own that flickers in place */
  addFlicker(f: SiteFlicker): void { this.flickers.push(f); }
  /**
   * A lone lamp the shared lights may visit when it is the nearest lit site: `anchor` is where the light sits (its
   * position also measures the distance), `state.lit` false keeps the pool away. Its flicker seed comes from its x.
   */
  addLamp(anchor: THREE.Object3D, color: number, intensity: number, distance: number, state?: SiteLightState, kind: SiteLightKind = 'lamp'): void {
    this.sites.push({ root: anchor, anchors: [{ anchor, color, intensity, distance, decay: 2, seed: anchor.position.x * 0.37, kind, rank: 0 }], ...(state === undefined ? {} : { state }) });
  }

  /** Per frame: the clock `t`, the eye in world space and each kind's gain (e.g. the night's lamps; default 1). */
  step(t: number, eye: THREE.Vector3, gain: Readonly<Record<SiteLightKind, number>> = FULL): void {
    if (this.shared.length > 0) this.visit(eye);
    const { depth, waves } = this.look.flicker;
    for (const f of this.flickers) {
      let n = 0;
      for (const w of waves) n += Math.sin(t * w[0] + f.seed * w[1]) * w[2];
      f.light.intensity = f.base * (1 + depth * n) * gain[f.kind];
    }
  }

  /** the shared lights onto the nearest lit site's anchors (re-dealt when the site or the indoors changes) */
  private visit(eye: THREE.Vector3): void {
    let nearest = -1, nearestD2 = Infinity;
    for (const [i, s] of this.sites.entries()) {
      const d2 = s.root.position.distanceToSquared(eye);
      if (s.anchors.length > 0 && d2 < nearestD2 && (s.state?.lit ?? true)) { nearestD2 = d2; nearest = i; }
    }
    const site = this.sites[nearest];
    let indoors = false;
    const indoor = this.look.indoor;
    if (site?.rooms && site.door && indoor) {
      const p = site.root.worldToLocal(this.local.copy(eye)), door = site.door;
      indoors = site.rooms.some((r) => Math.abs(p.x - r.x) <= r.hw && Math.abs(p.z - r.z) <= r.hd) || Math.hypot(p.x - door[0], p.z - door[1]) < indoor.doorRadius;
    }
    if (nearest !== this.nearestSite || indoors !== this.indoors) {
      this.nearestSite = nearest; this.indoors = indoors;
      const ranks = indoor?.ranks ?? [];
      const rankOf = (a: SiteLightAnchor): number => { const k = ranks.indexOf(a.rank); return k !== -1 ? k : a.rank + ranks.length; };
      this.order = site === undefined ? [] : indoors ? [...site.anchors].sort((a, b) => rankOf(a) - rankOf(b)) : site.anchors;
      this.flickers = this.flickers.filter((f) => !this.shared.includes(f.light));
      this.shared.forEach((light, i) => {
        const a = this.order[i];
        if (!a) { light.intensity = 0; return; }
        light.color.set(a.color); light.distance = a.distance; light.decay = a.decay;
        this.flickers.push({ light, base: a.intensity, seed: a.seed, kind: a.kind });
      });
    }
    // a pool's group may sit under an offset scene (a grid region): place each light in its parent's frame
    for (let i = 0; i < Math.min(this.shared.length, POOL_MAX); i++) {
      const light = this.shared[i], a = this.order[i];
      if (light !== undefined && a !== undefined) { a.anchor.getWorldPosition(light.position); light.parent?.worldToLocal(light.position); }
    }
  }
}

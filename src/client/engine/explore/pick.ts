/**
 * What a tap in the World Explorer picks (E323; src/client/engine/explore/Select.ts draws the selection). Pure: no DOM, so
 * test/select-pick.test.ts runs it.
 *
 *   const hit = pickTarget(raycaster, targets);   // { target, point, box } | null
 *   copyInTheWay(ray, far, look, targets)         // VIEW IN WORLD (E342): another copy between the eye and the one it frames
 *
 * Each object is raycast once per tap, however many targets share it (a Nine Dragon kit carries seven models' copies:
 * it was raycast seven times). The nearest surface hit is what the finger touched. On that object a target with `claim`
 * takes the hit only where one of its copies stands (the smallest copy box holding the point wins), a target without one
 * takes any hit on its object, and a hit nobody claims picks nothing: a bare facade or Well wall belongs to the world,
 * never to a baked piece metres away (the nearest copy used to win with no containment check). When nothing takes the
 * hit, a copy box the ray entered in front of it does: the tap threaded that copy's open shape — between a mahjong
 * table's legs, past a laundry line's cloth — and landed on the world behind. A box behind the surface never does.
 *
 * E345: a target drawn inside another target's object (a Pine Hollow cabin's root holds its fire pit and its porch
 * lantern: both raycasts hit the pit's stones at the same distance) is weighed with every target on the hit's own chain
 * of parents — the smallest copy box holding the point wins, else the innermost plain target — so the pit is the pit's,
 * not the cabin's that happened to be registered first. And a copy smaller than MIN_PICK takes a tap whose ray passes
 * through its box in front of the surface it hits: a flint & steel a hand across on a lookout's roof (spinning, as the
 * pickups do) is a few pixels wide, and the finger lands on the roof beside it.
 */
import * as THREE from 'three';

/** something a tap can hit: an object (or a batch mesh) and how it maps to a catalog entry + a box */
export interface SelectTarget {
  object: THREE.Object3D;
  /** the catalog entry this hit opens (by id) */
  entry: string;
  /** the selection box for a hit at `point` (batches: the one member under the tap); default = the object's box */
  boxAt?: (point: THREE.Vector3) => THREE.Box3;
  /** drawn into a shared object: the copy under `point`, or null when the point is on none of this entry's copies */
  claim?: (point: THREE.Vector3) => THREE.Box3 | null;
  /** with `claim`: the nearest copy box the ray enters before `far` — a tap through a copy's open shape */
  boxHit?: (ray: THREE.Ray, far: number) => { readonly box: THREE.Box3; readonly distance: number } | null;
  label?: (point: THREE.Vector3) => string;
}

export interface Picked {
  readonly target: SelectTarget;
  readonly point: THREE.Vector3;
  readonly box: THREE.Box3;
}

/** shown: it and every parent visible */
function shown(o: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false;
  return true;
}

const _size = new THREE.Vector3();
const volume = (b: THREE.Box3): number => { b.getSize(_size); return _size.x * _size.y * _size.z; };
/** metres: a drawn-into copy whose box's longest side is at most this is small enough to take a tap that passes through its
 *  box in front of the surface hit (E345) — a pickup, a stool, a lotus finial */
export const MIN_PICK = 0.75;
const tiny = (b: THREE.Box3): boolean => { b.getSize(_size); return Math.max(_size.x, _size.y, _size.z) <= MIN_PICK; };

/** the target under the ray, or null (nothing hit, or a surface no target claims) */
export function pickTarget(ray: THREE.Raycaster, targets: readonly SelectTarget[]): Picked | null {
  const byObject = new Map<THREE.Object3D, SelectTarget[]>();
  for (const t of targets) {
    const list = byObject.get(t.object);
    if (list) list.push(t); else byObject.set(t.object, [t]);
  }
  let near: { mesh: THREE.Object3D; point: THREE.Vector3; d: number } | null = null;
  for (const object of byObject.keys()) {
    if (!shown(object)) continue;
    const hit = ray.intersectObject(object, true)[0];
    if (hit && (!near || hit.distance < near.d)) near = { mesh: hit.object, point: hit.point.clone(), d: hit.distance };
  }
  // a small copy the ray passes through before the surface it hits (E345: the minimum pick size)
  const small = throughCopy(ray, byObject, near?.d ?? ray.far, tiny);
  if (small) return small;
  if (!near) return throughCopy(ray, byObject, ray.far);
  const { point } = near;
  let claimed: Picked | null = null, plain: Picked | null = null;
  // every target whose object holds the mesh hit, innermost first (E345: nested targets hit at the same point)
  for (let o: THREE.Object3D | null = near.mesh; o; o = o.parent) {
    for (const t of byObject.get(o) ?? []) {
      if (t.claim) {
        const box = t.claim(point);
        if (box && (!claimed || volume(box) < volume(claimed.box))) claimed = { target: t, point, box };
      } else plain ??= { target: t, point, box: t.boxAt ? t.boxAt(point) : new THREE.Box3().setFromObject(t.object) };
    }
  }
  return claimed ?? plain ?? throughCopy(ray, byObject, near.d);
}

/**
 * VIEW IN WORLD's eye (E342): does a drawn-into copy stand between `ray.origin` and the copy it frames — one whose box the
 * ray enters before `far` (the framed copy's own box), or the one the eye stands in? A box holding `look` (the framed copy,
 * a stall it stands in) doesn't count. Every copy counts, drawn this frame or culled: the view is chosen before the flight.
 */
export function copyInTheWay(ray: THREE.Ray, far: number, look: THREE.Vector3, targets: readonly SelectTarget[]): boolean {
  for (const t of targets) {
    if (!t.boxHit || !t.claim) continue;
    const at = t.claim(ray.origin);
    if (at && !at.containsPoint(look)) return true;
    const h = t.boxHit(ray, far);
    if (h && !h.box.containsPoint(look)) return true;
  }
  return false;
}

/** the copy box the ray enters first, in front of `far` (the surface it hit), among the claiming targets shown (`only`:
 *  the boxes it accepts) */
function throughCopy(ray: THREE.Raycaster, byObject: ReadonlyMap<THREE.Object3D, readonly SelectTarget[]>, far: number, only?: (box: THREE.Box3) => boolean): Picked | null {
  let best: Picked | null = null, bd = Number.POSITIVE_INFINITY;
  for (const [object, list] of byObject) {
    if (!shown(object)) continue;
    for (const t of list) {
      const h = t.boxHit?.(ray.ray, far);
      if (h && (only === undefined || only(h.box)) && (h.distance < bd || (h.distance === bd && best !== null && volume(h.box) < volume(best.box)))) {
        bd = h.distance;
        best = { target: t, point: ray.ray.at(h.distance, new THREE.Vector3()), box: h.box };
      }
    }
  }
  return best;
}

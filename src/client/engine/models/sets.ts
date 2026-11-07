/**
 * Sets (E306 / E315 M7): a named group of placements that reads as one place — a camp, a market square, a kurgan
 * field. A set owns no geometry; its members are `place` results. Registered on the shard's registry (`sets`) for the
 * sets explorer between single models and the whole world.
 *
 * Every named place is a Set (M12, Jake 2026-09-30): a shard's discovery list names its places, and each one's
 * set says so with `place: '<slug>/<place id>'`. The set lists the models placed there; the place's welded ground stays
 * world. scripts/check-models.mjs fails a named place no set names.
 *
 *   const yurts = place(yurt, camp.yurts, { ctx, draw: 'merged' }), props = place(cauldron, camp.props, { ctx, draw: 'instanced' });
 *   placeSet({ id: 'example/spring-camp', name: 'Spring camp', file: 'content/world/camp.ts', members: [yurts, props] });
 */
import { app } from '../app/runtime';
import * as THREE from 'three';
import type { RegisteredSet, WorldRegistry } from '../world/registry';
import type { Placed } from './place';

export interface SetOptions {
  /** `<slug>/<name>`, unique on the shard */
  readonly id: string;
  readonly name: string;
  /** the module that composes it */
  readonly file: string;
  readonly members: readonly Placed[];
  /** the named place this set is: `<slug>/<id>`, the id in its shard's list of named places (M12) */
  readonly place?: string;
  /** models of this place not on the contract yet (their files are held by another lane): their ids, to come */
  readonly pending?: readonly string[];
  /** default: the running shard's registry */
  readonly registry?: WorldRegistry;
}

/** Register a set of placed models; returns what was registered (members summed per model, bounds in world space). */
export function placeSet(o: SetOptions): RegisteredSet {
  const copies = new Map<string, number>();
  const bounds = new THREE.Box3(), b = new THREE.Box3();
  for (const m of o.members) {
    copies.set(m.model, (copies.get(m.model) ?? 0) + m.copies);
    for (let i = 0; i < m.copies; i++) bounds.union(m.copyBox(i, b));
  }
  const set: RegisteredSet = { id: o.id, name: o.name, file: o.file, members: [...copies].map(([model, n]) => ({ model, copies: n })), bounds, placed: o.members,
    ...(o.place === undefined ? {} : { place: o.place }), ...(o.pending === undefined ? {} : { pending: o.pending }) };
  (o.registry ?? app.registry).addSet(set);
  return set;
}

/** A spatial view of placed copies, without copying geometry or registering collision. Bounds select touching boxes
 * and use box distance for nearest(); centre selects box centres and uses squared centre distance. */
export function placedWithin(p: Placed, x: number, z: number, radius: number, mode: 'bounds' | 'centre'): Placed | null {
  const box = new THREE.Box3(), centre = new THREE.Vector3(), indices: number[] = [];
  for (let i = 0; i < p.copies; i++) {
    p.copyBox(i, box);
    box.getCenter(centre);
    const dx = mode === 'centre' ? centre.x - x : Math.max(box.min.x - x, 0, x - box.max.x);
    const dz = mode === 'centre' ? centre.z - z : Math.max(box.min.z - z, 0, z - box.max.z);
    if (dx * dx + dz * dz <= radius * radius) indices.push(i);
  }
  if (indices.length === 0) return null;
  if (indices.length === p.copies) return p;
  const copyBox = (i: number, target: THREE.Box3): THREE.Box3 => p.copyBox(indices[i] ?? 0, target);
  const registered = p.registered;
  return { ...p, colliders: [], copies: indices.length, copyBox,
    nearest: point => {
      let best = -1, distance = Infinity;
      for (let i = 0; i < indices.length; i++) {
        copyBox(i, box);
        const d = mode === 'centre' ? box.getCenter(centre).distanceToSquared(point) : box.distanceToPoint(point);
        if (d < distance) { distance = d; best = i; }
      }
      return best;
    },
    get registered() { return mode === 'centre' ? p.registered : registered; },
  };
}

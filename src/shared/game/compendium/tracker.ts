/**
 * CompendiumTracker — the game hooks that feed CompendiumState, polled a few times a second (never per frame):
 *
 *   • an animal within HEAR m (the compass paw's range)                          → discovered
 *   • an animal in view: within SPOT m, inside the view cone, line of sight clear → seen (SEEN + 1 per individual)
 *   • a kill (`killed(animal)`, from AnimalManager.onKill)                        → taken, BEST = massKg × scale³
 *   • a place: within its radius × REACH                                          → discovered; inside its radius → seen
 *
 *   const tracker = new CompendiumTracker(state, { canSee: (from, to) => … });
 *   game.onUpdate((dt) => tracker.update(dt, camera, animals.animals));
 *   animals.onKill = (a) => { …; tracker.killed(a); };
 */
import * as v from 'valibot';
import type { CompendiumRules } from './rules';

interface V3 { x: number; y: number; z: number }
/** what the tracker reads off an Animal (src/engine/entities/Animal.ts) */
export interface TrackedAnimal { kind: string; variant: string; alive: boolean; hidden: boolean; position: V3; scale: number }
/** the eye: position + unit view direction */
export interface TrackerEye { position: V3; forward: V3 }

export const HEAR = 120;
export const SPOT = 70;
/** half-angle of the spotting cone (rad): about a phone's horizontal field of view */
export const SPOT_CONE = 0.62;
/** a place is "heard of" from its radius × REACH */
export const REACH = 3;
const PERIOD = 0.25;
const ids = v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(256))), v.maxLength(1024),
  v.check(values => new Set(values).size === values.length));
const Saved: v.GenericSchema<BoundedCompendiumSaveInput, BoundedCompendiumSave> = v.strictObject({ version: v.literal(1), acc: v.pipe(v.number(), v.finite(), v.minValue(0), v.check(value => value < PERIOD)),
  heard: ids, spotted: ids, inside: ids });
/** Session identity sets and the exact polling clock, separate from durable entry statistics. */
export type CompendiumTrackerSnapshot = v.InferOutput<typeof Saved>;

export interface TrackerOptions {
  /** a clear line from the eye to the animal (physics ray); absent = always clear */
  canSee?: (from: V3, to: V3) => boolean;
}

export class CompendiumTracker {
  private acc = 0;
  /** individuals already counted as seen this session (a herd you stare at is not 40 sightings) */
  private spotted = new WeakSet<TrackedAnimal>();
  private heard = new WeakSet<TrackedAnimal>();
  /** places the eye is standing in */
  private inside = new Set<string>();
  private readonly cosCone = Math.cos(SPOT_CONE);
  private readonly to = { x: 0, y: 0, z: 0 };

  private readonly state: CompendiumRules;
  private readonly opts: TrackerOptions;
  constructor(state: CompendiumRules, opts: TrackerOptions = {}) { this.state = state; this.opts = opts; }

  /** Serialize only current owned animal identities. Retired animals cannot be observed again; weak sets never pin them. */
  snapshot(animals: readonly TrackedAnimal[], identity: (animal: TrackedAnimal) => string): CompendiumTrackerSnapshot {
    const owned = this.identities(animals, identity);
    return { version: 1, acc: this.acc,
      heard: [...owned].filter(([, animal]) => this.heard.has(animal)).map(([id]) => id),
      spotted: [...owned].filter(([, animal]) => this.spotted.has(animal)).map(([id]) => id), inside: [...this.inside] };
  }

  /** Rebind session identity to actual restored bodies. Every id and place validates before any clock/set changes. */
  prepareRestore(input: unknown, animals: readonly TrackedAnimal[], identity: (animal: TrackedAnimal) => string): () => void {
    const saved = v.parse(Saved, input), owned = this.identities(animals, identity);
    if (saved.heard.some(id => !owned.has(id)) || saved.spotted.some(id => !owned.has(id))
      || saved.inside.some(id => this.state.entry(id)?.place === undefined)) throw new RangeError('Unknown compendium tracker identity');
    const bodies = (list: readonly string[]): WeakSet<TrackedAnimal> => new WeakSet(list.map(id => {
      const animal = owned.get(id); if (animal === undefined) throw new RangeError('Missing compendium tracker body'); return animal;
    }));
    const heard = bodies(saved.heard), spotted = bodies(saved.spotted), inside = new Set(saved.inside);
    return () => { this.acc = saved.acc; this.heard = heard; this.spotted = spotted; this.inside = inside; };
  }

  private identities(animals: readonly TrackedAnimal[], identity: (animal: TrackedAnimal) => string): Map<string, TrackedAnimal> {
    if (animals.length > 1024) throw new RangeError('Compendium tracker identity capacity exceeded');
    const owned = new Map<string, TrackedAnimal>();
    for (const animal of animals) {
      const id = identity(animal);
      if (id.length === 0 || id.length > 256 || owned.has(id)) throw new RangeError('Invalid compendium tracker identity');
      owned.set(id, animal);
    }
    return owned;
  }

  /** body mass of a kill: the entry's scale-1 mass × the individual's scale³ */
  massOf(a: TrackedAnimal): number {
    const e = this.state.matching(a.kind, a.variant).find((m) => m.massKg !== undefined);
    // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
    return e?.massKg !== undefined ? e.massKg * Math.pow(a.scale, 3) : 0;
  }

  killed(a: TrackedAnimal): void {
    this.spotted.add(a);
    this.state.animalKilled(a.kind, a.variant, this.massOf(a));
  }

  update(dt: number, eye: TrackerEye, animals: readonly TrackedAnimal[]): void {
    this.acc += dt;
    if (this.acc < PERIOD) return;
    this.acc = 0;
    const p = eye.position, f = eye.forward;
    for (const a of animals) {
      if (!a.alive || a.hidden) continue;
      const dx = a.position.x - p.x, dy = a.position.y + 0.8 - p.y, dz = a.position.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > HEAR) continue;
      if (!this.heard.has(a)) { this.heard.add(a); this.state.animalNear(a.kind, a.variant); }
      if (d > SPOT || this.spotted.has(a) || d < 1e-3) continue;
      if ((dx * f.x + dy * f.y + dz * f.z) / d < this.cosCone) continue;
      this.to.x = a.position.x; this.to.y = a.position.y + 0.8; this.to.z = a.position.z;
      if (this.opts.canSee && !this.opts.canSee(p, this.to)) continue;
      this.spotted.add(a);
      this.state.animalSpotted(a.kind, a.variant);
    }
    for (const e of this.state.def.entries) {
      const pl = e.place;
      if (!pl) continue;
      const d = Math.hypot(pl.x - p.x, pl.z - p.z);
      const inside = d < pl.r;
      // a visit counts on the way in (VISITS + 1 each time you arrive, not each poll you stand there)
      if (inside && !this.inside.has(e.id)) this.state.placeVisited(e.id);
      else if (!inside && d < pl.r * REACH && !this.state.reached(e.id, 'discovered')) this.state.placeNear(e.id);
      if (inside) this.inside.add(e.id); else if (d > pl.r + 4) this.inside.delete(e.id); // 4 m of hysteresis at the edge
    }
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedCompendiumSaveInput = BoundedCompendiumSave;
interface BoundedCompendiumSaveFields {
    version: 1;
    acc: number;
    heard: string[];
    spotted: string[];
    inside: string[];
}
type BoundedCompendiumSave = { [Key in keyof BoundedCompendiumSaveFields]: BoundedCompendiumSaveFields[Key] };

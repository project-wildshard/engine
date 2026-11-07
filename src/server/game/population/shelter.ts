import { ReturnProgram, ProjectedState } from '../../../shared/game/population/returnProgram';
import { projectedSite } from './projectedSites';
import type { SimHost } from '@wildshard/engine/sim';
import { populationRoster } from './roster';
import { populationEnvironment } from './environment';
import { parsePopulationShelter, type HerdShelterRows } from '@wildshard/format/herdShelter';
import * as v from 'valibot';

/**
 * Grazing herds that shelter from the rain (SHARD-PLATFORM M3, a weather rule as data): through the rain every grazing
 * herd's wanders walk in under a big tree near it (its centre is held there from outside the AI: AnimalManager's own
 * wander logic walks stragglers back to it, through the `creature.wander-goal` answer `wanderGoal` gives) and, once the
 * rain is over, back home a while; then the herd is its own again. The shard gives the kinds that shelter, what counts as
 * a big tree, how far a herd looks for one and how long its old home is held, and the crown cover (a tree under thicker
 * cover is a better shelter).
 */

interface Shelter { home: { x: number; z: number }; spot: { x: number; z: number } | null; hold: number }
export interface Herd {
  kind: string; cx: number; cz: number;
  readonly members: readonly { alive: boolean; position: { x: number; z: number } }[];
}
export interface Tree { x: number; z: number; r: number; height: number; cover: number; [field: string]: number }
const finite = v.pipe(v.number(), v.finite());
const point = v.strictObject({ x: finite, z: finite });
const saved: v.GenericSchema<BoundedShelterSaveInput, BoundedShelterSave> = v.strictObject({ version: v.literal(1), shelters: v.array(v.nullable(v.strictObject({
  home: point, spot: v.nullable(point), hold: v.pipe(finite, v.minValue(0))
}))) });

/** The herds' shelters through a shower (see the module's comment). */
export class HerdShelter<T extends Tree> {
  private readonly kinds: ReadonlySet<string>;
  private readonly big: readonly T[];
  private shelters = new Map<Herd, Shelter>();
  private readonly steps = new Map<Herd, ProjectedState>();
  private readonly goals = new Map<Herd, { x: number; z: number; r: number } | null>();
  private readonly lastGoal = new Map<Herd, { present: number; spot: number; homeX: number; homeZ: number; spotX: number; spotZ: number; rain: number;
    goal: { x: number; z: number; r: number } | null }>();

  /** `animals` lends the herds; each tree carries its fixed crown-cover sample; `look` supplies the rule's numbers. */
  constructor(private readonly animals: { readonly herds: readonly Herd[] }, trees: readonly T[], private readonly look: HerdShelterRows, private readonly program: ReturnProgram) {
    if (trees.length > 16384) throw new Error('Population shelter tree bound exceeded');
    this.kinds = new Set(look.kinds);
    this.big = trees.filter((t) => t.height >= look.bigTree);
  }

  private pick(hd: Herd): { x: number; z: number } | null {
    const selected = projectedSite(this.big, this.program, { signal: 'shelterScore', limit: 16384, origin: { x: hd.cx, z: hd.cz }, minimum: 0,
      maximum: this.look.reach, observations: { heightBias: this.look.heightBias, coverBias: this.look.coverBias } });
    if (selected === null) return null;
    const t = selected.site;
    const projected = this.program.project('shelterPlace', { x: t.x, z: t.z, radius: t.r, clear: this.look.clear,
      homeX: hd.cx, homeZ: hd.cz, distance: Math.hypot(hd.cx - t.x, hd.cz - t.z) || 1 });
    const x = projected['x'], z = projected['z'];
    if (x === undefined || z === undefined) throw new Error('Missing shelter projection');
    return { x, z };
  }

  /** Sample the guest on the caller's clock; it owns wet, hold and expiry rules. */
  update(dt: number, rain: number): void {
    for (const hd of this.animals.herds) {
      if (!this.kinds.has(hd.kind)) continue;
      let clock = this.steps.get(hd);
      if (clock === undefined) {
        clock = new ProjectedState({ initial: {}, retain: {}, signals: { step: 'shelterStep' } }, this.program);
        this.steps.set(hd, clock);
      }
      let s = this.shelters.get(hd);
      const sampled = clock.step(dt, { present: Number(s !== undefined), hold: s?.hold ?? 0, rain,
        wet: this.look.wet, dry: this.look.dry, homeHold: this.look.homeHold });
      if (sampled.dt === 0) continue;
      const keep = sampled.values['keep'], create = sampled.values['create'], apply = sampled.values['apply'], hold = sampled.values['hold'];
      if ((keep !== 0 && keep !== 1) || (create !== 0 && create !== 1) || (apply !== 0 && apply !== 1)
        || hold === undefined || hold < 0 || hold > this.look.homeHold) throw new Error('Invalid shelter step projection');
      if (keep === 0) this.shelters.delete(hd);
      else {
        if (create === 1) { s = { home: { x: hd.cx, z: hd.cz }, spot: this.pick(hd), hold }; this.shelters.set(hd, s); }
        if (s === undefined) throw new Error('Shelter projection needs a retained home');
        s.hold = hold;
        if (apply === 1 && s.spot !== null) { hd.cx = s.spot.x; hd.cz = s.spot.z; }
      }
      this.goals.set(hd, this.goal(hd, rain));
    }
  }

  private goal(hd: Herd, rain: number): { x: number; z: number; r: number } | null {
    const s = this.shelters.get(hd), spot = s?.spot;
    const present = Number(s !== undefined), hasSpot = Number(spot !== undefined && spot !== null), homeX = s?.home.x ?? 0, homeZ = s?.home.z ?? 0,
      spotX = spot?.x ?? 0, spotZ = spot?.z ?? 0;
    // the guest is rewound before every call, so the same observations give the same goal: a frame that changed none of
    // them reuses the last answer instead of a module call per herd per frame (FC, Pine's update)
    const last = this.lastGoal.get(hd);
    if (last !== undefined && last.present === present && last.spot === hasSpot && last.homeX === homeX && last.homeZ === homeZ
      && last.spotX === spotX && last.spotZ === spotZ && last.rain === rain) return last.goal;
    const out = this.program.project('shelterGoal', { present, spot: hasSpot, homeX, homeZ, spotX, spotZ,
      rain, wet: this.look.wet, spotR: this.look.spotR, homeR: this.look.homeR });
    const accept = out['accept'], x = out['x'], z = out['z'], r = out['r'];
    if (accept !== 0 && (accept !== 1 || x === undefined || z === undefined || r === undefined || r < 0)) throw new Error('Invalid shelter goal projection');
    const goal = accept === 0 || x === undefined || z === undefined || r === undefined ? null : { x, z, r };
    this.lastGoal.set(hd, { present, spot: hasSpot, homeX, homeZ, spotX, spotZ, rain, goal });
    return goal;
  }

  /** Borrow the latest projected goal; a v1 restore is sampled on its first query. */
  wanderGoal(herd: number, rain: number): { x: number; z: number; r: number } | null {
    const hd = this.animals.herds[herd];
    if (hd === undefined || !this.kinds.has(hd.kind)) return null;
    let goal = this.goals.get(hd);
    if (goal === undefined) { goal = this.goal(hd, rain); this.goals.set(hd, goal); }
    return goal === null ? null : { ...goal };
  }

  /** Native v1 continuation in herd order; points never alias live state. */
  snapshot(): v.InferOutput<typeof saved> {
    return { version: 1, shelters: this.animals.herds.map(herd => {
      const shelter = this.shelters.get(herd);
      return shelter === undefined ? null : { home: { ...shelter.home }, spot: shelter.spot === null ? null : { ...shelter.spot }, hold: shelter.hold };
    }) };
  }

  /** Admit every legacy slot before replacing state, without moving a herd. */
  restore(value: unknown): void {
    const parsed = v.parse(saved, value), herds = this.animals.herds, next = new Map<Herd, Shelter>();
    if (parsed.shelters.length !== herds.length) throw new Error('Incompatible population rain-herd continuation');
    parsed.shelters.forEach((shelter, index) => {
      if (shelter === null) return;
      const herd = herds[index];
      if (herd === undefined || !this.kinds.has(herd.kind) || shelter.hold > this.look.homeHold) throw new Error('Incompatible Population shelter continuation');
      next.set(herd, shelter);
    });
    this.shelters = next; this.steps.clear(); this.goals.clear();
  }

  /** Dev evidence: every sheltering kind's member's distance to the nearest big tree — the mean, how many stand within 6 m. */
  stats(): { n: number; mean: number; under6: number; sheltering: number } {
    const d: number[] = [];
    for (const hd of this.animals.herds) if (this.kinds.has(hd.kind)) for (const m of hd.members) if (m.alive) {
      let best = Infinity;
      for (const t of this.big) best = Math.min(best, Math.hypot(t.x - m.position.x, t.z - m.position.z));
      d.push(best);
    }
    return { n: d.length, mean: Math.round(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length) * 10) / 10, under6: d.filter((distance) => distance < 6).length, sheltering: [...this.shelters.values()].filter((s) => s.spot !== null).length };
  }
}

/** Native tree tuples are the page's exact crown-cover samples, kept in forest order. */
export type NativeShelterTree = readonly [x: number, z: number, radius: number, height: number, cover: number];

/** Install shelter over concrete roster, environment and weather ids. No shard
 * callback or deferred shard resolver is retained. Goals are plain observations,
 * published at the existing shelter step before the roster's AI decisions. */
export function installNativeHerdShelter(host: SimHost, trees: readonly NativeShelterTree[], input: unknown): HerdShelter<{ x: number; z: number; r: number; height: number; cover: number }> {
  const rows = parsePopulationShelter(input), environment = populationEnvironment(host, rows.environment);
  if (trees.length > 16384) throw new Error('Shelter tree bound exceeded');
  const source = { get herds() {
    const current = populationRoster(host, rows.roster).hunt.herds;
    if (current.length > rows.herdLimit) throw new Error('Shelter herd bound exceeded');
    return current;
  } };
  const shelter = new HerdShelter(source, trees.map(([x, z, r, height, cover]) => ({ x, z, r, height, cover })), rows.look, ReturnProgram.native(host, rows.program));
  const rainNow = (): number => {
    const value = host.events.ask('weather.rain', { id: rows.weather, rain: Number.NaN }).rain;
    if (!Number.isFinite(value)) throw new Error(`Missing native weather: ${rows.weather}`);
    return value;
  };
  const publish = (): void => {
    const rain = rainNow(), goals = environment.wanderGoals;
    goals.length = source.herds.length;
    for (let i = 0; i < goals.length; i++) goals[i] = shelter.wanderGoal(i, rain);
  };
  host.onStep(rows.step, dt => { shelter.update(dt, rainNow()); publish(); }, {
    snapshot: () => shelter.snapshot(), restore: value => { shelter.restore(value); publish(); },
  });
  return shelter;
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedShelterSaveInput = BoundedShelterSave;
interface BoundedShelterSaveFields {
    version: 1;
    shelters: ({
        home: {
            x: number;
            z: number;
        };
        spot: {
            x: number;
            z: number;
        } | null;
        hold: number;
    } | null)[];
}
type BoundedShelterSave = { [Key in keyof BoundedShelterSaveFields]: BoundedShelterSaveFields[Key] };

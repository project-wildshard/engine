import * as v from 'valibot';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';

/** Admitted event-only decisions; the session owns numeric state and bounded cadence. */
export interface TamingPrograms { approach: unknown; breaking: unknown; riding: unknown; initial: Record<string, number> }
/** A view or native owner supplies only numeric observations and actor identities. */
export interface TamingCandidate { id: string; x: number; y: number; z: number; alive: number; upgraded: number; scale: number; dot: number }
export interface TamingFrame {
  x: number; y: number; z: number; mounted: string | null; crouched: boolean; offer: boolean; lean: number;
  wind: { x: number; z: number; strength: number };
  herds: readonly { stallion: TamingCandidate | null; cx: number; cz: number; trust: number; alert: number; beaten: boolean; fleeing: boolean }[];
  random: readonly [number, number, number];
}
export type TamingEffect =
  | { kind: 'trust'; herd: number; delta: number; alert?: number }
  | { kind: 'ownership'; herd: number; active: boolean }
  | { kind: 'lead'; herd: number; x: number; z: number }
  | { kind: 'pose'; actor: string; values: Readonly<Record<string, number>>; direction: number }
  | { kind: 'breaking'; on: boolean }
  | { kind: 'dismount'; thrown: boolean }
  | { kind: 'hurt'; damage: number }
  | { kind: 'bond'; herd: number; actor: string; previous: string | null; upgraded: boolean }
  | { kind: 'notice'; name: 'trust' | 'start' | 'thrown' };
const finite = v.pipe(v.number(), v.finite()), herdIndex = v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(7));
const Saved = v.strictObject({ version: v.literal(3), phase: v.picklist(['wild', 'breaking', 'bonded']),
  bonded: v.nullable(v.string()), upgraded: v.boolean(), herd: v.nullable(herdIndex), stallion: v.nullable(v.string()),
  drove: v.pipe(v.array(herdIndex), v.maxLength(8)), state: v.record(v.string(), finite),
  clock: v.pipe(finite, v.minValue(0), v.maxValue(.1)), prev: v.nullable(v.tuple([finite, finite, finite])) });

/** Renderer-free taming session. No actor, herd controller or authored TS callback
 * crosses this API. Decisions stay in the admitted guest; effects use stable ids.
 * The G478 fixture may use entirely unrelated animals and program rows. */
export class TamingSession {
  phase: 'wild' | 'breaking' | 'bonded' = 'wild';
  bonded: string | null = null;
  upgraded = false;
  herd: number | null = null;
  stallion: string | null = null;
  readonly view = { trust: null as number | null, alert: 0, ear: false, earOffset: 0, round: null as number | null, balance: 0, danger: false, offer: false, radius: 0, beaten: false, roll: 0, shake: 0 };
  private readonly drove = new Set<number>();
  private clock = 0;
  private previous: [number, number, number] | null = null;
  private state: Record<string, number>;
  private readonly keys: readonly string[];
  private readonly approach: ReturnProgram;
  private readonly breaking: ReturnProgram;
  constructor(private readonly programs: TamingPrograms, private readonly fields: { upgraded: string; horseUpgraded: string; candidateUpgraded: string }) {
    this.approach = ReturnProgram.page(programs.approach); this.breaking = ReturnProgram.page(programs.breaking);
    this.state = v.parse(v.record(v.string(), finite), { ...programs.initial }); this.keys = Object.keys(this.state);
    if (this.keys.length > 32) throw new Error('Taming state bound exceeded');
  }
  private check(frame: TamingFrame): void {
    if (frame.herds.length > 8) throw new Error('Taming herd bound exceeded');
  }
  eligible(upgraded: boolean): boolean {
    return this.approach.project('eligible', { bonded: Number(this.bonded !== null), [this.fields.upgraded]: Number(this.upgraded), [this.fields.horseUpgraded]: Number(upgraded) })['accept'] === 1;
  }
  adopt(id: string, upgraded: boolean): void { this.bonded = id; this.upgraded = upgraded; this.phase = 'bonded'; }
  event(x: number, z: number, shot: boolean, frame: TamingFrame): TamingEffect[] {
    this.check(frame); const effects: TamingEffect[] = [];
    frame.herds.forEach((herd, index) => {
      if ((!shot && this.drove.has(index)) || (shot && herd.stallion === null)) return;
      const point = shot ? herd.stallion : herd; if (point === null) return;
      const row = this.approach.project('event', { x, z, cx: 'x' in point ? point.x : point.cx, cz: 'z' in point ? point.z : point.cz,
        px: frame.x, pz: frame.z, shot: Number(shot), alert: herd.alert });
      effects.push({ kind: 'trust', herd: index, delta: row['trust'] ?? 0, alert: row['alert'] ?? herd.alert });
      if (!shot && (row['trust'] ?? 0) > 0) { this.drove.add(index); effects.push({ kind: 'notice', name: 'trust' }); }
    }); return effects;
  }
  /** Called after the trusted motor accepts the selected actor. */
  start(frame: TamingFrame): TamingEffect[] {
    this.check(frame);
    if (this.herd === null || this.stallion === null || frame.mounted !== this.stallion || this.phase === 'breaking') return [];
    this.phase = 'breaking'; this.view.radius = 0; this.view.round = 1; this.clock = 0;
    this.state = { ...this.programs.initial, ...this.breaking.project('start', { r0: frame.random[0], r1: frame.random[1] }) };
    return [{ kind: 'ownership', herd: this.herd, active: true }, { kind: 'breaking', on: true }, { kind: 'notice', name: 'start' }];
  }
  sample(dt: number, frame: TamingFrame): TamingEffect[] {
    this.check(frame);
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid taming elapsed time');
    if (this.phase === 'breaking' && frame.mounted !== this.stallion) return this.finish(false, frame);
    this.clock += dt; if (this.clock + 1e-9 < .1) return [];
    const elapsed = this.clock; this.clock = 0;
    if (this.phase === 'breaking') return this.buck(elapsed, frame);
    const previous = this.previous;
    this.state['speed'] = previous === null ? 0 : (this.state['speed'] ?? 0) + (Math.hypot(frame.x - previous[0], frame.z - previous[2]) / elapsed - (this.state['speed'] ?? 0)) * Math.min(1, elapsed * 6);
    this.previous = [frame.x, frame.y, frame.z];
    const candidates = frame.herds.map(h => h.stallion === null ? { x: 0, y: 0, z: 0, alive: 0, [this.fields.candidateUpgraded]: 0 } : { x: h.stallion.x, y: h.stallion.y, z: h.stallion.z, alive: h.stallion.alive, [this.fields.candidateUpgraded]: h.stallion.upgraded });
    const selected = this.approach.project('select', { count: candidates.length, px: frame.x, py: frame.y, pz: frame.z, bonded: Number(this.bonded !== null), [this.fields.upgraded]: Number(this.upgraded) }, undefined, candidates);
    const index = selected['index'] ?? -1, herd = frame.herds[index], effects: TamingEffect[] = [];
    if (this.herd !== null && this.herd !== index) effects.push({ kind: 'ownership', herd: this.herd, active: false });
    this.herd = herd === undefined ? null : index; this.stallion = herd?.stallion?.id ?? null;
    Object.assign(this.view, { radius: 0, round: null, danger: false, trust: null, ear: false, offer: false });
    const actor = herd?.stallion; if (herd === undefined || actor === null || actor === undefined) return effects;
    if (selected['active'] === 0) return [...effects, { kind: 'ownership', herd: index, active: false }, { kind: 'trust', herd: index, delta: -elapsed }];
    const tx = frame.x - actor.x, tz = frame.z - actor.z, wind = frame.wind;
    const row = this.approach.project('approach', { dt: elapsed, distance: selected['distance'] ?? 41, beaten: Number(herd.beaten), mounted: Number(frame.mounted !== null), speed: this.state['speed'] ?? 0,
      scale: actor.scale, dot: actor.dot, lookT: this.state['lookT'] ?? 0, offer: Number(frame.offer), alert: herd.alert, trust: herd.trust, crouched: Number(frame.crouched),
      downwind: (tx * wind.x + tz * wind.z) / (Math.hypot(tx, tz) || 1), strength: wind.strength, flee: Number(herd.fleeing) });
    this.state['lookT'] = row['lookT'] ?? 0;
    effects.push({ kind: 'ownership', herd: index, active: true }, { kind: 'trust', herd: index, delta: row['trust'] ?? 0, alert: row['alert'] ?? herd.alert });
    if (row['lead'] === 1) effects.push({ kind: 'lead', herd: index, x: frame.x, z: frame.z });
    Object.assign(this.view, { radius: row['radius'] ?? 0, earOffset: row['ear'] ?? 0, trust: Math.max(0, Math.min(100, herd.trust + (row['trust'] ?? 0))), alert: row['alert'] ?? herd.alert, ear: true, offer: row['offer'] === 1, beaten: herd.beaten });
    return effects;
  }
  sampleDue(dt: number): boolean { return this.clock + dt + 1e-9 >= .1; }
  private buck(dt: number, frame: TamingFrame): TamingEffect[] {
    const row = this.breaking.project('step', { ...this.state, dt, lean: frame.lean, r0: frame.random[0], r1: frame.random[1], r2: frame.random[2] });
    for (const key of this.keys) if (row[key] !== undefined) this.state[key] = row[key];
    Object.assign(this.view, { roll: row['roll'] ?? 0, shake: row['shake'] ?? 0, round: row['round'] ?? 1, balance: row['b'] ?? 0, danger: row['danger'] === 1, trust: null, ear: false });
    const effects: TamingEffect[] = this.stallion === null ? [] : [{ kind: 'pose', actor: this.stallion, values: row, direction: this.state['dir'] ?? 1 }];
    return (row['outcome'] ?? 0) === 0 ? effects : [...effects, ...this.finish(row['outcome'] === 1, frame)];
  }
  private finish(won: boolean, frame: TamingFrame): TamingEffect[] {
    this.phase = this.bonded === null ? 'wild' : 'bonded'; Object.assign(this.view, { round: null, danger: false, roll: 0, shake: 0 });
    const effects: TamingEffect[] = [{ kind: 'breaking', on: false }];
    if (this.stallion === null || this.herd === null) return frame.mounted === null ? effects : [...effects, { kind: 'dismount', thrown: true }];
    effects.push({ kind: 'pose', actor: this.stallion, values: { buck: 0, rear: 0 }, direction: 1 });
    if (won) return [...effects, { kind: 'bond', herd: this.herd, actor: this.stallion, previous: this.bonded, upgraded: frame.herds[this.herd]?.stallion?.upgraded === 1 }];
    const loss = this.approach.project('finish', { won: 0 });
    return [...effects, { kind: 'dismount', thrown: true }, { kind: 'hurt', damage: loss['damage'] ?? 0 }, { kind: 'trust', herd: this.herd, delta: loss['trust'] ?? 0 }, { kind: 'lead', herd: this.herd, x: frame.x, z: frame.z }, { kind: 'notice', name: 'thrown' }];
  }
  snapshot(): string { return JSON.stringify({ version: 3, phase: this.phase, bonded: this.bonded, upgraded: this.upgraded, herd: this.herd, stallion: this.stallion, drove: [...this.drove], state: this.state, clock: this.clock, prev: this.previous }); }
  restore(wire: string, actors: readonly string[], herds: number, mounted: string | null): void {
    if (wire.length > 65536 || actors.length > 64 || herds > 8) throw new Error('Taming continuation bound exceeded');
    const saved = v.parse(Saved, JSON.parse(wire)), ids = new Set(actors);
    if (ids.size !== actors.length || [saved.bonded, saved.stallion].some(id => id !== null && !ids.has(id)) || (saved.herd !== null && saved.herd >= herds)
      || saved.drove.some(index => index >= herds) || new Set(saved.drove).size !== saved.drove.length || Object.keys(saved.state).sort().join(',') !== [...this.keys].sort().join(',')
      || Math.abs(saved.state['b'] ?? 2) > 1.2 || (saved.state['round'] ?? 0) < 1 || (saved.state['round'] ?? 7) > 6
      || (saved.phase === 'breaking' && (saved.herd === null || saved.stallion === null || mounted !== saved.stallion)) || ((saved.phase === 'bonded' || saved.upgraded) && saved.bonded === null)) throw new Error('Invalid taming continuation');
    this.phase = saved.phase; this.bonded = saved.bonded; this.upgraded = saved.upgraded; this.herd = saved.herd; this.stallion = saved.stallion; this.state = saved.state; this.clock = saved.clock; this.previous = saved.prev;
    Object.assign(this.view, { round: saved.phase === 'breaking' ? saved.state['round'] ?? 1 : null, balance: saved.state['b'] ?? 0, radius: 0 });
    this.drove.clear(); saved.drove.forEach(index => { this.drove.add(index); });
  }
}

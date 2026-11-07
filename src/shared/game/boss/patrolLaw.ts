import type { Rng } from '@wildshard/engine/core/rng';
import type { EncounterPatrolRows, EncounterScheduleRows } from '@wildshard/format/encounterRows';
import { ProjectedState, type ProjectedSnapshot, type ReturnProgram } from '../population/returnProgram';

/**
 * A night patrol's numbers (TimedEncounters riders; Nalati's Qara Batyr), with no scene: the cycle (respawn, phase,
 * kills tonight), each line's group projection and each rider's member / fire / retry / dissolve law, the steering memory
 * the roster's brains read, and the aim of a loosed arrow. The page's PatrolEncounterView (encounterView.ts) draws it
 * through `present` and a rider's `view`; a Node simulation (CI12's Qara Batyr tape) runs the same law over its own
 * bodies. The existing AS projections own every decision; this only orders the calls exactly as the page did.
 */
export interface PatrolLawActor { readonly entityId: string; readonly position: { readonly x: number; readonly z: number }; readonly mem: Record<string, number>;
  readonly alive: boolean; readonly hidden: boolean; herd: number }
export interface PatrolLawRoster<A extends PatrolLawActor> { readonly factory: { model: (kind: string, variant: string) => unknown };
  spawn: (kind: string, x: number, z: number, yaw: number, variant: string) => A; retire: (actor: A) => void }
/** One rider: its body, its law, its line (null: alone) and place in it, its steering, and the drawer's own state. */
export interface PatrolRider<A, V> { readonly a: A; readonly law: ProjectedState; readonly group: ProjectedState | null; readonly slot: number;
  readonly steering: Record<string, number>; readonly view: V }
/** A step's per-rider outcome (the member projection's channels and `shoot`), keyed by rider. */
export type PatrolEffects<A, V> = ReadonlyMap<PatrolRider<A, V>, Readonly<Record<string, number>>>;
export interface PatrolPlayer { readonly position: { readonly x: number; readonly y: number; readonly z: number } }
/** CI12: a patrol's whole continuation as data: the cycle, the motion clock, each line's group, and each rider's law, line
 *  (its index in `groups`, -1: alone), place in it and steering, by its body's entity id */
export interface PatrolSnapshot {
  readonly cycle: ProjectedSnapshot; readonly motion: ProjectedSnapshot; readonly groups: readonly ProjectedSnapshot[];
  readonly riders: readonly { readonly id: string; readonly law: ProjectedSnapshot; readonly group: number; readonly slot: number; readonly steering: Readonly<Record<string, number>> }[];
}

export class PatrolLaw<A extends PatrolLawActor, V> {
  readonly riders: PatrolRider<A, V>[] = [];
  private readonly cycle: ProjectedState;
  private readonly groups: ProjectedState[] = [];
  private roster: PatrolLawRoster<A> | null = null;
  readonly motion: ProjectedState;
  get killsTonight(): number { return this.cycle.value('kills'); }
  get attached(): boolean { return this.roster !== null; }
  private get living(): number { return this.riders.filter(r => r.law.state['dead'] !== 1).length; }
  /** `random`: the patrol's own decisions (the page's 'ai' stream as it was when built); `aimRandom`: the stream an aim
   *  reads at the shot (looked up then); `present`: draw a new rider (its look, figure and cue), its view state */
  constructor(private readonly patrol: EncounterPatrolRows, motion: EncounterScheduleRows, private readonly program: ReturnProgram,
    private readonly ports: { readonly player: PatrolPlayer; readonly random: Rng; readonly aimRandom: () => Rng; readonly present: (a: A, quiet: boolean) => V }) {
    this.cycle = new ProjectedState({ initial: { respawn: -1, phase: -1, kills: 0 }, signals: { step: patrol.signals.cycle, empty: patrol.signals.empty } }, program);
    this.motion = new ProjectedState(motion, program);
  }
  attachActors(roster: PatrolLawRoster<A>): void {
    const rows = this.patrol.actors; if (rows === undefined) throw new Error('Missing patrol actor rows');
    roster.factory.model(rows.kind, rows.variant); this.roster = roster;
  }
  spawnRider(at: { readonly x: number; readonly z: number; readonly yaw: number; readonly variant?: string; readonly quiet?: boolean }): A | null { return this.spawn(at, null, 0); }
  spawnLine(at: { readonly count?: number; readonly captain?: boolean; readonly at?: number } = {}): A[] {
    const rows = this.patrol, actors = rows.actors; if (actors === undefined || this.roster === null) return [];
    const count = at.count ?? actors.count; if (!Number.isSafeInteger(count) || count < 0 || count > 8) throw new RangeError('Invalid patrol group size');
    const p = this.ports.player.position, start = this.program.project(rows.signals.start, { ...rows.parameters, at: at.at ?? -1, px: p.x, pz: p.z }, this.ports.random);
    const group = new ProjectedState({ initial: { ...rows.group, ...start }, parameters: rows.parameters, signal: rows.signals.group }, this.program); this.groups.push(group);
    const slots = Array.from({ length: count }, (_, slot) => this.program.project(rows.signals.slot, { ...rows.parameters, ...group.state, slot }));
    return slots.flatMap((placement, slot) => { const actor = this.spawn({ x: placement['x'] ?? 0, z: placement['z'] ?? 0, yaw: placement['yaw'] ?? 0, variant: slot === 0 && at.captain === true ? actors.leader : actors.variant }, group, slot); return actor === null ? [] : [actor]; });
  }
  dissolve(actor: A): void { this.riders.find(r => r.a === actor)?.law.event('dissolve'); }
  dawn(): void { for (const r of this.riders) this.dissolve(r.a); }
  private spawn(at: { readonly x: number; readonly z: number; readonly yaw: number; readonly variant?: string; readonly quiet?: boolean }, group: ProjectedState | null, slot: number): A | null {
    const rows = this.patrol, actors = rows.actors; if (actors === undefined || this.roster === null) return null;
    const a = this.roster.spawn(actors.kind, at.x, at.z, at.yaw, at.variant ?? actors.variant); a.herd = actors.herd;
    if (this.riders.some(r => r.a.entityId === a.entityId)) throw new Error('Invalid patrol member');
    const law = new ProjectedState({ initial: { ...rows.member, quiet: Number(at.quiet === true), ...this.program.project(rows.signals.retry, { first: 1 }, this.ports.random) },
      signals: { member: rows.signals.member, fire: rows.signals.fire, retry: rows.signals.retry, dissolve: rows.signals.dissolve } }, this.program);
    const view = this.ports.present(a, at.quiet === true);
    this.riders.push({ a, law, group, slot, steering: {}, view });
    return a;
  }
  /** One step of the law (`frame`: the patrol's own fields; the player's px / py / pz are added): the cycle, each line's
   *  group and its riders' targets, every rider's member / fire / retry, the empty event, the steering memory, the motion
   *  clock and a new line when the cycle spawns one. `freeze` holds every rider's target where it stands. Returns each
   *  rider's outcome this step (empty when the cycle did not step); the caller retires (`retire`) and draws in order. */
  step(dt: number, frame: Readonly<Record<string, number>>, freeze = false): PatrolEffects<A, V> {
    const p = this.ports.player.position;
    const tick = { ...frame, px: p.x, py: p.y, pz: p.z }, step = this.cycle.step(this.roster === null ? 0 : dt, { ...tick, living: this.living });
    const effects = new Map<PatrolRider<A, V>, Readonly<Record<string, number>>>(), patrol = this.patrol, actors = patrol.actors;
    if (actors === undefined) throw new Error('Missing patrol actor rows');
    if (step.dt > 0) {
      if (step.values['dissolve'] === 1) this.dawn();
      for (const group of this.groups) {
        const members = this.riders.filter(r => r.group === group), lead = members.find(r => r.law.state['dead'] !== 1); if (lead === undefined) continue;
        group.project({ ...tick, dt: step.dt, ax: lead.a.position.x, az: lead.a.position.z });
        for (const r of members) { if (r.law.state['dead'] === 1) continue; const a = r.a, target = this.program.project(patrol.signals.target, { ...patrol.parameters, ...group.state, ...tick, slot: r.slot, ax: a.position.x, az: a.position.z });
          Object.assign(r.steering, { tx: target['x'] ?? a.position.x, tz: target['z'] ?? a.position.z, v: target['speed'] ?? 0, turn: target['turn'] ?? 0 }); }
      }
      for (const r of this.riders) {
        const a = r.a, result = r.law.event('member', { dt: step.dt, alive: Number(a.alive) });
        const fire = r.law.event('fire', { dt: step.dt, hidden: Number(a.hidden), distance: Math.hypot(p.x - a.position.x, p.z - a.position.z), engaged: Number(r.group === null || r.group.state['mode'] === 1) });
        if (fire['shoot'] === 1) r.law.event('retry', { first: 0 }, this.ports.random); effects.set(r, { ...result, shoot: fire['shoot'] ?? 0 });
      }
      const empty = Number(this.groups.some(group => this.riders.filter(r => r.group === group).every(r => r.law.state['dead'] === 1 || r.a.hidden)));
      this.cycle.event('empty', { ...tick, living: this.living, killed: [...effects.values()].filter(effect => effect['killed'] === 1).length, empty });
      for (let i = this.groups.length - 1; i >= 0; i--) { const group = this.groups[i]; if (group !== undefined && this.riders.filter(r => r.group === group).every(r => r.law.state['dead'] === 1 || r.a.hidden)) this.groups.splice(i, 1); }
    }
    for (const r of this.riders) {
      const a = r.a; a.mem[actors.player.x] = p.x; a.mem[actors.player.z] = p.z;
      if (r.group !== null) for (const [slot, channel] of Object.entries(actors.steering)) { const value = r.steering[channel] ?? r.law.state[channel]; if (value !== undefined) a.mem[slot] = value; }
      if (freeze) { a.mem[actors.target.x] = a.position.x; a.mem[actors.target.z] = a.position.z; }
    }
    if (step.dt > 0) this.motion.project({ dt: step.dt, px: p.x, pz: p.z });
    if (step.values['spawn'] === 1) this.spawnLine();
    return effects;
  }
  /** The patrol's continuation as data (a native checkpoint). */
  snapshot(): PatrolSnapshot {
    return { cycle: this.cycle.snapshot(), motion: this.motion.snapshot(), groups: this.groups.map(group => group.snapshot()),
      riders: this.riders.map(r => ({ id: r.a.entityId, law: r.law.snapshot(), group: r.group === null ? -1 : this.groups.indexOf(r.group), slot: r.slot, steering: { ...r.steering } })) };
  }
  /** Continue from `saved` over the riders' bodies (`resolve`: a body by its entity id, already spawned on the attached
   *  roster); each rider's view is presented again. Replaces the current lines and riders without retiring their bodies. */
  restore(saved: PatrolSnapshot, resolve: (id: string) => A): void {
    const rows = this.patrol;
    this.cycle.restore(saved.cycle); this.motion.restore(saved.motion);
    this.groups.length = 0;
    for (const group of saved.groups) { const law = new ProjectedState({ initial: { ...group.state }, parameters: rows.parameters, signal: rows.signals.group }, this.program); law.restore(group); this.groups.push(law); }
    this.riders.length = 0;
    for (const row of saved.riders) {
      const a = resolve(row.id), group = row.group < 0 ? null : this.groups[row.group] ?? null;
      if (row.group >= 0 && group === null) throw new Error('Invalid patrol snapshot line');
      const law = new ProjectedState({ initial: { ...row.law.state }, signals: { member: rows.signals.member, fire: rows.signals.fire, retry: rows.signals.retry, dissolve: rows.signals.dissolve } }, this.program);
      law.restore(row.law);
      this.riders.push({ a, law, group, slot: row.slot, steering: { ...row.steering }, view: this.ports.present(a, law.state['quiet'] === 1) });
    }
  }
  /** Retire the rider at `index` (its body back to the roster); the caller drops its view state. */
  retire(index: number): void {
    const r = this.riders[index]; if (r === undefined) return;
    this.roster?.retire(r.a); this.riders.splice(index, 1);
  }
  /** A loosed arrow's direction from `from` at the player: the `aim` projection's lead and spread (dx, dy, dz). */
  aim(signal: string, from: { readonly x: number; readonly y: number; readonly z: number }): Readonly<Record<string, number>> {
    const p = this.ports.player.position;
    return this.program.project(signal, { x: from.x, y: from.y, z: from.z, px: p.x, py: p.y, pz: p.z, vx: this.motion.value('vx'), vz: this.motion.value('vz') }, this.ports.aimRandom());
  }
}

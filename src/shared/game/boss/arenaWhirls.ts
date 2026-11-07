/**
 * The open arena's whirlwinds, renderer-free (CI12: the Storm Titan's Node tape steps them without their funnels): one
 * admitted wander law each (`laws`, sharing the first's cooldown `cd`) and the gate law that eases, arms and shows them.
 * `drawn` holds each one's ease, whether it shows, and where it stands after an update; `ArenaWhirlsView` (arenaFire.ts)
 * draws the funnels and debris from it.
 *
 *   const whirls = new ArenaWhirls(rows, windProgram, gateProgram, scope);   // + ground (x, z) => y: a native host's sampler
 *   whirls.arm(0b11); const hits = whirls.update(dt, t, true, thinkDt, { wx, wz, px, pz });
 */
import type { Scope } from '@wildshard/engine/app/scope';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import type { ArenaWhirlsRows } from '@wildshard/format/encounterRows';
import { ProjectedState, type ProjectedSnapshot, type ReturnProgram } from '../population/returnProgram';

/** a whirlwind that touched the player this tick, where it stands */
export interface WhirlHit { x: number; y: number; z: number }
export interface WhirlFrame { readonly wx: number; readonly wz: number; readonly px: number; readonly pz: number }
/** The whirlwinds' continuation (`ArenaWhirls.snapshot`): the gate's and each wander law's state, and what each one drew. */
export interface ArenaWhirlsSnapshot {
  readonly gate: ProjectedSnapshot; readonly laws: readonly ProjectedSnapshot[];
  readonly drawn: readonly { readonly k: number; readonly shown: number; readonly x: number; readonly y: number; readonly z: number }[];
}

export class ArenaWhirls {
  private readonly rows: ArenaWhirlsRows;
  private readonly laws: readonly ProjectedState[];
  private readonly gate: ProjectedState;
  private readonly hits: WhirlHit[] = [];
  /** per whirlwind after the last update: its ease, whether it shows, and where it stands (x, the ground, z) */
  readonly drawn: { k: number; shown: number; x: number; y: number; z: number }[];
  /** CI12: the ground each whirlwind stands on (its drawn and hit y): the page's terrainHeight, or a native host's sampler */
  private readonly ground: (x: number, z: number) => number;
  constructor(input: ArenaWhirlsRows, program: ReturnProgram, gateProgram: ReturnProgram, private readonly nativeScope: Scope,
    ground: (x: number, z: number) => number = heightAt) {
    this.ground = ground;
    this.live(); ArenaWhirls.preflight(input); const gate = input.gate;
    this.gate = new ProjectedState({ ...gate.law, signals: { step: gate.law.signal, arm: gate.arm }, signal: 'step', outputs: Object.keys(gate.law.retain) }, gateProgram);
    this.rows = input; this.drawn = input.laws.map(() => ({ k: 0, shown: 0, x: 0, y: 0, z: 0 }));
    this.laws = input.laws.map(row => new ProjectedState(row, program));
  }
  live(): void { if (this.nativeScope.disposed || this.nativeScope.disposing) throw new Error('Whirlwind native owner has ended'); }
  /** Admit all gate references before the caller allocates native resources. */
  static preflight(rows: ArenaWhirlsRows, program?: ReturnType<typeof ReturnProgram.projectionBindings>): void {
    const view = rows.view, fields = view.slots.flatMap(slot => Object.values(slot.fields)), objects = view.slots.map(slot => slot.object);
    if (view.slots.length !== rows.laws.length || new Set(fields).size !== fields.length || new Set(objects).size !== objects.length) throw new Error('Conflicting whirlwind view binding');
    const gate = rows.gate, targets = Object.values(gate.law.retain), slots = gate.slots.flatMap(slot => [slot.weight, slot.armed, slot.shown]), inputs = Object.values(gate.inputs);
    if (gate.slots.length !== rows.laws.length || gate.law.parameters[gate.inputs.count] !== gate.slots.length || new Set(targets).size !== targets.length || new Set(slots).size !== slots.length || slots.some(slot => !targets.includes(slot)) || new Set(inputs).size !== inputs.length) throw new Error('Conflicting whirlwind gate binding');
    if (program !== undefined && [...inputs, ...Object.keys(gate.law.initial), ...Object.keys(gate.law.parameters)].some(name => !Object.values(program.script.fields).includes(name))) throw new Error('Missing whirlwind gate input');
    ProjectedState.preflight({ ...gate.law, signals: { step: gate.law.signal, arm: gate.arm }, signal: 'step', outputs: Object.keys(gate.law.retain) }, program);
  }
  /** Which whirlwinds blow (bit i: whirlwind i), at the original arm slot. */
  arm(mask: number): void { this.live(); this.gate.event('arm', { [this.rows.gate.inputs.mask]: mask | 0 }); }
  /** CI12: the whirlwinds' continuation as data, for a native checkpoint. */
  snapshot(): ArenaWhirlsSnapshot { return { gate: this.gate.snapshot(), laws: this.laws.map(law => law.snapshot()), drawn: this.drawn.map(d => ({ ...d })) }; }
  /** Continue from `saved` (a snapshot of whirlwinds of these rows). */
  restore(saved: ArenaWhirlsSnapshot): void {
    this.live();
    if (saved.laws.length !== this.laws.length || saved.drawn.length !== this.drawn.length
      || saved.drawn.some(d => [d.k, d.shown, d.x, d.y, d.z].some(value => !Number.isFinite(value)))) throw new Error('Invalid whirlwind snapshot');
    this.gate.restore(saved.gate); this.laws.forEach((law, i) => { const row = saved.laws[i]; if (row === undefined) throw new Error('Missing whirlwind law snapshot'); law.restore(row); });
    this.drawn.forEach((d, i) => { const row = saved.drawn[i]; if (row === undefined) throw new Error('Missing whirlwind draw snapshot'); Object.assign(d, row); });
  }
  /** Disarm them all and show none. */
  reset(): void { this.arm(0); for (const d of this.drawn) d.shown = 0; }
  /** Ease and gate them and step the shown ones' laws on a decision tick (`thinkDt` > 0) with `frame` (wx, wz, px, pz);
   *  `drawn` then holds what to draw. The whirlwinds that touch the player this tick, where they stand. */
  update(dt: number, t: number, live: boolean, thinkDt: number, frame: WhirlFrame): readonly WhirlHit[] {
    this.live(); const rows = this.rows, shared = this.laws[0];
    let hit = 0;
    for (let i = 0; i < this.laws.length; i++) {
      const law = this.laws[i], drawn = this.drawn[i], slot = rows.gate.slots[i]; if (law === undefined || drawn === undefined || slot === undefined) continue;
      const inputs = rows.gate.inputs; this.gate.project({ [inputs.delta]: dt, [inputs.live]: Number(live), [inputs.ease]: rows.ease, [inputs.index]: i });
      const shown = this.gate.value(slot.shown) === 1; drawn.k = this.gate.value(slot.weight); drawn.shown = Number(shown);
      if (!shown) continue;
      let hurt = false;
      if (thinkDt > 0) {
        const result = law.project({ dt: thinkDt, t, index: i, wx: frame.wx, wz: frame.wz, cd: shared?.value('cd') ?? 0, hit: Number(i === 0), px: frame.px, pz: frame.pz, open: Number(live) });
        if (result['broke'] === 1) shared?.set({ cd: result['cd'] ?? 0 });
        hurt = result['hurt'] === 1;
      }
      const x = law.value('x'), z = law.value('z'), y = this.ground(x, z);
      drawn.x = x; drawn.y = y; drawn.z = z;
      if (hurt) { const at = this.hits[hit] ?? { x: 0, y: 0, z: 0 }; at.x = x; at.y = y; at.z = z; this.hits[hit++] = at; }
    }
    this.hits.length = hit; this.live();
    return this.hits;
  }
}

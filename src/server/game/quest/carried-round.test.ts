import { expect, test } from 'vitest';
import { carriedRound, carriedRoundCarrying, carriedRoundDue, carriedRoundFrame, carriedRoundGoal, carriedRoundHome, carriedRoundOutputs } from '../../../shared/game/quest/carriedRound';

// The kokpar shape (carriedQuest.ts): carry poses 2 and 3, the goal pose 3 (a delivery also takes the carry pose first)
const rows = {
  state: { carrying: 0, left: 0, slow: 0, cheer: 0, warned: 0 }, home: { x: -40, z: 25 }, step: 0.1,
  fields: { dt: 'dt', playerX: 'playerX', playerZ: 'playerZ', objectX: 'goatX', objectZ: 'goatZ', mounted: 'mounted', carrier: 'horse', fast: 'fast',
    practice: 'practice', carrierX: 'horseX', carrierZ: 'horseZ' },
  outputs: { carrying: 'carrying', warning: 'warning', pose: 'pose', goal: 'goal', event: 'event' },
  poses: { reset: 1, carry: [2, 3], goal: 3, home: { height: 0.16, rotation: [0, 0.7, 1.3] as [number, number, number] },
    attached: { out: 0.62, height: 1.02, yaw: 1.57, roll: 0.35 }, delivered: { height: 0.9, rotation: [0, 0.3, 1.37] as [number, number, number] } },
  goals: [{ x: -80, z: 10 }, { x: 0, z: 40 }],
};

interface World { readonly px: number; readonly pz: number; readonly mounted: number; readonly carrier: number; readonly fast: number; readonly practice: number; readonly cx: number; readonly cz: number }
/** carriedProp.ts's round as it was inline before the kernel (decisions recorded instead of the page's effects) */
class Inline {
  state: Record<string, number> = { ...rows.state }; at = { ...rows.home }; pending = 0; log: string[] = [];
  update(dt: number, world: World, project: (frame: Record<string, number>) => Record<string, number>): void {
    this.pending += dt;
    if (this.pending >= rows.step) { const elapsed = this.pending; this.pending = 0; this.project(elapsed, world, project); }
    else if ((this.state[rows.outputs.carrying] ?? 0) !== 0) this.log.push('carry');
  }
  private project(dt: number, w: World, project: (frame: Record<string, number>) => Record<string, number>): void {
    const fields = rows.fields;
    const out = project({ ...this.state, [fields.dt]: dt, [fields.playerX]: w.px, [fields.playerZ]: w.pz, [fields.objectX]: this.at.x, [fields.objectZ]: this.at.z,
      [fields.mounted]: Number(w.mounted === 1), [fields.carrier]: Number(w.carrier === 1), [fields.fast]: Number(w.fast === 1), [fields.practice]: Number(w.practice === 1),
      [fields.carrierX]: w.cx, [fields.carrierZ]: w.cz });
    for (const key of Object.keys(this.state)) { const value = out[key]; if (value === undefined) throw new Error('Missing carried quest continuation'); this.state[key] = value; }
    if (out[rows.outputs.warning] === 1) this.log.push('warning');
    const pose = out[rows.outputs.pose];
    if (pose === rows.poses.reset) { this.at.x = rows.home.x; this.at.z = rows.home.z; this.log.push('reset'); }
    else if (pose !== undefined && rows.poses.carry.includes(pose)) this.log.push('carry');
    const event = out[rows.outputs.event];
    if (event !== undefined && event > 0) this.log.push(`event ${String(event)}`);
    if (pose === rows.poses.goal) {
      const goal = rows.goals[out[rows.outputs.goal] ?? -1]; if (goal === undefined) throw new Error('Missing carried quest goal');
      this.at.x = goal.x; this.at.z = goal.z; this.log.push(`goal ${String(goal.x)},${String(goal.z)}`);
    }
  }
}

test('the carried round kernel projects, decides and delivers exactly as the inline round did', () => {
  let seed = 11;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const a = new Inline(), b = carriedRound(rows), log: string[] = [], frames: [Record<string, number>, Record<string, number>][] = [];
  for (let frame = 0; frame < 3000; frame++) {
    const dt = rnd() < 0.05 ? 0.3 : 1 / 30;
    const world: World = { px: rnd() * 100 - 50, pz: rnd() * 100 - 50, mounted: Number(rnd() < 0.8), carrier: Number(rnd() < 0.9), fast: Number(rnd() < 0.5),
      practice: Number(rnd() < 0.1), cx: rnd() * 10, cz: rnd() * 10 };
    // one set of guest outputs per frame, shared by both (a goal step, a reset, a carry, a warning, events incl. NaN)
    const out: Record<string, number> = { carrying: Number(rnd() < 0.4), left: rnd() * 45, slow: rnd(), cheer: rnd() * 4, warned: Number(rnd() < 0.2),
      warning: Number(rnd() < 0.1), pose: Math.floor(rnd() * 5), goal: Math.floor(rnd() * 2), event: rnd() < 0.05 ? Number.NaN : Math.floor(rnd() * 9) - 1 };
    const pair: [Record<string, number>, Record<string, number>] = [{}, {}];
    a.update(dt, world, f => { pair[0] = f; return out; });
    const elapsed = carriedRoundDue(rows, b, dt);
    if (elapsed !== null) {
      pair[1] = carriedRoundFrame(rows, b, elapsed, { playerX: world.px, playerZ: world.pz, mounted: world.mounted === 1, carrier: world.carrier === 1, fast: world.fast === 1,
        practice: world.practice === 1, carrierX: world.cx, carrierZ: world.cz });
      const step = carriedRoundOutputs(rows, b, out);
      if (step.warning) log.push('warning');
      if (step.reset) { carriedRoundHome(rows, b); log.push('reset'); } else if (step.carry) log.push('carry');
      if (step.event > 0) log.push(`event ${String(step.event)}`);
      const goal = carriedRoundGoal(rows, b, out); if (goal !== null) log.push(`goal ${String(goal.x)},${String(goal.z)}`);
    } else if (carriedRoundCarrying(rows, b)) log.push('carry');
    frames.push(pair);
    expect(b.state).toEqual(a.state); expect(b.at).toEqual(a.at); expect(b.pending).toBe(a.pending);
  }
  expect(log).toEqual(a.log);
  for (const [x, y] of frames) expect(Object.entries(y)).toEqual(Object.entries(x));
  expect(a.log.filter(line => line.startsWith('goal')).length).toBeGreaterThan(20);
});

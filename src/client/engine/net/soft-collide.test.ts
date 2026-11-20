// QA-FEEDBACK-2026-11-19 row 54: two players can't walk through each other, push apart without jitter, never off a pier, and
// can't hold each other in a narrow gap (softCollide.ts). A small walker stands in for the motion law: its velocity approaches
// the bent stick × the 4.3 m/s walk at the ground's 14 /s, as `walkVelocity` does, and a wall is a clamp on x.
import { beforeEach, describe, expect, it } from 'vitest';
import { blockAt, CONTACT, LEAK, PUSH_MAX, pushAt, SoftCollide, stickToWorld, worldToStick, YIELD_AFTER, type SoftBody } from './softCollide';

const WALK = 4.3, ACCEL = 14, STEP = 1 / 60, dry = (): boolean => false;

interface Walker { x: number; z: number; vx: number; vz: number; readonly soft: SoftCollide; readonly key: number; wall?: (w: Walker) => void }
const walker = (key: number, x: number, z = 0): Walker => ({ key, x, z, vx: 0, vz: 0, soft: new SoftCollide() });
/** Every frame's bodies, so a page can draw them late. */
const history: SoftBody[][] = [];
const body = (w: Walker): SoftBody => ({ key: w.key, x: w.x, y: 0, z: w.z });

/** One frame for every walker: each reads the others where they were drawn (`lag` frames back, as a page's interpolation draws
 *  them, and led by that much), then steps its asked move, bent. */
function tick(walkers: readonly Walker[], asks: readonly { x: number; z: number }[], deep: (x: number, z: number) => boolean = dry, lag = 0, lead = lag * STEP): void {
  const now = walkers.map(body);
  history.push(now);
  if (history.length > 64) history.shift();
  const seen = history[Math.max(0, history.length - 1 - lag)] ?? now;
  walkers.forEach((w, i) => {
    w.soft.frame({ x: w.x, y: 0, z: w.z, vx: w.vx, vz: w.vz, deep }, seen.filter((_, j) => j !== i), STEP, true, lead);
    const move = w.soft.steer(asks[i] ?? { x: 0, z: 0 }, { x: 0, z: 0 });
    w.vx += (move.x * WALK - w.vx) * Math.min(1, ACCEL * STEP); w.vz += (move.z * WALK - w.vz) * Math.min(1, ACCEL * STEP);
    w.x += w.vx * STEP; w.z += w.vz * STEP;
    w.wall?.(w);
  });
}
const gap = (a: Walker, b: Walker): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('soft collision between players (QA 2026-11-19 row 54)', () => {
  beforeEach(() => { history.length = 0; });
  it('leaves a move alone with nobody near, and sends the stick as asked', () => {
    const soft = new SoftCollide();
    soft.frame({ x: 0, y: 0, z: 0, vx: 0, vz: 0, deep: dry }, [{ key: 1, x: 5, y: 0, z: 0 }], STEP);
    expect(soft.idle).toBe(true);
    expect(soft.bend(0.3, 1, 0.7)).toBeNull();
  });

  it('turns the stick into the world and back along the yaw, as Player.stepCommand does', () => {
    for (const yaw of [0, 0.9, -2.4, Math.PI]) {
      const back = worldToStick(stickToWorld(0.4, -0.7, yaw, { x: 0, z: 0 }), yaw);
      expect(back.str).toBeCloseTo(0.4, 9); expect(back.fwd).toBeCloseTo(-0.7, 9);
    }
    const ahead = stickToWorld(0, 1, 0, { x: 0, z: 0 }); // yaw 0 looks down -z
    expect(ahead.z).toBeCloseTo(-1, 9);
  });

  it('fades the move into a body from 1.26 m and holds it at contact; a push only under contact', () => {
    expect(blockAt(CONTACT + 0.6)).toBe(0);
    expect(blockAt(CONTACT + 0.25)).toBeGreaterThan(0.3);
    expect(blockAt(CONTACT)).toBeCloseTo(1 - LEAK, 9);
    expect(blockAt(CONTACT - 0.2)).toBeCloseTo(1, 9);
    expect(pushAt(CONTACT)).toBe(0);
    expect(pushAt(CONTACT - 0.3)).toBe(PUSH_MAX);
  });

  it('a player walking straight into one who stands still stops at them, not through them', () => {
    const a = walker(1, -3), b = walker(2, 0);
    let closest = Infinity;
    for (let i = 0; i < 60; i++) { tick([a, b], [{ x: 1, z: 0 }, { x: 0, z: 0 }]); closest = Math.min(closest, gap(a, b)); }
    expect(a.x).toBeLessThan(b.x);
    expect(closest).toBeGreaterThan(CONTACT - 0.2);
  });

  it('pressing in shoves a free player along slowly instead of passing them', () => {
    const a = walker(1, -1), b = walker(2, 0);
    for (let i = 0; i < 120; i++) tick([a, b], [{ x: 1, z: 0 }, { x: 0, z: 0 }]);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeGreaterThan(0.3); // b was shoved
    expect(gap(a, b)).toBeGreaterThan(CONTACT - 0.2);
  });

  it('two players on one spot ease apart to contact with no back and forth', () => {
    const a = walker(1, 0.1), b = walker(2, -0.1);
    const gaps: number[] = [], pushes: number[] = [];
    for (let i = 0; i < 90; i++) { tick([a, b], [{ x: 0, z: 0 }, { x: 0, z: 0 }]); gaps.push(gap(a, b)); pushes.push(a.soft.report.push); }
    expect(pushes[0]).toBeLessThan(PUSH_MAX * 0.3); // eased in, not snapped on
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual((gaps[i - 1] ?? 0) - 1e-9); // never closes again
    expect(gaps.at(-1)).toBeGreaterThan(CONTACT - 0.05);
    expect(gaps.at(-1)).toBeLessThan(CONTACT + 0.15); // and settles there, not flung away
    // and a pair dead on top of each other parts too
    const c = walker(3, 0), d = walker(4, 0);
    for (let i = 0; i < 90; i++) tick([c, d], [{ x: 0, z: 0 }, { x: 0, z: 0 }]);
    expect(gap(c, d)).toBeGreaterThan(CONTACT - 0.05);
  });

  it('on open ground a walk into someone a little off centre slides round them, never through', () => {
    const a = walker(1, -3, 0.05), b = walker(2, 0);
    let closest = Infinity;
    for (let i = 0; i < 3 * 60; i++) { tick([a, b], [{ x: 1, z: 0 }, { x: 0, z: 0 }]); closest = Math.min(closest, gap(a, b)); }
    expect(a.x).toBeGreaterThan(b.x + 1); // round him and on
    expect(closest).toBeGreaterThan(CONTACT - 0.2);
    expect(a.soft.report.passing).toBe(0); // by sliding, not by a pass
  });

  it('walking past someone sideways is not slowed', () => {
    const a = walker(1, -3, CONTACT + 0.02), b = walker(2, 0);
    for (let i = 0; i < 90; i++) tick([a, b], [{ x: 1, z: 0 }, { x: 0, z: 0 }]);
    expect(a.x).toBeGreaterThan(2);
  });

  it('never pushes a player off a pier: a push toward deep water is dropped', () => {
    // b stands at the end of a pier (deep past x = 0.3); a walks out to it
    const a = walker(1, -3), b = walker(2, 0), deep = (x: number): boolean => x > 0.3;
    for (let i = 0; i < 180; i++) tick([a, b], [{ x: 1, z: 0 }, { x: 0, z: 0 }], deep);
    expect(b.x).toBeLessThan(0.3);
    expect(b.soft.report.probed).toBeGreaterThan(0);
  });

  it('a dodge is never bent', () => {
    const soft = new SoftCollide();
    soft.frame({ x: 0, y: 0, z: 0, vx: 0, vz: 0, deep: dry }, [{ key: 1, x: 0, y: 0, z: -0.5 }], STEP);
    expect(soft.bend(0, 1, 0)).not.toBeNull(); // the walk into them is bent; Player.bent skips the bend on a dodge press
  });

  it('bodies far apart in height do not meet', () => {
    const soft = new SoftCollide();
    soft.frame({ x: 0, y: 0, z: 0, vx: 0, vz: 0, deep: dry }, [{ key: 1, x: 0.1, y: 2.5, z: 0 }], STEP);
    expect(soft.idle).toBe(true);
  });

  it('one player cannot hold another in a 1.5 m gap: the one stuck pressing passes after a beat', () => {
    // a 1.5 m wide dead end along z (walls at z = ±0.75 hold both, less their radius); b is inside it at x = 0, a holds its mouth
    // at x = 0.8 and keeps pressing in; b presses out
    const hold = (w: Walker): void => { w.z = Math.max(-0.75 + 0.38, Math.min(0.75 - 0.38, w.z)); if (w.x < -1) { w.x = -1; w.vx = Math.max(0, w.vx); } };
    const a = walker(1, 0.8, 0.05), b = walker(2, 0, -0.05);
    a.wall = hold; b.wall = hold;
    let out = -1;
    for (let i = 0; i < 6 * 60 && out < 0; i++) { tick([a, b], [{ x: -1, z: 0 }, { x: 1, z: 0 }]); if (b.x > a.x + CONTACT) out = i * STEP; }
    expect(out).toBeGreaterThan(0.3); // they did collide first
    expect(out).toBeLessThan(YIELD_AFTER + 1.5); // and b got out
  });

  it('two players walking head-on in a 1.5 m gap meet even when each draws the other 150 ms late, and neither holds the other', () => {
    // walls at z = ±0.75 keep their centres within 0.37 m of the line, so neither walks round the other as on open ground
    const a = walker(1, -3, 0.02), b = walker(2, 3, -0.02), lag = 9, hold = (w: Walker): void => { w.z = Math.max(-0.37, Math.min(0.37, w.z)); };
    a.wall = hold; b.wall = hold;
    const gaps: number[] = [];
    let metAt = -1, passedAt = -1;
    for (let i = 0; i < 6 * 60 && passedAt < 0; i++) {
      tick([a, b], [{ x: 1, z: 0 }, { x: -1, z: 0 }], dry, lag);
      if (a.soft.report.passing + b.soft.report.passing === 0) gaps.push(gap(a, b));
      if (metAt < 0 && gap(a, b) < CONTACT + 0.1) metAt = i * STEP;
      if (a.x > b.x + CONTACT) passedAt = i * STEP;
    }
    expect(Math.min(...gaps)).toBeGreaterThan(0.38); // never deeper than one body radius, but for a pass
    expect(metAt).toBeGreaterThan(0);
    expect(passedAt).toBeGreaterThan(metAt);
    expect(passedAt - metAt).toBeLessThan(YIELD_AFTER + 1.5);
  });

  it('head-on on open ground on staging: drawn 250 ms late and led 300 ms, the two never meet closer than 0.35 m', () => {
    // QA 11-19 row 54 on staging v0.1.53: two WebKit phones met head-on and passed 0.085 m apart 0.25 s after contact, neither
    // pressing long enough to pass. Each page drew the other late; the late row of a player who had already stopped was led on
    // through the stopped one, so the way to it flipped and the walk went on. Each keeps to its line, as the proof's strafe does.
    const a = walker(1, -3, 0.02), b = walker(2, 3, -0.02), lag = 15, lead = 0.3;
    let closest = Infinity, passed = false;
    for (let i = 0; i < 4 * 60; i++) {
      tick([a, b], [{ x: 1, z: -a.z * 2 }, { x: -1, z: -b.z * 2 }], dry, lag, lead);
      if (a.soft.report.passing + b.soft.report.passing === 0 && !passed) closest = Math.min(closest, gap(a, b));
      if (a.x > b.x) passed = true;
    }
    expect(closest).toBeGreaterThan(0.35); // about a body radius (0.38 m), never through, but for a pass
  });

  it('a body walked past is led by its drawn velocity, so a late row is met where it is', () => {
    const soft = new SoftCollide(), self = { x: 0, y: 0, z: 0, vx: 0, vz: 0, deep: dry };
    // it walks toward this player at 4 m/s, drawn 0.15 s late: drawn at 1.4 m, really at 0.8 m
    for (let i = 0; i < 30; i++) soft.frame(self, [{ key: 7, x: 3.4 - 4 * i * STEP, y: 0, z: 0 }], STEP, true, 0.15);
    expect(soft.report.nearest).toBeLessThan(1.5 - 0.5);
  });

  it('collides again once a pass is done', () => {
    const a = walker(1, 0.4), b = walker(2, 0);
    for (let i = 0; i < 5 * 60; i++) tick([a, b], [{ x: -1, z: 0 }, { x: 1, z: 0 }]); // they pass and part
    expect(a.x).toBeLessThan(b.x);
    expect(a.soft.report.passing + b.soft.report.passing).toBe(0);
  });
});

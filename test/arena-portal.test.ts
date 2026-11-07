// CI12 Nalati chapter: the arena room portal's decisions, split out of ArenaRoomPortal (ArenaPortalLaw, renderer-free), decide
// exactly as the portal's inline update did: the same program inputs at the same frames, the same entries, exits, slows
// and fades, over a walk up to the door, through the corridor and chamber, a fight and both kinds of exit.
import { expect, test } from 'vitest';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { ArenaPortalLaw, type ArenaPortalFrame } from '../src/shared/game/boss/arenaPortal';
import { titanPrograms as titan } from './fixtures/titanInlineWitness';

const rows = { signal: 'kingDoor', end: 12, fade: { hold: .2 } };
const entrance = { x: 200, y: 2, z: 200, facing: 0 };

/** a program that records what it was asked, answering as the admitted one does */
function recording(): { program: Pick<ReturnProgram, 'project'>; asked: string[] } {
  const real = ReturnProgram.page(titan.rules), asked: string[] = [];
  return { asked, program: { project: (signal, observations) => { asked.push(`${signal} ${JSON.stringify(observations)}`); return real.project(signal, observations); } } };
}

/** ArenaRoomPortal's update and its enter / leave state before the split (arenaRoom.ts, before CI12), without the scene */
class Inline {
  inside = false; slow = false; private elapsed = 0; private fade = -1; private pending: 'enter' | 'exit' | null = null;
  readonly log: string[] = [];
  constructor(private readonly program: Pick<ReturnProgram, 'project'>) {}
  enter(immediate = false): void { if (!immediate) { this.fade = rows.fade.hold; this.pending = 'enter'; return; } this.inside = true; this.log.push('enter'); }
  leave(teleport: boolean, immediate = false): void { if (teleport && !immediate) { this.fade = rows.fade.hold; this.pending = 'exit'; return; } this.inside = false; this.slow = false; this.log.push(`leave ${String(teleport)}`); }
  update(dt: number, o: ArenaPortalFrame): void {
    if (this.fade >= 0) {
      this.fade -= dt;
      if (this.fade < 0) { const pending = this.pending; this.pending = null; if (pending === 'enter') this.enter(true); else if (pending === 'exit') this.leave(true, true); this.log.push('faded'); }
      return;
    }
    this.elapsed += dt;
    if (this.elapsed >= .1 - 1e-9) {
      const e = entrance, z = o.pz - o.originZ, floor = o.floor;
      const result = this.program.project(rows.signal, { px: o.px, pz: o.pz, y: o.py, ex: e.x, ey: e.y, ez: e.z, facing: e.facing,
        volume: Number(o.volume), inside: Number(this.inside), corridor: z, land: rows.end, engaged: Number(o.engaged), sand: o.sand, floor: floor ?? o.originY, cy: o.originY });
      this.elapsed = 0;
      if (!this.inside) { if (result['enter'] === 1) this.enter(); }
      else if (result['exit'] !== 0) { this.leave(result['exit'] === 2); return; }
      if (this.inside) this.slow = result['slow'] === 1;
    }
  }
}

/** the new portal's update over the law (arenaRoom.ts, after CI12), without the scene */
class Split {
  slow = false; readonly log: string[] = [];
  readonly law: ArenaPortalLaw;
  constructor(program: Pick<ReturnProgram, 'project'>) { this.law = new ArenaPortalLaw(program, rows, entrance); }
  enter(immediate = false): void { if (!immediate) { this.law.begin('enter', rows.fade.hold); return; } this.law.inside = true; this.log.push('enter'); }
  leave(teleport: boolean, immediate = false): void { if (teleport && !immediate) { this.law.begin('exit', rows.fade.hold); return; } this.law.inside = false; this.slow = false; this.log.push(`leave ${String(teleport)}`); }
  update(dt: number, o: ArenaPortalFrame): void {
    const step = this.law.step(dt, () => o);
    if (step.kind === 'fading') return;
    if (step.kind === 'faded') { if (step.pending === 'enter') this.enter(true); else if (step.pending === 'exit') this.leave(true, true); this.log.push('faded'); return; }
    if (step.kind === 'decided') {
      if (!this.law.inside) { if (step.enter) this.enter(); }
      else if (step.exit !== 0) { this.leave(step.exit === 2); return; }
      if (this.law.inside) this.slow = step.slow;
    }
  }
}

test('the portal law decides as the inline portal did, frame by frame', () => {
  const a = recording(), b = recording(), old = new Inline(a.program), split = new Split(b.program);
  let t = 0;
  for (let f = 0; f < 1200; f++) {
    const dt = f % 29 === 0 ? .13 : 1 / 30; t += dt;
    // walk to the door, into the volume, down the corridor and the chamber, fight, then out (a walk-out and a teleport)
    const phase = Math.floor(f / 200), along = (f % 200) / 200;
    const pz = [212 - along * 12, 200 + along * 14, 40 + along * 12, 49, 52 - along * 20, 212][phase] ?? 212;
    const frame: ArenaPortalFrame = { px: phase < 2 ? 200 : 30, py: phase < 2 ? 2 : 20 - (f % 7) * .01, pz, floor: phase >= 2 && phase < 5 ? 20 : undefined,
      volume: phase === 1 || (phase >= 2 && phase < 5), engaged: phase === 3, sand: phase === 3 ? .5 + .4 * Math.sin(t) : 0, originY: 20, originZ: 40 };
    if (f === 900) { old.leave(true); split.leave(true); }
    old.update(dt, frame); split.update(dt, frame);
    expect(split.law.inside).toBe(old.inside); expect(split.slow).toBe(old.slow);
  }
  expect(b.asked).toEqual(a.asked); expect(split.log).toEqual(old.log);
  // the walk reached the decisions it compares: asked at 10 Hz, and at least one entry and one exit
  expect(a.asked.length).toBeGreaterThan(300);
  expect(old.log).toContain('enter'); expect(old.log.some(e => e.startsWith('leave'))).toBe(true);
});

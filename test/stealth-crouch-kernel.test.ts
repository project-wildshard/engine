import { afterEach, beforeEach, expect, it } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { lendNalatiHeld } from './fixtures/nalati-return-modules';
import { StealthCrouch, StealthDetection, type StealthObservation, type StealthPose } from '../src/shared/game/stealth/stealthLaw';
import { originalHeldMetadata } from './fixtures/nalati-held-original';
import { parse } from 'valibot';
import { StealthRowsSchema } from '@wildshard/format/stealth';

// CI12: the renderer-free crouch kernel equals the page controller's original crouch, toggle, shot and hint logic
// (copied below from controller.ts as it stood before the kernel), step for step, and a restored kernel continues it.
const rows = parse(StealthRowsSchema, originalHeldMetadata().stealth);
let scope: Scope;
beforeEach(() => { scope = new Scope('stealth-crouch'); lendNalatiHeld(scope); });
afterEach(() => { scope.dispose(); });

class Original {
  readonly law: StealthDetection; state: string; cover = 0; threat = 0; inLongGrass = false; canCrouch = false; latched = false;
  toggleWas = false; pendingToggle = false; pendingCancel = false; shotUntil = -1; t = 0; threatX = 0; threatZ = 0; hinted = false;
  observation: StealthObservation = { grass: 0, mounted: false, forced: false, threats: [] };
  constructor() { this.law = new StealthDetection(rows.program, scope); this.state = rows.states[0] ?? 'none'; }
  crouchStep(dt: number, p: StealthPose): void {
    const o = this.observation, sprint = p.sprint, jump = p.jump;
    this.pendingCancel ||= sprint || jump;
    const stepped = this.law.step(dt, { ...rows.tuning, grass: o.grass, forced: Number(o.forced), blocked: Number(p.hover || p.swimming || o.mounted || p.practice), practice: Number(p.practice), crouched: Number(p.crouching), px: p.x, pz: p.z, sprint: Number(sprint), jump: Number(this.pendingCancel), toggle: Number(this.pendingToggle) }, o.threats);
    if (!stepped) return; this.pendingToggle = false; this.pendingCancel = false;
    const v = this.law.state; this.inLongGrass = v['inLong'] === 1; this.canCrouch = v['can'] === 1; this.latched = v['latched'] === 1;
    this.cover = v['cover'] ?? 0; this.threat = v['threat'] ?? 0; this.threatX = v['x'] ?? 0; this.threatZ = v['z'] ?? 0;
    const state = rows.states[v['state'] ?? 0]; if (state === undefined) throw new Error('Undeclared stealth state'); this.state = state;
  }
  answerCrouch(request: { want: boolean; via: 'toggle' | 'hold' }): { allowed: boolean; latched: boolean } {
    if (request.via === 'toggle') { if (request.want && !this.toggleWas) this.pendingToggle = !this.pendingToggle; this.toggleWas = request.want; }
    return { allowed: request.via === 'hold' && this.canCrouch, latched: this.latched };
  }
  noteShot(): void { this.shotUntil = this.state === rows.sneak.state ? this.t + rows.sneak.seconds : -1; }
  sneakMultiplier(): number { return this.t < this.shotUntil ? rows.sneak.multiplier : 1; }
  hint(): boolean { const avail = this.canCrouch || this.latched; if (avail && !this.hinted) { this.hinted = true; return true; } return false; }
}

interface Frame { dt: number; pose: StealthPose; observation: StealthObservation; press: boolean; toggle?: boolean; hold?: boolean; shot: boolean }
function script(): Frame[] {
  let seed = 11; const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  return Array.from({ length: 400 }, (_v, i) => {
    const threats = rnd() < 0.4 ? [] : Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({ x: rnd() * 60 - 30, z: rnd() * 60 - 30, awareness: rnd(), alert: 0.35, hunting: Number(rnd() < 0.3) }));
    return { dt: 0.016 + rnd() * 0.05, press: rnd() < 0.04, shot: rnd() < 0.05,
      ...(rnd() < 0.08 ? { toggle: rnd() < 0.6 } : {}), ...(rnd() < 0.05 ? { hold: true } : {}),
      pose: { sprint: rnd() < 0.05, jump: rnd() < 0.04, hover: rnd() < 0.02, swimming: rnd() < 0.02, practice: false, crouching: Math.floor(i / 40) % 2 === 0, x: rnd() * 4, z: rnd() * 4 },
      observation: { grass: Math.floor(i / 60) % 3 === 0 ? 0.2 : 1, mounted: rnd() < 0.03, forced: rnd() < 0.02, threats } };
  });
}
function play(frames: readonly Frame[], original: Original, kernel: StealthCrouch, from = 0): number {
  let checked = 0, t = original.t;
  for (let i = from; i < frames.length; i++) {
    const f = frames[i]; if (f === undefined) throw new Error('frame');
    if (f.press) { original.pendingToggle = !original.pendingToggle; kernel.press(); }
    if (f.toggle !== undefined) expect(kernel.answer({ want: f.toggle, via: 'toggle' })).toEqual(original.answerCrouch({ want: f.toggle, via: 'toggle' }));
    if (f.hold === true) expect(kernel.answer({ want: true, via: 'hold' })).toEqual(original.answerCrouch({ want: true, via: 'hold' }));
    original.crouchStep(f.dt, f.pose); kernel.step(f.dt, f.pose);
    t += f.dt; original.t = t; original.observation = f.observation; kernel.observe(t, f.observation);
    if (f.shot) { original.noteShot(); kernel.noteShot(); }
    expect(kernel.takeHint()).toBe(original.hint());
    expect([kernel.state, kernel.cover, kernel.threat, kernel.inLongGrass, kernel.canCrouch, kernel.latched, kernel.threatX, kernel.threatZ, kernel.sneakMultiplier()])
      .toEqual([original.state, original.cover, original.threat, original.inLongGrass, original.canCrouch, original.latched, original.threatX, original.threatZ, original.sneakMultiplier()]);
    expect(kernel.law.state).toEqual(original.law.state);
    checked++;
  }
  return checked;
}

it('steps exactly as the page controller did, through toggles, holds, shots and threats', () => {
  const frames = script(), original = new Original(), kernel = new StealthCrouch(rows, scope);
  expect(play(frames, original, kernel)).toBe(400);
  // the script reaches every decision the kernel carries
  const states = new Set<string>(); const replay = new StealthCrouch(rows, scope); let latched = false;
  for (const f of frames) { if (f.press) replay.press(); replay.step(f.dt, f.pose); replay.observe(0, f.observation); states.add(replay.state); latched ||= replay.latched; }
  expect(states.size).toBeGreaterThan(2); expect(latched).toBe(true);
});

it('a kernel restored mid-run continues the original exactly', () => {
  const frames = script(), original = new Original(), first = new StealthCrouch(rows, scope);
  play(frames.slice(0, 200), original, first);
  const saved = structuredClone(first.snapshot()), restored = new StealthCrouch(rows, scope);
  restored.restore(saved);
  expect(restored.snapshot()).toEqual(first.snapshot());
  expect(play(frames, original, restored, 200)).toBe(200);
});

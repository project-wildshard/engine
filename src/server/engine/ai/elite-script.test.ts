import { expect, test } from 'vitest';
import { EliteReadiness, eliteDamageScale, eliteScriptFrame, type EliteProjection, type EliteScriptFight } from '../../../shared/engine/ai/eliteScript';

const row = { mode: 'script' as const, ready: 'ready', step: 'step', damage: 'damage',
  cues: { roar: { signature: true, voice: 'qara.roar' }, call: { feed: 'Riders!' }, quiet: {} } };
interface Bank { readonly id: number }
interface Event { readonly kind: string; readonly [field: string]: unknown }
const cues: Readonly<Record<string, { readonly signature?: boolean; readonly voice?: string; readonly feed?: string }>> = row.cues;

/** A deterministic stand-in for the paged charge program: its frame turns the elite (so a hit's knock reads the turned
 *  facing) and leaves hits, cues, retirements and page banks; its strikes cycle through their phases. */
function fight(seed: number, body: { yaw: number }): EliteScriptFight<{ x: number; z: number }, Bank> & { frames: string[] } {
  let s = seed, effects: ReturnType<EliteScriptFight<unknown, Bank>['drainEffects']>[number][] = [], tick = 0;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const frames: string[] = [];
  return { frames, adopt: () => undefined, interrupt: () => undefined, signal: () => undefined, cue: id => ['roar', 'call', 'quiet', 'unknown'][id] ?? 'unknown',
    state: () => ({ mode: tick % 3 }),
    frame: (point, night, observations) => {
      frames.push(JSON.stringify([point, night, observations])); body.yaw += rnd() - 0.5;
      effects = [];
      if (rnd() < 0.2) effects.push({ kind: 'hit', hit: { damage: Math.round(rnd() * 30) } });
      if (rnd() < 0.3) effects.push({ kind: 'cue', id: Math.floor(rnd() * 4) });
      if (rnd() < 0.1) effects.push({ kind: 'retire', id: 3 });
      if (rnd() < 0.1) effects.push({ kind: 'page-bank', bank: { id: tick } });
    },
    advanceFrame: () => { tick++; }, drainEffects: () => effects.splice(0),
    strikePresentation: () => tick % 5 === 0 ? [] : [{ phase: ['windup', 'active', 'recover'][tick % 3] ?? 'idle', x0: tick, z0: -tick, x1: tick * 2, z1: 1, width: 3 },
      ...(tick % 7 === 0 ? [{ phase: 'active', x0: 9, z0: 9, x1: 8, z1: 8, width: 2 }] : [])] };
}
const decisions: EliteProjection = { project: (signal, o) => signal === 'ready' ? { accept: Number((o['kills'] ?? 0) >= 5) }
  : signal === 'step' ? { count: (o['engaged'] ?? 0) === 1 && (o['line'] ?? 0) < 4 ? 2 : 0 } : { scale: 1 + (o['mode'] ?? 0) * 0.5 - (o['distance'] ?? 0) * 0.01 } };

/** BorrowedElite's script-mode readiness and tick as they were inline (events recorded as plain rows) */
function inline(dt: number, s: { elapsed: number; readyTime: number; initialized: boolean; eligible: boolean; view: Map<string, number> }, program: EliteScriptFight<{ x: number; z: number }, Bank>,
  body: { yaw: number }, o: { kills: number; engaged: boolean; leashing: boolean; phase2: boolean; time: number; line: number }, player: { x: number; z: number }, events: Event[]): void {
  s.readyTime += dt;
  if (!s.initialized || s.readyTime + 1e-9 >= .1) { s.initialized = true; s.readyTime = 0; s.eligible = decisions.project(row.ready, { kills: o.kills, engaged: 0, line: 0 })['accept'] === 1; }
  s.elapsed += dt;
  if (s.elapsed + 1e-9 >= .1) {
    s.elapsed = 0;
    const count = decisions.project(row.step, { kills: o.kills, engaged: Number(o.engaged), line: o.line })['count'] ?? 0;
    if (count > 0) events.push({ kind: 'support', count });
  }
  program.frame(player, 0, { engaged: Number(o.engaged), leashing: Number(o.leashing), phase2: Number(o.phase2), clock: o.time }); program.advanceFrame(dt);
  for (const effect of program.drainEffects()) {
    if (effect.kind === 'page-bank') events.push(effect);
    else if (effect.kind === 'hit') events.push({ kind: 'hit', amount: effect.hit.damage }, { kind: 'knock', x: Math.sin(body.yaw), z: Math.cos(body.yaw) });
    else if (effect.kind === 'cue') {
      const cue = cues[program.cue(effect.id)]; if (cue === undefined) continue;
      if (cue.signature === true) events.push({ kind: 'signature' });
      if (cue.voice !== undefined) events.push({ kind: 'sound', id: cue.voice });
      if (cue.feed !== undefined) events.push({ kind: 'feed', id: cue.feed });
    }
  }
  s.view.set('strike', 0);
  for (const strike of program.strikePresentation()) if (strike.phase === 'windup' || strike.phase === 'active') {
    s.view.set('strike', strike.phase === 'windup' ? 1 : 2); s.view.set('sx0', strike.x0); s.view.set('sz0', strike.z0); s.view.set('sx1', strike.x1); s.view.set('sz1', strike.z1); s.view.set('sw', strike.width);
  }
}

test('the elite script kernel steps, reads, knocks, cues and tells exactly as the inline borrowed elite did', () => {
  const ba = { yaw: 0.3 }, bb = { yaw: 0.3 }, fa = fight(5, ba), fb = fight(5, bb);
  const s = { elapsed: 0, readyTime: 0, initialized: false, eligible: false, view: new Map<string, number>() };
  const readiness = new EliteReadiness(), view = new Map<string, number>(), ea: Event[] = [], eb: Event[] = [];
  let elapsed = 0, seed = 3;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let frame = 0; frame < 1500; frame++) {
    const dt = rnd() < 0.05 ? 0.25 : 1 / 30, o = { kills: Math.floor(frame / 200), engaged: rnd() < 0.7, leashing: rnd() < 0.1, phase2: frame > 900, time: frame / 30, line: Math.floor(rnd() * 6) };
    const player = { x: rnd() * 20, z: rnd() * 20 };
    inline(dt, s, fa, ba, o, player, ea);
    readiness.observe(row, decisions, dt, o.kills);
    elapsed += dt;
    const step = eliteScriptFrame(row, decisions, fb, elapsed, dt, player, { ...o, yaw: () => bb.yaw });
    elapsed = step.elapsed;
    for (const effect of step.effects) {
      if (effect.kind === 'support' || effect.kind === 'page-bank') eb.push(effect);
      else if (effect.kind === 'hit') eb.push({ kind: 'hit', amount: effect.amount }, { kind: 'knock', x: effect.knockX, z: effect.knockZ });
      else { if (effect.signature) eb.push({ kind: 'signature' }); if (effect.voice !== undefined) eb.push({ kind: 'sound', id: effect.voice }); if (effect.feed !== undefined) eb.push({ kind: 'feed', id: effect.feed }); }
    }
    view.set('strike', step.tell?.strike ?? 0);
    if (step.tell !== null) { view.set('sx0', step.tell.x0); view.set('sz0', step.tell.z0); view.set('sx1', step.tell.x1); view.set('sz1', step.tell.z1); view.set('sw', step.tell.width); }
    expect(readiness.eligible).toBe(s.eligible); expect(elapsed).toBe(s.elapsed); expect([...view]).toEqual([...s.view]); expect(bb).toEqual(ba);
    expect(eliteDamageScale(row, decisions, frame % 3, frame * 0.1)).toBe(decisions.project(row.damage, { mode: frame % 3, distance: frame * 0.1 })['scale'] ?? 1);
  }
  expect(eb).toEqual(ea); expect(fb.frames).toEqual(fa.frames);
  expect(ea.filter(e => e.kind === 'knock').length).toBeGreaterThan(50);
  expect(ea.filter(e => e.kind === 'support').length).toBeGreaterThan(50);
});

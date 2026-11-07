import { expect, test } from 'vitest';
import { Bow } from '../src/client/engine/combat/view/Bow';
import { BowDraw, DEFAULT_BOW_DRAW } from '../src/shared/engine/combat/bowDraw';
import { RangedAction, stepActionClock, type RangedCycleEvent, type RangedCycleRow } from '../src/shared/engine/combat/Firearm';
import type { WeaponWire } from '../src/shared/engine/combat/Weapon';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { legacyDouble } from '../src/test/engine/FakeGame';

// P1-E6 COMBAT: on a link a ranged clock counts commands, so a round chambers and an arrow leaves on the command it does on the
// server, whatever the frames took. Frames here run at Low Power Mode's 2.47 steps a frame (J121).
const CYCLE: RangedCycleRow = { magazine: 4, reload: 0.5, reloadIn: 0.2, cycleDelay: 0.1, cycleTime: 0.4, ejectAt: 0.3, cockAt: 0.6 };
const framesOf = (seconds: number): number[] => {
  const out: number[] = []; let due = 0;
  for (let sent = 0; sent < seconds / FIXED_STEP;) { due += 2.47; const steps = Math.floor(due); due -= steps; out.push(steps); sent += steps; }
  return out;
};
const wire = (steps: () => number): Pick<WeaponWire, 'steps'> => ({ steps });

test('a rifle\'s action on a link stands where the server\'s does at every command, through a shot and a reload', () => {
  const page = new RangedAction.Cycle({ reserve: 8 }, CYCLE), server = new RangedAction.Cycle({ reserve: 8 }, CYCLE), seen: RangedCycleEvent[] = [], heard: RangedCycleEvent[] = [];
  page.dropHammer(); server.dropHammer();
  let steps = 0;
  const link = wire(() => steps);
  for (const frame of framesOf(5)) {
    steps = frame;
    stepActionClock(0.0411, link, seconds => { if (page.phase === 'idle') page.beginReload(); seen.push(...page.events(seconds, false)); });
    for (let at = 0; at < frame; at++) { if (server.phase === 'idle') server.beginReload(); heard.push(...server.events(FIXED_STEP, false)); }
    expect(page.phase).toBe(server.phase); expect(page.phaseT).toBe(server.phaseT); expect(page.tube).toBe(server.tube);
  }
  expect(seen).toEqual(heard);
  expect(seen).toContain('reloadEnd');
});

test('off a link the clock is the frame\'s, which is what one player has always had', () => {
  const taken: number[] = [];
  stepActionClock(0.04, null, seconds => { taken.push(seconds); });
  expect(taken).toEqual([0.04]);
});

test('a frame with no command moves nothing, so a page faster than the wire never runs ahead of it', () => {
  const taken: number[] = [];
  stepActionClock(0.008, wire(() => 0), seconds => { taken.push(seconds); });
  expect(taken).toEqual([]);
});

test('a bow on a link looses on the very command the server does, and names that command', () => {
  const server = new BowDraw(DEFAULT_BOW_DRAW), shots: number[] = [], holds: boolean[] = [];
  let steps = 0, seq = 100;
  const line = legacyDouble<WeaponWire>({ steps: () => steps, nextSeq: () => seq, hold: down => { holds.push(down); }, shot: at => { shots.push(at); } });
  const bow: unknown = Object.create(Bow.prototype);
  Object.assign(bow as object, { draw: new BowDraw(DEFAULT_BOW_DRAW), wire: line, drawSpeedScale: 1, mountDraw: 1, carried: true });
  const stepDraw = Reflect.get(Bow.prototype, 'stepDraw') as (dt: number, held: boolean, blocked: boolean) => { ev: unknown; shot: number };
  let sent = 100, loosed = -1, frame = 0, held = true;
  for (const count of framesOf(6)) {
    frame++;
    const hold = held; held = frame < 60; // the fingers lift; the page's next commands carry it
    steps = count; seq = (sent + count) & 0xffff;
    const out = stepDraw.call(bow, 0.0411, held, false);
    for (let at = 0; at < count; at++) { const event = server.step(FIXED_STEP, hold, false, 1); if (event === 'loose') loosed = sent + at; }
    sent += count;
    if (out.shot !== 0) expect(out.shot).toBe(loosed);
  }
  expect(shots).toEqual([loosed]);
  expect(holds).toContain(false);
});

import ironhide from '../../../src/shards/pine-hollow/behaviour/elites/ironhide.as?raw';
import { expect } from 'vitest';
import { elitePort } from '../script-v2-elite';

export const port = elitePort('ironhide',ironhide,h => {
  const start = h.run('start');expect(start.state).toMatchObject({ mode: 0,modeT: 0,wanderT: 0,again: 0 });
  const signal = h.run('signal',{ value: 1 });expect(h.has(signal,'strike','charge')).toBe(true);expect(signal.state['mode']).toBe(3);
  expect(h.run('signal',{ value: 2 }).commands).toEqual([]);
  for (const frame of [{ alive: false },{ target: 0 }]) expect(h.run('tick',frame).commands).toEqual([]);
  const home = h.run('tick',{ fields: { leashing: 1 },position: [(h.params['lairX'] ?? 0)+5,h.params['lairZ'] ?? 0],state: { again: 1 } });
  expect(home.state).toMatchObject({ mode: 1,again: 0 });expect(h.last(home,'field','speed')).toBe(4);expect(h.last(home,'field','lookWeight')).toBe(0);
  const wander = h.run('tick',{ fields: { engaged: 0 } });expect(wander.draws).toBe(3);expect(wander.state['wanderT']).toBe(9);expect(h.last(wander,'field','speed')).toBe(0);
  const charge = h.run('tick',{ state: { mode: 2,modeT: 1.4 },fields: { phase2: 1 } });
  expect(h.has(charge,'strike','chargePhase2')).toBe(true);expect(h.has(charge,'cue','signature')).toBe(true);expect(charge.state).toMatchObject({ mode: 3,again: 1 });expect(charge.draws).toBe(1);
  const edge = h.run('tick',{ state: { mode: 2,modeT: 1.4 },fields: { phase2: 1 },dt: 0 });expect(h.has(edge,'strike','chargePhase2')).toBe(false);
  const active = h.run('tick',{ state: charge.state,movingStrike: 2,fields: { strikeTime: 0 } });expect(h.has(active,'cue','squeal')).toBe(true);
  const again = h.run('tick',{ state: active.state });expect(h.has(again,'strike','again')).toBe(true);expect(again.state).toMatchObject({ mode: 3,again: 0 });
  expect(h.run('tick',{ state: again.state }).state['mode']).toBe(2);
  const single = h.run('tick',{ state: { mode: 2,modeT: 3 },fields: { phase2: 1 },random: [0.55] });expect(single.state['again']).toBe(0);
  expect(h.run('tick',{ state: { mode: 2,modeT: 3 },player: [(h.params['lairX'] ?? 0)+30,h.params['lairZ'] ?? 0] }).state['mode']).toBe(2);
});

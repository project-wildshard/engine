import blackpaw from '../../../src/shards/pine-hollow/behaviour/elites/blackpaw.as?raw';
import { expect } from 'vitest';
import { elitePort } from '../script-v2-elite';

export const port = elitePort('blackpaw',blackpaw,h => {
  const start = h.run('start');expect(start.state).toMatchObject({ mode: 2,roarCd: 0,swipeT: -1 });expect(h.last(start,'field','hidden')).toBe(1);expect(h.has(start,'move','relocate')).toBe(true);
  const roar = h.run('signal',{ value: 1,fields: { hidden: 1,phase2: 1 } });expect(h.has(roar,'cue','burst')).toBe(true);expect(h.has(roar,'cue','signature')).toBe(true);expect(h.has(roar,'strike','roarPhase2')).toBe(true);expect(roar.state['mode']).toBe(3);
  const signal = h.run('signal',{ value: 2,fields: { phase2: 1 } });expect(h.has(signal,'strike','chargePhase2')).toBe(true);expect(signal.state['mode']).toBe(4);
  for (const frame of [{ alive: false },{ target: 0 }]) expect(h.run('tick',frame).commands).toEqual([]);
  const home = h.run('tick',{ state: { mode: 0 },fields: { leashing: 1 },position: [(h.params['mouthX'] ?? 0)+5,h.params['mouthZ'] ?? 0] });expect(h.last(home,'field','speed')).toBe(2.2);expect(h.last(home,'field','lookWeight')).toBe(0);
  const lurked = h.run('tick',{ fields: { engaged: 0 },position: [h.params['mouthX'] ?? 0,h.params['mouthZ'] ?? 0],player: [(h.params['mouthX'] ?? 0)+40,h.params['mouthZ'] ?? 0] });expect(lurked.state['mode']).toBe(2);expect(h.last(lurked,'field','hidden')).toBe(1);
  const appeared = h.run('tick',{ state: { mode: 2 } });expect(h.has(appeared,'strike','roar')).toBe(true);expect(h.last(appeared,'field','hidden')).toBe(0);
  expect(h.run('tick',{ state: { mode: 3 },movingStrike: 1 }).state['mode']).toBe(3);
  const charge = h.run('tick',{ state: { mode: 3 },fields: { phase2: 1 } });expect(charge.state).toMatchObject({ mode: 4,roarCd: 5.5 });expect(h.has(charge,'strike','chargePhase2')).toBe(true);
  const close = h.run('tick',{ state: { mode: 3 },position: [0,0],player: [5,0] });expect(close.state).toMatchObject({ mode: 6,roarCd: 10 });
  const stalking = h.run('tick',{ state: { mode: 6,roarCd: 5 } });expect(h.last(stalking,'field','speed')).toBe(3.2);
  const swipe = h.run('tick',{ state: { mode: 6,roarCd: 5 },position: [0,0],player: [3,0] });expect(h.has(swipe,'strike','swipe')).toBe(true);expect(swipe.state['mode']).toBe(5);
  const refreshed = h.run('tick',{ state: { mode: 6 },position: [0,0],player: [10,0],fields: { phase2: 1 } });expect(h.has(refreshed,'strike','roarPhase2')).toBe(true);
  const finished = h.run('tick',{ state: swipe.state });expect(finished.state['mode']).toBe(6);
});

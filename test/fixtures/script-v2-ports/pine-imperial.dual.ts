import imperial from '../../../src/shards/pine-hollow/behaviour/elites/imperial.as?raw';
import { expect } from 'vitest';
import { elitePort } from '../script-v2-elite';

export const port = elitePort('imperial-bull',imperial,h => {
  expect(h.run('start').state).toMatchObject({ mode: 0,wanderT: 0,bugledPhase: -1,call: 0 });
  expect(h.run('signal',{ value: 1 }).state['mode']).toBe(2);
  const signal = h.run('signal',{ value: 2,fields: { phase2: 1 } });expect(signal.state['mode']).toBe(3);expect(h.has(signal,'strike','chargePhase2')).toBe(true);
  for (const frame of [{ alive: false },{ target: 0 }]) expect(h.run('tick',frame).commands).toEqual([]);
  const home = h.run('tick',{ fields: { leashing: 1 } });expect(home.state).toMatchObject({ mode: 1,bugledPhase: -1 });expect(h.last(home,'field','speed')).toBe(0);
  const wander = h.run('tick',{ fields: { engaged: 0 } });expect(wander.draws).toBe(3);expect(wander.state['wanderT']).toBe(9);
  const begin = h.run('tick',{ state: { mode: 4,bugledPhase: -1 },fields: { dusk: 0.46 } });expect(begin.state).toMatchObject({ mode: 2,bugledPhase: 0 });expect(h.has(begin,'cue','signature')).toBe(true);
  expect(h.run('tick',{ state: { mode: 4,bugledPhase: -1 },fields: { dusk: 0.45 } }).state['mode']).toBe(4);
  const cue = h.run('tick',{ state: { mode: 2,modeT: 0.1 },dt: 0.2 });expect(h.has(cue,'cue','bugle')).toBe(true);
  const called = h.run('tick',{ state: { mode: 2,modeT: 1.8 },dt: 0 });expect(called.state).toMatchObject({ mode: 4,call: 1 });expect(h.last(called,'channel','call')).toBe(1);expect(h.last(called,'channel','callYaw')).toBeCloseTo(Math.PI/2,12);
  const charge = h.run('tick',{ state: { mode: 4,modeT: 3.21,bugledPhase: 1 },dt: 0 });expect(h.has(charge,'strike','charge')).toBe(true);expect(charge.state['mode']).toBe(3);
  expect(h.run('tick',{ state: { mode: 4,modeT: 3.2,bugledPhase: 1 },dt: 0 }).state['mode']).toBe(4);
  const inactive = h.run('tick',{ self: 2,fields: { engaged: 0,call: 3 } });expect(inactive.state['call']).toBe(3);expect(h.last(inactive,'field','scripted')).toBe(0);
  const rival0 = h.run('tick',{ self: 2,alive: false,fields: { call: 1 } });expect(h.has(rival0,'spawn','rival0')).toBe(true);expect(h.has(rival0,'cue','bugle')).toBe(true);expect(rival0.state['call']).toBe(1);
  const rival1 = h.run('tick',{ self: 3,alive: false,fields: { call: 1 } });expect(h.has(rival1,'spawn','rival1')).toBe(true);
  expect(h.run('tick',{ self: 2,alive: false,state: { call: 1 },fields: { call: 1 } }).commands).toEqual([]);
  const strike = h.run('tick',{ self: 2,position: [0,0],player: [10,0],random: [0.01] });expect(h.has(strike,'strike','rival')).toBe(true);expect(strike.state['mode']).toBe(3);expect(strike.draws).toBe(1);
  expect(h.run('tick',{ self: 2,state: strike.state,movingStrike: 1 }).commands).toEqual([]);
  expect(h.run('tick',{ self: 2,state: strike.state }).state['mode']).toBe(0);
});

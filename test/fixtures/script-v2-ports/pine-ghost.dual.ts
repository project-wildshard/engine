import ghost from '../../../src/shards/pine-hollow/behaviour/elites/ghost.as?raw';
import { expect } from 'vitest';
import { elitePort } from '../script-v2-elite';

export const port = elitePort('ghost-stag',ghost,h => {
  expect(h.run('start').state).toMatchObject({ mode: 0,wanderT: 0,cd: 3,lastHit: -1000000,fadeT: 0,autoT: 5 });
  const fade = h.run('signal');expect(fade.state).toMatchObject({ mode: 2,fadeT: 2,cd: 4.5 });expect(h.last(fade,'field','hidden')).toBe(1);expect(h.has(fade,'cue','signature')).toBe(true);
  expect(h.run('signal',{ fields: { phase2: 1 } }).state['cd']).toBe(2.4);
  for (const frame of [{ alive: false },{ target: 0 }]) expect(h.run('tick',frame).commands).toEqual([]);
  const home = h.run('tick',{ fields: { leashing: 1 } });expect(home.state['mode']).toBe(1);expect(h.last(home,'field','hidden')).toBe(0);expect(h.last(home,'field','speed')).toBe(0);
  const wander = h.run('tick',{ fields: { engaged: 0 } });expect(wander.draws).toBe(3);expect(wander.state['wanderT']).toBe(9);
  const comeback = { state: { mode: 2,fadeT: 0,cd: 5 },dt: 0 };
  const appeared = h.run('tick',comeback);expect(appeared.state['mode']).toBe(3);expect(appeared.draws).toBe(1);expect(appeared.floors).toBe(2);expect(h.has(appeared,'cue','reappear')).toBe(true);expect(h.last(appeared,'field','hidden')).toBe(0);
  const steep = h.run('tick',{ ...comeback,ground: Array.from({ length: 16 },(_,i) => i%2 === 0 ? 7 : 0) });expect(steep.draws).toBe(8);expect(steep.floors).toBe(16);expect(h.last(steep,'field','x')).toBe(h.params['lairX']);expect(h.last(steep,'field','z')).toBe(h.params['lairZ']);
  const outside = h.run('tick',{ ...comeback,player: [1000,1000] });expect(outside.draws).toBe(8);expect(outside.floors).toBe(0);expect(outside.state['mode']).toBe(3);
  expect(h.run('tick',{ state: { mode: 3,modeT: 1.1,cd: 5 },fields: { phase2: 1 },dt: 0 }).state['mode']).toBe(3);
  expect(h.run('tick',{ state: { mode: 3,modeT: 1.1,cd: 5 },fields: { phase2: 1 },dt: 0.01 }).state['mode']).toBe(4);
  const hit = h.run('tick',{ state: { mode: 4,cd: 0 },fields: { lastHit: 1 } });expect(hit.state).toMatchObject({ mode: 2,lastHit: 1 });
  const flee = h.run('tick',{ state: { mode: 4,modeT: 1,cd: 5,lastHit: -1000000 } });expect(h.last(flee,'field','speed')).toBe(7);expect(h.last(flee,'field','lookWeight')).toBe(0);
  expect(h.run('tick',{ state: { mode: 4,modeT: 3,cd: 5,lastHit: -1000000 } }).state['mode']).toBe(3);
  const auto = h.run('tick',{ state: { mode: 4,cd: 0,autoT: 0.1,lastHit: -1000000 },fields: { phase2: 1 } });expect(auto.state).toMatchObject({ mode: 2,autoT: 3.875,cd: 2.4 });expect(auto.draws).toBe(1);
});

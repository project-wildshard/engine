import {Scope} from '../src/shared/engine/app/scope';
import {lendNalatiPasture} from './fixtures/nalati-return-modules';
import { expect, test, beforeEach, afterEach } from 'vitest';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { Rng } from '../src/shared/engine/core/rng';
import {titanPrograms as program} from './fixtures/titanInlineWitness';

let programmeScope:Scope;
beforeEach(()=>{programmeScope=new Scope('original-pasture-fixture');lendNalatiPasture(programmeScope);});
afterEach(()=>{programmeScope.dispose();});

function originalSpear(s: Record<string, number>, random: Rng): Record<string, number> {
  const n = (key: string): number => { const value = s[key]; if (value === undefined) throw new Error('Missing frozen input'); return value; };
  const dt = n('dt'), phase = n('phase'); let mode = n('mode'), t = n('t') + dt, cd = n('cd'), x = n('x'), z = n('z'), strike = 0, stuck = 0;
  if (mode === 0) { cd -= dt; if (cd <= 0 && n('chain') === 0) { mode = 1; t = 0; x = n('px'); z = n('pz'); } }
  else if (mode === 1) {
    if (t < n('aim') - n('lock')) { const k = Math.min(1, dt * 5); x += (n('px') - x) * k; z += (n('pz') - z) * k; }
    if (t >= n('aim')) { mode = 2; t = 0; strike = 1; }
  } else if (mode === 2) { if (t > .45) { mode = 3; t = 0; stuck = phase === 0 ? 1 : 0; } }
  else if (t >= n('stuck')) { mode = 0; t = 0; cd = phase === 2 ? 6 + random.next() * 2 : 2 + random.next() * 1.5; }
  return { mode, t, cd, x, z, strike, stuck };
}

test('selected Titan spear retains the frozen 10 Hz trace, lock point, strike window and borrowed RNG', () => {
  const author = ReturnProgram.page(program.attack), random = new Rng(496), oracle = new Rng(496);
  expect(program.attack.script.abi).toBe('1.0'); expect(program.attack.script.tick).toBeNull(); expect(program.attack.v2.artifact.lane).toBe('project');
  for (const phase of [0, 2]) {
    const state: Record<string, number> = { dt: .1, phase, mode: 0, t: 0, cd: 2.5, x: 0, z: 0, chain: 0, aim: 1.5, lock: .5, stuck: 3, px: 0, pz: 0 };
    let strikes = 0;
    for (let tick = 0; tick < 600; tick++) {
      state['px'] = Math.sin(tick * .07) * 40; state['pz'] = Math.cos(tick * .09) * 20;
      state['chain'] = tick >= 100 && tick < 160 ? 1 : 0;
      const expected = originalSpear(state, oracle), actual = author.project('spear', state, random);
      expect(actual).toEqual(expected); expect(random.snapshot()).toEqual(oracle.snapshot());
      strikes += actual['strike'] ?? 0;
      Object.assign(state, actual, { stuck: 3 });
    }
    expect(strikes).toBeGreaterThan(3);
  }
});

test('storm riders complete circle, committed charge and open flank without a second state owner', () => {
  const author = ReturnProgram.page(program.attack);
  const base = { dt: .1, px: 0, pz: 0, ax: -10, az: 0, mode: 0, t: 0, theta: 0, hit: 0,
    x0: -10, z0: 0, x1: 22, z1: 0, lane: 1.2, flank: 2 };
  const circle = author.project('rider', base); expect(circle['mode']).toBe(0); expect(circle['speed']).toBe(12);
  const aim = author.project('rider', { ...base, mode: 1, t: 1.2 }); expect(aim['mode']).toBe(2); expect(aim['t']).toBe(0);
  const hit = author.project('rider', { ...base, mode: 2, ax: 0 }); expect(hit['hurt']).toBe(1); expect(hit['hit']).toBe(1);
  const once = author.project('rider', { ...base, mode: 2, ax: 0, hit: 1 }); expect(once['hurt']).toBe(0);
  const pass = author.project('rider', { ...base, mode: 2, ax: 22 }); expect(pass['mode']).toBe(3); expect(pass['show']).toBe(0);
  const flank = author.project('rider', { ...base, mode: 3, t: 2 }); expect(flank['mode']).toBe(0); expect(flank['speed']).toBe(7);
});

test('chain storms schedule seven tells and land only inside their contact radius', () => {
  const author = ReturnProgram.page(program.attack), random = new Rng(503);
  let cd = 0, left = 0, t = 0, strikes = 0;
  for (let tick = 0; tick < 40; tick++) {
    const result = author.project('chain', { dt: .1, cd, chain: left, t, mode: 1, count: 12 }, random);
    cd = result['cd'] ?? cd; left = result['left'] ?? left; t = result['t'] ?? t;
    strikes += result['strike'] ?? 0;
  }
  expect(strikes).toBe(7); expect(left).toBe(0); expect(cd).toBeGreaterThan(0);
  const tell = { dt: .1, t: .3, land: .6, radius: 4, x: 0, z: 0, px: 0, pz: 0 };
  expect(author.project('chainLand', tell)).toMatchObject({ strike: 0, hurt: 0 });
  expect(author.project('chainLand', { ...tell, t: .6 })).toMatchObject({ strike: 1, hurt: 1 });
  expect(author.project('chainLand', { ...tell, t: .6, px: 8 })).toMatchObject({ strike: 1, hurt: 0 });
});


test('fire decisions expire cells, preserve burnt neighbours and stay within the v1 fuel budget', () => {
  const fire = ReturnProgram.page(program.fire,programmeScope), rng = new Rng(506);
  const neighbours = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]].map(([x,z]) => ({ x: x ?? 0, z: z ?? 0, mode: 2 }));
  expect(fire.project('fire', { dt: .1, burn: 2, spread: 1, count: 8, wx: 1, wz: 0 }, rng, neighbours)).toEqual({ burn: 1.9, mask: 0 });
  expect(fire.project('fire', { dt: .1, burn: .05, spread: 1, count: 8, wx: 1, wz: 0 }, rng, neighbours)).toEqual({ burn: -.05, mask: 0 });
  expect(fire.project('fireContact', { dt: .1, cd: 0, hit: 1, open: 1, amount: 8 })).toEqual({ cd: .5, hurt: 4, speed: -1 });
  expect(fire.project('fireContact', { dt: .1, cd: .5, hit: 1, open: 0, amount: 8 })).toEqual({ cd: .4, hurt: 0, speed: 0 });
  const grass = neighbours.map(row => ({ x: row.x, z: row.z, mode: 0 }));
  const result = fire.project('fire', { dt: .1, burn: 2, spread: 1, count: 8, wx: 1, wz: 0 }, rng, grass);
  expect(result['mask']).toBeGreaterThanOrEqual(0); expect(result['mask']).toBeLessThan(256);
  expect(fire.project('ignite', { burn: 7 }, rng)['burn']).toBeGreaterThanOrEqual(5.6);
});

test('rider coupling removes dead slots once and commits a single live charge', () => {
  const rules = ReturnProgram.page(program.rules), rng = new Rng(503);
  expect(rules.project('riderDamage',{ x: 0, z: 0, px: 1, pz: 0, radius: 1.6, open: 1 })['alpha']).toBe(3);
  expect(rules.project('riderDamage',{ x: 0, z: 0, px: 20, pz: 0, radius: 1.6, open: 1 })['alpha']).toBe(.5);
  const base = { dt: .1, px: 10, pz: 20, count: 3, hp: 1560, cd: 0, invuln: 0, chip: 208 };
  const slots = [{ hit: 0, mode: 0, x: 0, z: 0 }, { hit: 1, mode: 0, x: 2, z: 0 }, { hit: 1, mode: 0, x: 3, z: 0 }];
  expect(rules.project('couple', base, rng, slots)).toMatchObject({ mask: 1, hp: 1352, left: 2, index: 1, broke: 0, x0: 2, z0: 0 });
  expect(rules.project('couple', { ...base, invuln: 1 }, rng, slots)).toMatchObject({ hp: 1560 });
  expect(rules.project('couple', base, rng, slots.map(row => ({ x: row.x, z: row.z, mode: row.mode, hit: 0 })))).toMatchObject({ mask: 7, index: -1, broke: 1 });
  expect(rules.project('couple', base, rng, slots.map(row => ({ x: row.x, z: row.z, hit: 1, mode: 2 })))).toMatchObject({ index: -1 });
});

test('the native world receives bounded wind positions and doorway decisions', () => {
  const wind = ReturnProgram.page(program.wind,programmeScope), rules = ReturnProgram.page(program.rules);
  const w = wind.project('whirl', { dt: .1, t: 2, index: 0, x: 100, z: 0, vx: 0, vz: 0, cx: 0, cz: 0, radius: 68, wx: 1, wz: 0, cd: 0, hit: 1, px: 0, pz: 0, flank: 3.2, open: 1 });
  expect(Math.hypot(w['x'] ?? 0,w['z'] ?? 0)).toBeCloseTo(60);
  for(const [x,z]of [[33,19],[-51,27],[.2,-.7],[100,100]]){const row=wind.project('whirl',{dt:.1,t:2,index:1,x:x??0,z:z??0,vx:0,vz:0,cx:0,cz:0,radius:68,wx:1,wz:0,cd:0,hit:1,px:0,pz:0,flank:3.2,open:1});expect(Math.hypot(row['x']??0,row['z']??0)).toBeLessThanOrEqual(60.0000001);}
  const door = { px: 0, pz: 2, y: 0, ex: 0, ey: 0, ez: 0, facing: 0, volume: 1, inside: 0, corridor: 0, land: 22.5, engaged: 0, sand: 0, floor: 140, cy: 140 };
  expect(rules.project('kingDoor',door)).toEqual({ enter: 1, exit: 0, slow: 0 });
  expect(rules.project('kingDoor',{ ...door, inside: 1, volume: 0 })).toMatchObject({ exit: 1 });
  expect(rules.project('kingDoor',{ ...door, inside: 1, sand: 1, floor: 141 })).toMatchObject({ slow: 1 });
});

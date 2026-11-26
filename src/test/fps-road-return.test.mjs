import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { routeFor, routeLegOnPage } from '../scripts/memory/iphone/route.mjs';

// Replay the measured DF5 admission delay without a browser or wall-clock waits.
function roadReturn(seconds, admissionMs = 6600) {
  let now = 0, next, current = 'driftwood-isle', requestedAt = null;
  const held = new Map(), player = {position:{x:-30,z:-119.4},yaw:0};
  const game = {app:{input:{setHeld:(key,value) => held.set(key,value)}},level:{id:'platform.grid'},
    frameGate:() => true,frameCount:0,frameMs:Array(120).fill(1000/30),
    updateMs:Array(120).fill(4),renderMs:Array(120).fill(4),frameI:0,
    lastFrame:{calls:80,triangles:600000},renderer:{info:{programs:[]}}};
  const world = {hud:{entered:true},game,player};
  const grid = {
    state:() => ({home:'driftwood-isle',pitch:520,feet:{...player.position},
      cells:[{slug:'driftwood-isle',instance:'driftwood-isle',cell:[0,0]}]}),
    travelState:() => ({inside:current,live:{crossing:{current,
      target:requestedAt === null ? current : 'driftwood-isle',
      phase:requestedAt !== null && current === null ? 'preparing' : 'settled'}}}),
  };
  const leg = {...routeFor('driftwood-fps').at(-1),seconds,cap:30};
  const result = runInNewContext(`(${routeLegOnPage.toString()})(leg)`, {
    leg,window:{__wildshard:{world,shard:{grid}}},document:{visibilityState:'visible'},
    performance:{now:() => now},setTimeout:() => 1,clearTimeout:() => {},
    requestAnimationFrame:callback => { next = callback; },
  });
  while (next && now < (seconds+1)*1000) {
    const step = next; next = null;
    now += 1000/30; game.frameCount++;
    if (held.get('move.forward')) {
      player.position.x -= Math.sin(player.yaw)*7.2/30;
      player.position.z -= Math.cos(player.yaw)*7.2/30;
    }
    if (player.position.z < -250) current = null;
    if (current === null && player.position.z > -248.1) {
      requestedAt ??= now;
      if (now-requestedAt < admissionMs) player.position.z = -248.1;
      else current = 'driftwood-isle';
    }
    step();
  }
  return {result,held};
}

test('the fixed road minute includes phone admission and every measured frame', async () => {
  const old = await roadReturn(40).result;
  expect(old.error).toBe('incomplete waypoint, dwell or road return');
  expect(old.nav).toMatchObject({reached:4,expected:5,road:true,returned:false,stuck:[],skipped:0});
  const leg = routeFor('driftwood-fps').at(-1);
  expect(leg.seconds).toBe(60);
  const attempt = roadReturn(leg.seconds), complete = await attempt.result;
  expect(complete.error).toBeNull();
  expect(complete.nav).toMatchObject({reached:5,expected:5,road:true,returned:true,stuck:[],skipped:0,lostFrames:0});
  expect(complete.nav.dwellMs).toBeGreaterThanOrEqual(10000);
  expect(complete.nav.admissionMs).toBeGreaterThanOrEqual(6600);
  expect(complete.samples.reduce((n,sample) => n+sample.frameMs.length,0)).toBe(complete.frames);
  expect(complete.ms).toBeGreaterThanOrEqual(60000);
  expect(attempt.held.get('move.forward')).toBe(false);
});

test('an admission that never finishes still fails and releases movement', async () => {
  const attempt = roadReturn(60,Infinity), result = await attempt.result;
  expect(result.error).toBe('incomplete waypoint, dwell or road return');
  expect(result.nav.returned).toBe(false);
  expect(attempt.held.get('move.forward')).toBe(false);
});

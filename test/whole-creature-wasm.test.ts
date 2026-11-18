import { readFileSync } from 'node:fs';
import { parse } from 'valibot';
import { expect, test } from 'vitest';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { groundFixture } from './fixtures/plain-ground';
import { pinnedGuest } from './fixtures/decisionHarness';

// ONE-FORMAT CC60 (C-Q2): a whole-creature WASM brain from any upload, on the engine's data port and the shared fuel
// caps. The guest reads the nearest player's offset (input slots 10 and 11) and turns and walks toward it.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const HEADER = `export function abi_version():i32{return 0;}
export function in_ptr():i32{return 16384;}export function in_cap():i32{return 4096;}
export function out_ptr():i32{return 24576;}export function out_cap():i32{return 32;}
export function out_count():i32{return 3;}
export function on_tick():void{
 const dx=load<f64>(16384+80), dz=load<f64>(16384+88);
 store<f64>(24576,1);store<f64>(24584,1);store<f64>(24592,Math.atan2(dx,dz));
 store<f64>(24616,1);store<f64>(24624,2);store<f64>(24632,load<f64>(16384+104)>0?1.0:0.0);
 store<f64>(24656,1);store<f64>(24664,4);store<f64>(24672,6);
}
`;
const chaser = `${HEADER}export function init(lo:i32,hi:i32):void{}`;
const greedy = `${HEADER}export function init(lo:i32,hi:i32):void{let n:i32=0;while(n>=0){n++;}}`;

async function upload(source: string) {
  const wasm = await pinnedGuest(source, { maximumPages: 1 }), hash = hashImmutableBytes(wasm);
  const shard = groundFixture();
  shard.spawn.z = 20;
  shard.creatures = parse(CreaturesSchema, { ...shard.creatures, brains: [{ id: 'fixture.brain', kind: 'script', module: hash, thinkDivisor: 3,
    maxSpeed: 1, maxStrafe: 0, maxTurnRate: 6, parameters: [], strikes: [] }] });
  shard.sim.scripts = [hash];
  // an upload is plain JSON bytes: nothing of the test's objects survives
  return { shard: JSON.parse(JSON.stringify(shard)) as typeof shard, assets: new Map([[hash, wasm]]) };
}

test('a plain-JSON upload runs its whole-creature WASM brain on the server', async () => {
  const { shard, assets } = await upload(chaser);
  const sim = createShardfileSim(shard, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing brain body');
    const player = sim.host.nearestPlayer(actor.position);
    const before = Math.hypot(player.position.x - actor.position.x, player.position.z - actor.position.z);
    for (let tick = 0; tick < 120; tick++) sim.host.step();
    const after = Math.hypot(player.position.x - actor.position.x, player.position.z - actor.position.z);
    expect(sim.host.hasStep('script.declared')).toBe(true);
    expect(before - after).toBeGreaterThan(1);
  } finally { sim.dispose(); }
});

test('the same upload with an over-fuel script is refused at admission', async () => {
  const { shard, assets } = await upload(greedy), physics = await rapier;
  expect(() => createShardfileSim(shard, assets, { rapier: physics })).toThrow(/fuel/i);
});

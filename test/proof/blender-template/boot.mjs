// The actual authored product boots into native physics with its door and creature; no DOM or renderer.
// oxlint-disable-next-line import/no-nodejs-modules -- Fail the native boot process on mismatched collision and authored state.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the immutable platform physics binary.
import { readFileSync } from 'node:fs';
import { readProjectAssets } from '../../../src/sharddev/project.ts';
import { loadRapier } from '../../../src/shared/engine/physics/rapier.ts';
import { createShardfileSim } from '../../../src/server/game/plugin/simulation.ts';
import { leadCommands, leadPlayer } from '../../../src/shared/engine/sim/leadPlayer.ts';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const { shard: source, assets } = await readProjectAssets('src/shards/blender-template');
const sim = createShardfileSim(source, assets, { rapier, quest: { fact: () => assert.fail('Boot must not finish the hall quest'), coins: () => assert.fail('Boot must not grant its reward') } });
try {
  assert.equal(source.runtime, null); assert.equal(source.terrain, null);
  assert.notEqual(source.meshCollision, null); assert.equal(sim.host.entities.has('guardian.1'), true);
  const door = sim.colliders.get('blender.door.collider'); assert.equal(door.active(), true);
  for (let tick = 0; tick < 180; tick++) sim.host.step(leadCommands(sim.host, { moveX: 0, moveZ: 1, yaw: 0 }));
  const stopped = leadPlayer(sim.host).position.z;
  assert.ok(stopped > 14 && stopped < 15.5, 'Closed authored door stops the capsule before the panel');
  const toggle = () => { sim.lane.enqueue({ type: 201, target: sim.actors.get(leadPlayer(sim.host).id), value: 1 }); sim.host.step(); };
  toggle(); assert.equal(door.active(), false);
  toggle(); assert.equal(door.active(), true);
  console.info(JSON.stringify({ native: true, meshCollision: true, creature: 'guardian.1', stopped, opened: true, reclosed: true }));
} finally { sim.dispose(); }

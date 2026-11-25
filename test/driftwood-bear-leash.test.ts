// oxlint-disable-next-line import/no-nodejs-modules -- The leash runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from '../src/test/game/builtFolder';

// QA-FEEDBACK-2026-11-24 row 26 (DF7's night bot, 11-23): Driftwood's black bear camped the quest fire, about 101 m from its
// home and past the kit bear's 90 m leash, and killed a bot standing there in about 5 s. A declared hunt now keeps its
// temperament's leash: past it (itself, or its quarry) it walks home and hunts nothing on the way.
const SLUG = 'driftwood-isle', BEAR = 'creature:12', PLAYER = 'actor.player';
const FIRE = { x: -22 + 0.7, z: -64 - 9.8 };   // questPageComposition speaker.fire: the hut POI plus its offset

async function island() {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === undefined) throw new Error('Missing admitted output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return createNativeHeadlessResident({ shard, assets, rapier, product });
}

test('Driftwood: the black bear set down at the quest fire walks home and leaves a standing player alone for 60 s', async () => {
  const live = await island();
  try {
    const host = live.host, bear = host.entities.get(BEAR), player = host.players.get(PLAYER);
    if (bear === undefined || player === undefined) throw new Error('Missing the black bear or the player');
    expect(bear.kind).toBe('bear');
    const home = { x: bear.position.x, z: bear.position.z };
    const fireY = host.groundHeightAt(FIRE.x, FIRE.z);
    player.position.set(FIRE.x, fireY, FIRE.z); player.motor.resetAt(player.position);
    bear.position.set(FIRE.x + 4, host.groundHeightAt(FIRE.x + 4, FIRE.z), FIRE.z);
    const health = player.health.attributes.health, start = host.clock.now;
    let nearest = Infinity;
    while (host.clock.now - start < 60) {
      live.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
      nearest = Math.min(nearest, Math.hypot(bear.position.x - FIRE.x, bear.position.z - FIRE.z));
    }
    expect(player.health.attributes.health, `the bear came within ${nearest.toFixed(1)} m`).toBe(health);
    expect(Math.hypot(bear.position.x - home.x, bear.position.z - home.z), 'the bear is back inside its leash').toBeLessThan(90);
  } finally { live.dispose?.(); }
}, 120_000);

test('Driftwood: inside its leash the black bear still hunts a player beside it', async () => {
  const live = await island();
  try {
    const host = live.host, bear = host.entities.get(BEAR), player = host.players.get(PLAYER);
    if (bear === undefined || player === undefined) throw new Error('Missing the black bear or the player');
    player.position.set(bear.position.x + 4, host.groundHeightAt(bear.position.x + 4, bear.position.z), bear.position.z); player.motor.resetAt(player.position);
    const health = player.health.attributes.health, start = host.clock.now;
    while (host.clock.now - start < 30 && player.health.attributes.health === health) live.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
    expect(player.health.attributes.health, 'the bear charged the player inside its leash').toBeLessThan(health);
  } finally { live.dispose?.(); }
}, 120_000);

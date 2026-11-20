// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { nativeQuestChannels } from '../src/server/game/quest/nativeInputs';
import { QuestRewardController } from '../src/shared/game/plugin/quests';
import { builtFolder } from '../src/test/game/builtFolder';

// meta QA-FEEDBACK-2026-11-20-mini row 8 (IPHONE13-DRIFTWOOD DW10 recheck). On the grid the room's reward beat took the
// player (the quest's carry) when the Drowned Captain's reward began, and its finish said a completion card had taken the
// carry over. The room has no card, so nothing gave it back: after QUEST COMPLETE the player stood frozen at the reward spot
// for good, through reloads, and every later player who entered the room's Driftwood stood there too.

const SLUG = 'driftwood-isle', REWARD = { x: -96.21572111113656, z: 105.52632596242425 };

test('the room hands the player back after Driftwood\'s reward beat', async () => {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === null || descriptor === undefined) throw new Error('Driftwood has no output descriptor');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard).map(file =>
    [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const resident = await createNativeHeadlessResident({ shard, assets, rapier, product }, undefined, { room: true });
  try {
    const host = resident.host, player = leadPlayer(host);
    for (let tick = 0; tick < 10; tick++) resident.step([]);
    const reward = nativeQuestChannels(host, 'driftwood.reward') as Record<string, number | boolean>;
    reward['started'] = true;
    // the beat carries the player to the reward pose; then the chapter director files `seen:reward` (its timeline, after the
    // Captain), which finishes the beat
    for (let tick = 0; tick < 60 * 4; tick++) resident.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
    host.flags.set('seen:reward');
    for (let tick = 0; tick < 30; tick++) resident.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
    expect(Math.hypot(player.position.x - REWARD.x, player.position.z - REWARD.z), 'the reward beat never took the player').toBeLessThan(0.5);
    expect(host.flags.has('seen:complete')).toBe(true);
    const from = player.position.clone();
    for (let tick = 0; tick < 120; tick++) resident.step([{ kind: 'player', moveX: 0, moveZ: -1, yaw: 0 }]);
    expect(Math.hypot(player.position.x - from.x, player.position.z - from.z)).toBeGreaterThan(1.5);
  } finally { resident.host.dispose(); }
}, 120_000);

test('a finished reward save no longer takes the player', () => {
  const ride = { position: new Vector3(), velocity: new Vector3(), yaw: 0, pitch: 0, carried: false };
  const beat = new QuestRewardController(ride, null, { when: () => false, at: new Vector3(1, 2, 3), finish: () => false });
  // what a room saved while the beat had kept the carry after its finish
  beat.restore({ elapsed: -2, carried: false, player: { pitch: 0.66, carried: true }, from: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, phase: 0 } });
  expect(ride.carried).toBe(false);
  beat.update(1); expect(ride.carried).toBe(false); expect(beat.active).toBe(false);
});

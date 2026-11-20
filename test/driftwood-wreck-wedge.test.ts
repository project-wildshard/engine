// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from '../src/test/game/builtFolder';

// meta QA-FEEDBACK-2026-11-20-mini row 4 (IPHONE13-DRIFTWOOD DW9). Inside Driftwood's wreck hull, at (150.7, 0.5, -1.3), the
// feet perch on the top edge of a plank box, with hull walls on two sides and a beam just over the head. The edge reads as a
// slope too steep to climb and not as a wall, so the controller never stepped up it: no move and no jump got out, and a reload
// resumed there. A stalled grounded move now tries once more from as high as a step (or the beam) allows, and keeps it when
// it lands within a step on walkable ground, or crosses the steep edge without climbing it.

const SLUG = 'driftwood-isle', WEDGE = { x: 150.7, y: 0.5, z: -1.3 };

test('a player wedged on the wreck hull\'s plank edge walks out', async () => {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === null || descriptor === undefined) throw new Error('Driftwood has no output descriptor');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard).map(file =>
    [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const resident = await createNativeHeadlessResident({ shard, assets, rapier, product }, undefined, { room: true });
  try {
    const player = leadPlayer(resident.host);
    for (let tick = 0; tick < 10; tick++) resident.step([]);
    player.position.set(WEDGE.x, WEDGE.y, WEDGE.z); player.velocity.set(0, 0, 0); player.motor.resetAt(player.position);
    for (let tick = 0; tick < 30; tick++) resident.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
    const from = player.position.clone();
    expect(from.distanceTo(WEDGE)).toBeLessThan(0.1);
    const away = Math.SQRT1_2;
    for (let tick = 0; tick < 120; tick++) resident.step([{ kind: 'player', moveX: -away, moveZ: -away, yaw: 0 }]);
    expect(Math.hypot(player.position.x - from.x, player.position.z - from.z)).toBeGreaterThan(1.5);
  } finally { resident.host.dispose(); }
}, 120_000);

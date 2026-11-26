// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { NetHandles } from '../src/server/engine/net/handles';
import { builtFolder } from '../src/test/game/builtFolder';

// QA 11-25 row 86 (b): Driftwood's return stands its killed boar up again in place, under the same id. The room kept its
// handle, so a page that had shown the boar's death (a ragdoll, which never stands up again) kept the corpse for good and
// never showed the return. A body that stands again is a new life, and each life takes its own handle: the dead one is
// swept (its despawn), and the return spawns new.
const SLUG = 'driftwood-isle';

test('a killed Driftwood boar\'s return comes back under a fresh handle', async () => {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const cell = await openCellWorld({ instance: SLUG }, { shard, assets, rapier, product } as never, undefined,
    { saves: new SaveStore({ local: null, session: null }), lone: false, pageless: true });
  try {
    const { host } = cell, lead = [...host.players.values()][0];
    if (lead === undefined) throw new Error('No lead seat');
    const world = new SimNetWorld(host), handles = new NetHandles(), swept = new Set<number>(), renewed = new Set<number>();
    let serial = 0;
    const frame = (): void => {
      const at = ++serial;
      world.visit({ entity: (id, cls, view, life) => { handles.touch(id, cls, view, at, life); } });
      for (const handle of handles.sweep(at)) swept.add(handle);
      for (const handle of handles.renewed) renewed.add(handle);
    };
    for (let tick = 0; tick < 60; tick++) cell.step([]);
    const victim = [...host.entities.values()].find(body => body.kind === 'boar' && body.alive);
    if (victim === undefined) throw new Error('Driftwood has no live boar');
    frame();
    const first = handles.refs(victim.entityId);
    lead.resetPose({ x: victim.position.x, y: victim.position.y, z: victim.position.z + 2 }, 0);
    cell.step([]);
    expect(host.combat.hit({ source: 'env', sourceTags: [], target: victim.combatActor(), amount: 9999, point: victim.position.clone(), dir: new Vector3(0, 0, 1) })?.killed).toBe(true);
    // the corpse keeps its handle while it lies there: its death presents on the body the page already draws
    cell.step([]); frame();
    expect(handles.refs(victim.entityId)).toBe(first);
    // out of the return's sight, on its own clock
    lead.resetPose({ x: -160, y: lead.position.y, z: -188 }, 0);
    for (let tick = 0; tick < 60 * 60 * 10 && !victim.alive; tick++) { cell.step([]); if (tick % 30 === 0) frame(); }
    frame();
    expect(victim.alive).toBe(true);
    expect(victim.lives).toBe(1);
    const second = handles.refs(victim.entityId);
    expect(second).not.toBe(first);
    expect(second).not.toBe(0);
    expect(swept.has(first)).toBe(true);
    expect(renewed.has(first)).toBe(true);
  } finally { cell.dispose(); }
}, 120_000);

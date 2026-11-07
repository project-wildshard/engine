// oxlint-disable-next-line import/no-nodejs-modules -- A room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { NET_POSE } from '../src/shared/engine/sim/shardRows';
import { directLoopback } from '../src/test/engine/netLoopback';
import { numericCreaturePose, poseInputNames } from '../src/shared/game/plugin/channelPrograms';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netWorldInput, stepResident } from '../src/shared/host/standalone/netInput';
import { builtProduct } from './fixtures/builtProduct';

// `mem` holds a body's pose inputs and its brain's memory side by side, and a server pack has no pose program to tell them apart,
// so a page names what it reads. Whether a page poses a body by them is the row's browser proof, not this.
test('a server says the pose inputs a page names and nothing else of a body', { timeout: 60_000 }, async () => {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  try {
    const { host } = live, lead = leadPlayer(host), world = new SimNetWorld(host, 0), link = directLoopback();
    const room = new NetRoom({ world, step: inputs => { netWorldInput(actRoutes(host), inputs); stepResident(live, lead.id, inputs); } }); // as `StandaloneGrid` steps one
    room.open(); room.join(link.server, world.player);
    const client = new NetClient(link.client, () => 0), heard: string[] = [];
    client.hello(); link.pump();
    client.onView(({ name, args }) => { if (name.startsWith(NET_POSE)) { expect(args).toHaveLength(1); heard.push(name.slice(name.lastIndexOf('.') + 1)); } });
    client.act({ kind: 'pose', seq: 0, names: 'horseheadUp,snarl,low,burst-x,bad name,__proto__x,' }); link.pump();
    const body = [...host.entities.values()].find(entry => entry.kind === 'horse');
    if (body === undefined) throw new Error('Missing horse');
    for (let tick = 0; tick < 900; tick++) {
      if (tick % 120 === 0) { lead.position.set(body.position.x + 3, body.position.y + 0.5, body.position.z); lead.motor.resetAt(lead.position); }
      client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush();
      room.tick(); link.pump();
    }
    expect(heard).toContain('horseheadUp');
    expect(heard.filter(name => !['horseheadUp', 'snarl', 'low', '__proto__x'].includes(name))).toEqual([]); // no timer, no brain
    expect(actRoutes(host).poseInputs.has('burst-x'), 'the captain\'s splash lands by its fields').toBe(true);
    expect(actRoutes(host).poseInputs.has('bad name')).toBe(false);
  } finally { live.dispose(); }
});

test('a pose program a page builds names what it reads, and a body keeps its strafe and brace on its row', () => {
  poseInputNames.clear();
  const clip = { group: 'test', scalars: [{ name: 'snarl', path: ['mem', 'snarl'] }, { name: 'bodyY', path: ['dims', 'bodyY'] }], programs: [] };
  expect(() => { numericCreaturePose(clip); }).toThrow(); // an empty table is refused: what it read is still known, and a refused body draws nothing
  expect([...poseInputNames]).toEqual(['snarl']);
  expect(ANIMAL_CLASS.row.map(column => column.name)).toEqual(expect.arrayContaining(['strafe', 'brace']));
});

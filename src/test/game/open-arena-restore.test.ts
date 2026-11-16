// oxlint-disable-next-line import/no-nodejs-modules -- Native regression over admitted product and shipped physics bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { openWorld } from '../../server/host/openWorld';
import { loadHeadlessProduct } from '../../server/host/headlessProduct';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { createSimSnapshotSerializer, snapshotSimHostBytes } from '@wildshard/engine/sim/snapshot';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { builtProduct } from './builtProduct';
import { outputDescriptor } from '@wildshard/engine/game/shardfile/outputDescriptor';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { openArenaOf } from '@wildshard/engine/game/boss/openArenaNative';

for (const frames of [0,5]) test(`a restored Titan intro after ${frames} frames reads the same previous heart before its next draw`, async () => {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === undefined) throw new Error('Missing admitted output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const input = { product, shard, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) };
  const world = await openWorld(input, {room:true}), resident = world.resident, writer = createSimSnapshotSerializer();
  let back: Awaited<ReturnType<typeof openWorld>> | undefined;
  try {
    if (resident === undefined) throw new Error('Missing native resident');
    const { host } = resident, arena = openArenaOf(host), seat = mountedPlayerOf(host);
    if (arena === undefined || seat === undefined) throw new Error('Missing native arena owners');
    // Unit scaffold only: the shard-owned acceptance earns this horse and
    // approach from spawn. Here isolate the intro's camera/heart boundary.
    for (let tick=0;tick<120;tick++) resident.step([]);
    const horse = seat.mountables.find(body => seat.canRide(body.entityId));
    if (horse === undefined) throw new Error('No mount for intro scaffold');
    expect(seat.mount(horse.entityId)).toBe(true);
    const at = arena.fight.cairnSpot(); seat.teleport(at.x,at.z,0);
    actRoutes(host).climate?.({op:'mode',name:'storm',at:-1});
    for (let tick=0;tick<600&&!arena.storm();tick++) resident.step([]);
    expect(arena.storm()).toBe(true);
    resident.step([{kind:'script',actorId:'nalati.titan.use',value:1}]);
    for (let tick=0;tick<120&&arena.boss.state==='armed';tick++) resident.step([]);
    expect(arena.boss.state).toBe('intro');
    for (let tick=0;tick<frames;tick++) resident.step([]);
    const saved = writer.serialize(snapshotSimHostBytes(host));
    back = await openWorld(input,{room:true,snapshot:saved});
    expect(writer.serialize(snapshotSimHostBytes(back.host)) === saved).toBe(true);
    const restored = openArenaOf(back.host); if (restored === undefined || back.resident === undefined) throw new Error('Missing restored arena');
    const focus = new Vector3(), resumedFocus = new Vector3();
    arena.fight.body.focusWorld(focus); restored.fight.body.focusWorld(resumedFocus);
    expect(resumedFocus.toArray()).toEqual(focus.toArray());
    for (let tick=0;tick<5;tick++) {
      const commands = [{kind:'player' as const,moveX:0,moveZ:0,yaw:.09+tick*.02,commandVersion:1 as const,steer:{keyX:0,keyY:0,stickX:-1,stickY:1}}];
      resident.step(commands); back.resident.step(commands);
      expect(back.resident.effects).toEqual(resident.effects);
      expect(writer.serialize(snapshotSimHostBytes(back.host)) === writer.serialize(snapshotSimHostBytes(host))).toBe(true);
    }
  } finally { back?.dispose(); writer.dispose(); world.dispose(); }
},60_000);

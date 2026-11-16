// A building's door on the server: it stops a body shut, lets one through open, and its bar is each player's own (J106).
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { questBooks } from '../src/shared/engine/quest/players';
import { tagOf } from '../src/shared/engine/physics/surface';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { installServerDoors } from '../src/server/game/quest/serverDoors';
import { SaveStore } from '../src/shared/engine/saves/store';
import { buildingDoorFlag, buildingSave, pageOpenDoors } from '../src/shared/game/shardfile/buildingDoor';
import { instanceSave } from '../src/shared/game/instanceSaves';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

async function pine(opened?: ReadonlySet<string>) {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = runtimeAssets(product, directory);
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  expect(await installServerDoors(live.host, product, opened)).toBe(true);
  return live;
}

test('a door stands in the server\'s world, shut and open, and a bar is its player\'s', { timeout: 10_000 }, async () => {
  const live = await pine();
  try {
    const { host } = live, lead = leadPlayer(host), routes = actRoutes(host), mill = 'cabin-7-door', hinge = { x: -178.09, z: -145.3 };
    const press = routes.claims.get(mill);
    if (press === undefined) throw new Error('No door route');
    const piece = (id: string): { x: number; z: number; on: boolean } => { let found = { x: 0, z: 0, on: false }; host.physics.world.forEachCollider(c => { const owner = tagOf(c)?.owner, at = c.translation(); if (typeof owner === 'object' && owner !== null && Object.values(owner).includes(`piece:${id}`)) found = { x: at.x, z: at.z, on: c.isEnabled() }; }); return found; };
    const collider = (): { x: number; z: number; on: boolean } => piece(mill);
    lead.position.set(hinge.x + 1, host.groundHeightAt(hinge.x + 1, hinge.z + 1) + 0.2, hinge.z + 1); lead.motor.resetAt(lead.position);
    expect(piece(`${mill}-bar`).on).toBe(true);
    press(lead.id);
    expect(host.flags.has(buildingDoorFlag(mill)), 'barred: errand:done is not up').toBe(false);
    questBooks(host).of(lead.id).flags.set('errand:done');
    host.step();
    press(lead.id);
    expect(host.flags.has(buildingDoorFlag(mill))).toBe(true);
    expect(piece(`${mill}-bar`).on, 'the bar is down for a player whose gate it is').toBe(false);
    const shut = collider();
    for (let i = 0; i < 90; i++) host.step();
    const open = collider();
    expect(Math.hypot(open.x - shut.x, open.z - shut.z), 'the leaf swung').toBeGreaterThan(0.3);
    lead.position.set(0, 2, 0); lead.motor.resetAt(lead.position);
    for (let i = 0; i < 5; i++) host.step();
    expect(collider().on, 'it stands again once the player is past the hinge').toBe(true);
  } finally { live.dispose(); }
});

test('a door a page\'s save left open stands open in a world\'s first boot, and its save reads as the page wrote it', { timeout: 10_000 }, async () => {
  const entries = new Map<string, string>(), local = { get length() { return entries.size; }, key: (index: number) => [...entries.keys()][index] ?? null, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const store = new SaveStore({ local, session: null }), placement = { id: 'pine-hollow', shard: 'pine-hollow' };
  instanceSave(store, buildingSave, placement).write({ cabins: { version: 1, speed: 0, wheels: [], doors: [{ id: 'cabin-1-door', open: true, enabled: true, t: 1 }, { id: 'cabin-7-door', open: false, enabled: true, t: 0 }] } });
  const opened = pageOpenDoors(store, placement);
  expect([...opened]).toEqual(['cabin-1-door']);
  const live = await pine(opened);
  try {
    expect(live.host.flags.has(buildingDoorFlag('cabin-1-door'))).toBe(true);
    expect(live.host.flags.has(buildingDoorFlag('cabin-7-door'))).toBe(false);
  } finally { live.dispose(); }
});

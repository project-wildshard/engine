// oxlint-disable-next-line import/no-nodejs-modules -- The ride runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';
import { KinematicMover, type MoverPose } from '../src/shared/engine/physics/mover';
import { tagOf } from '../src/shared/engine/physics/surface';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import type { SimHost } from '../src/server/engine/sim';
import { builtProduct } from './fixtures/builtProduct';

// SERVER-PARITY HS2. Driftwood's moored boat is a `platform` mover on the swell. The page stands its player on the boat's planks,
// posed from the room's `script:driftwood.boat` row (`FollowedMovers.follow`). Before HS2 the room (`createTrustedHeadlessResident`,
// what `cellWorld` runs) drove only `carry` movers: it built no boat at all and sent no row, so the room's player stood on nothing,
// dropped into the sea, and every correction pulled the page's player off the deck it stands on.

const SLUG = 'driftwood-isle', BOAT = 'driftwood.boat', RIDE = 30 * 60, CORRECTION = 0.02;

const boatColliders = (host: SimHost): number => {
  let count = 0;
  host.physics.world.forEachCollider(collider => { if (tagOf(collider)?.owner === BOAT) count++; });
  return count;
};

test('a room player standing on Driftwood\'s moored boat for 30 s rides the deck the page draws', async () => {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const row = shard.movers.find(mover => mover.id === BOAT);
  if (row === undefined || row.kind !== 'platform' || row.carry !== undefined) throw new Error('Driftwood\'s boat is no longer a moored platform');
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), input = { shard, assets, rapier, product };
  // the page: its own world holding the boat's declared boxes, posed from the room's row as `FollowedMovers` poses them
  const page = new Physics(rapier), rest: MoverPose = { position: { ...row.at }, euler: { ...row.euler }, enabled: row.enabled };
  const deck = new KinematicMover(page, row.boxes, rest, BOAT); page.step();
  const top = (x: number, z: number): number | null => {
    const hit = page.castRay(new rapier.Ray({ x, y: row.at.y + 20, z }, { x: 0, y: -1, z: 0 }), 40, true);
    return hit === null ? null : row.at.y + 20 - hit.timeOfImpact;
  };
  const resident = await createTrustedHeadlessResident(input, undefined, { room: true });
  let saved: ReturnType<typeof snapshotSimHostBytes>;
  try {
    const host = resident.host, player = leadPlayer(host), boatRow = (): MoverPose | null => {
      const read = shardRows(host).bodies.get(`script:${BOAT}`); if (read === undefined) return null;
      const { position: p, euler: e, enabled } = read() as MoverPose; return { position: { ...p }, euler: { ...e }, enabled };
    };
    resident.step([]); deck.resetPose(boatRow() ?? rest); page.step(); // the boat's first row: the swell does not start at rest
    const at = { x: row.at.x, z: row.at.z }, start = top(at.x, at.z);
    if (start === null) throw new Error('The boat\'s deck is not under its own origin');
    player.position.set(at.x, start + 0.02, at.z); player.velocity.set(0, 0, 0); player.motor.resetAt(player.position);
    let offset: number | null = null, worst = 0, off = 0;
    for (let tick = 0; tick < RIDE; tick++) {
      resident.step([]);
      deck.resetPose(boatRow() ?? rest); page.step(); // nothing drives the page's deck but the room's row
      const under = top(player.position.x, player.position.z);
      if (under === null) { off++; continue; }
      const gap = player.position.y - under;
      offset ??= gap;
      worst = Math.max(worst, Math.abs(gap - offset));
    }
    expect(worst).toBeLessThanOrEqual(CORRECTION); // on main before HS2: 1.118 m, the room's player in the sea under the deck
    expect(off).toBe(0); // never carried off the page's deck
    expect(boatColliders(host)).toBe(row.boxes.length);
    expect(boatRow()).not.toBeNull();
    saved = snapshotSimHostBytes(host);
  } finally { resident.dispose(); }
  // a restored room keeps one boat, and moves it
  const restored = await createTrustedHeadlessResident(input, saved, { room: true });
  try {
    expect(boatColliders(restored.host)).toBe(row.boxes.length);
    const read = shardRows(restored.host).bodies.get(`script:${BOAT}`), was = JSON.stringify(read?.());
    for (let tick = 0; tick < 60; tick++) restored.step([]);
    expect(JSON.stringify(read?.())).not.toBe(was);
  } finally { restored.dispose(); }
  // a room saved before HS2 holds no boat and no mover step: its restore joins the step and builds the boat fresh
  const old = await createTrustedHeadlessResident(input, undefined, { room: true });
  try {
    const { world } = old.host.physics, bodies = new Set<number>();
    world.forEachCollider(collider => { const body = collider.parent(); if (tagOf(collider)?.owner === BOAT && body !== null) bodies.add(body.handle); });
    for (const handle of bodies) world.removeRigidBody(world.getRigidBody(handle));
    for (const id of ['movers.moored', 'movers.moored.script']) expect(old.host.adapters.delete(id)).toBe(true);
    expect(boatColliders(old.host)).toBe(0);
    saved = snapshotSimHostBytes(old.host);
  } finally { old.dispose(); }
  const upgraded = await createTrustedHeadlessResident(input, saved, { room: true });
  try {
    expect(boatColliders(upgraded.host)).toBe(row.boxes.length);
    for (let tick = 0; tick < 60; tick++) upgraded.step([]);
    expect(boatColliders(upgraded.host)).toBe(row.boxes.length);
  } finally { upgraded.dispose(); page.dispose(); }
}, 120_000);

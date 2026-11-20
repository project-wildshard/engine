// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { wireBarrelPose } from '../src/client/engine/world/interact/Interactables';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagOf } from '../src/shared/engine/physics/surface';
import { BARREL_HALF } from '../src/shared/engine/world/interact/barrel';
import { shardRows, type ScriptNetView } from '../src/shared/engine/sim/shardRows';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from '../src/test/game/builtFolder';

// meta QA-FEEDBACK-2026-11-20-mini row 3 (IPHONE13-DRIFTWOOD DW8). On the grid the room (`createNativeHeadlessResident` with
// `room`, what `cellWorld` runs) owns Driftwood's tide barrel as a declared body, and its player pushes it, but no row carried
// it: the page drew and pushed a barrel of its own that never moved (its body sat in the boot's physics, out of the cell's),
// so the cave shard, the altar and the Drowned Captain were out of reach. The room now poses it as `script:tide-barrel`,
// the page's barrel follows that row, and the room's plate judges the room's barrel.

const SLUG = 'driftwood-isle', ROW = 'script:tide-barrel', PLATE_B = { x: 144.9, z: 9.9, half: 1.3 / 2 }, PLAYER_R = 0.35;

test('the room\'s player pushes Driftwood\'s tide barrel onto plate B, and the row the page follows carries it there', async () => {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const resident = await createNativeHeadlessResident({ shard, assets, rapier, product }, undefined, { room: true });
  try {
    const host = resident.host, player = leadPlayer(host), read = shardRows(host).bodies.get(ROW);
    if (read === undefined) throw new Error('The room publishes no row for the tide barrel');
    const row = (): ScriptNetView => read();
    const body = () => {
      let found: { x: number; y: number; z: number } | null = null;
      host.physics.world.forEachCollider(collider => {
        const owner = tagOf(collider)?.owner;
        if (typeof owner === 'object' && owner !== null && 'id' in owner && owner.id === 'tide-barrel') { const t = collider.parent()?.translation(); if (t !== undefined) found = { x: t.x, y: t.y, z: t.z }; }
      });
      if (found === null) throw new Error('The room has no tide barrel body');
      return found as { x: number; y: number; z: number };
    };
    // the barrel script spawns its body on its first decision, applied on the next fixed step
    for (let tick = 0; tick < 10; tick++) resident.step([]);
    expect(row().enabled).toBe(true);
    expect(row().position).toEqual(body());
    const home = { ...row().position };
    expect(Math.hypot(home.x - 147.5, home.z - 3.5)).toBeLessThan(0.05);

    // walk in from the south, then keep behind the barrel and nudge it toward plate B (it tips, and rolls across a push)
    player.position.set(148.4, host.groundHeightAt(148.4, 1) + 0.1, 1); player.velocity.set(0, 0, 0); player.motor.resetAt(player.position);
    const toward = (x: number, z: number, speed = 1) => {
      const dx = x - player.position.x, dz = z - player.position.z, d = Math.hypot(dx, dz) || 1;
      return { kind: 'player' as const, moveX: dx / d * speed, moveZ: dz / d * speed, yaw: 0 };
    };
    const onPlate = (p: { readonly x: number; readonly z: number }, reach: number) => Math.hypot(p.x - PLATE_B.x, p.z - PLATE_B.z) < reach;
    let pressed = -1;
    for (let tick = 0; tick < 60 * 40 && pressed < 0; tick++) {
      const b = row().position, ux0 = PLATE_B.x - b.x, uz0 = PLATE_B.z - b.z, ud = Math.hypot(ux0, uz0) || 1, ux = ux0 / ud, uz = uz0 / ud;
      const px = player.position.x - b.x, pz = player.position.z - b.z, along = px * ux + pz * uz, side = -px * uz + pz * ux;
      const command = along > -0.6 ? toward(b.x - ux * 1.3 - uz * Math.sign(side || 1) * 1.4, b.z - uz * 1.3 + ux * Math.sign(side || 1) * 1.4)
        : Math.abs(side) > 0.15 ? toward(b.x - ux, b.z - uz) : toward(b.x + ux * 0.3, b.z + uz * 0.3, 0.5);
      resident.step([command]);
      if (host.flags.has('plate:tide-plate-b') && onPlate(row().position, PLATE_B.half) && !onPlate(player.position, PLATE_B.half + PLAYER_R)) pressed = tick;
    }
    expect(pressed, 'the barrel never pressed plate B on its own').toBeGreaterThan(0);
    // the row is the body, off its home, on the plate, and the barrel alone holds the plate while the player stands off it
    expect(row().position).toEqual(body());
    expect(Math.hypot(row().position.x - home.x, row().position.z - home.z)).toBeGreaterThan(5);
    for (let tick = 0; tick < 120; tick++) resident.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
    expect(onPlate(player.position, PLATE_B.half + PLAYER_R)).toBe(false);
    expect(host.flags.has('plate:tide-plate-b')).toBe(true);
    expect(onPlate(row().position, PLATE_B.half)).toBe(true);
    // the page draws it where the row says: its base under its centre, by its turn
    const base = new Vector3(), turn = new Quaternion(), r = row();
    wireBarrelPose(r, base, turn);
    const up = new Vector3(0, BARREL_HALF, 0).applyQuaternion(turn);
    expect(base.clone().add(up).distanceTo(new Vector3(r.position.x, r.position.y, r.position.z))).toBeLessThan(1e-9);
  } finally { resident.host.dispose(); }
}, 120_000);

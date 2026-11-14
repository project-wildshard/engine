// SERVER-PARITY SS4: Nalati's sneak shot on the server. The page doubles a bow shot loosed from Hidden for 4 s, but the room
// server dealt plain damage, so prey the page showed dying survived online. A room player's arrow from Hidden in long grass
// now lands at ×2 on the server for 4 s, and the same arrow from standing lands at ×1.
// Red on main: the Hidden arrow dealt 43, the same as the standing one.
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { HeldBowFileSchema } from '@wildshard/format/weaponProfiles';
import { DAMAGE, type AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { nativeStealthOf } from '../src/server/game/stealth/nativeStealth';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { builtFolder } from './fixtures/builtFolder';

// The long grass the native stealth proof walks into (test/fixtures/headless/nalati-stealth-run.ts).
const GRASS = { x: 34, z: 198 }, RANGE = 3;

test('a room bow shot from Hidden deals double damage on the server', { timeout: 180_000 }, async () => {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, undefined, { room: true });
  try {
    const { host } = live, lead = leadPlayer(host);
    const arrows: number[] = [];
    host.events.on('damage.dealt', ({ req }) => { if (req.source === lead.health && req.sourceTags.includes('dmg.ranged')) arrows.push(req.amount); }, host.scope);
    for (let tick = 0; tick < 60; tick++) live.step([]);
    let target: AnimalSim | undefined;
    const prey = (): AnimalSim => {
      if (target?.alive === true) return target;
      target = [...host.entities.values()].find(actor => actor.alive && actor.kind === 'leopard');
      if (target === undefined) throw new Error('Nalati has no prey to shoot');
      return target;
    };
    // Hold the player in the grass facing -z, and the prey 3 m ahead, so every arrow flies the same short line. The prey is a
    // lone leopard: a herd horse shot at 3 m would be a fully aware threat, and no one is Hidden in front of one.
    const hold = (): void => {
      const feet = host.groundHeightAt(GRASS.x, GRASS.z);
      lead.resetPose({ x: GRASS.x, y: feet + 0.05, z: GRASS.z }, 0);
      prey().place(GRASS.x, GRASS.z - RANGE, 0);
    };
    const pitch = (): number => { const body = prey().position; return Math.atan2(body.y + 0.9 - (lead.position.y + 1.68), RANGE); };
    const command = (fields: { crouch?: boolean; draw?: boolean }): HeadlessCommand => ({ kind: 'player', moveX: 0, moveZ: 0, yaw: 0, commandVersion: 1, pitch: pitch(),
      steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, ...(fields.crouch === true ? { crouch: true } : {}), ...(fields.draw === true ? { heavy: {} } : {}) });
    const tick = (fields: { crouch?: boolean; draw?: boolean }): void => { hold(); live.step([command(fields)]); };
    const shoot = (crouch: boolean): number => {
      const before = arrows.length;
      for (let t = 0; t < 70; t++) tick({ crouch, draw: true });
      for (let t = 0; t < 30 && arrows.length === before; t++) tick({ crouch });
      expect(arrows.length, 'the arrow struck the prey').toBe(before + 1);
      return arrows[before] ?? 0;
    };
    const scale = v.parse(HeldBowFileSchema, await product.json('weapons/bow-page.json')).base.damageScale;
    const body = (multiplier: number): [number, number] => [Math.floor(DAMAGE.bodyMin * scale * multiplier) - 1, Math.ceil(DAMAGE.bodyMax * scale * multiplier) + 1];
    const plain = shoot(false);
    expect(plain, 'a standing shot lands plain').toBeGreaterThanOrEqual(body(1)[0]);
    expect(plain).toBeLessThanOrEqual(body(1)[1]);
    // Crouch in the grass until the server's own law says Hidden (the native stealth proof takes 180 ticks).
    for (let t = 0; t < 240; t++) tick({ crouch: true });
    const sneak = shoot(true);
    expect(sneak, 'a shot from Hidden lands at ×2 on the server').toBeGreaterThanOrEqual(body(2)[0]);
    expect(sneak).toBeLessThanOrEqual(body(2)[1]);
    const seat = nativeStealthOf(host)?.of(lead);
    if (seat === undefined) throw new Error('The room has no server stealth');
    expect(seat.sneakMultiplier(), 'the sneak window is open').toBe(2);
    for (let t = 0; t < 4 * 60 + 6; t++) tick({});
    expect(seat.sneakMultiplier(), 'and shut 4 s after the shot').toBe(1);
    const after = shoot(false);
    expect(after, 'a standing shot after the window lands plain').toBeLessThanOrEqual(body(1)[1]);
  } finally { live.dispose(); }
});

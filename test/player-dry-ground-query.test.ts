// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped player against native Rapier.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups } from '../src/shared/engine/physics/groups';
import { Player } from '../src/client/engine/player/Player';

async function fixture(surface: number | null) {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), physics = new Physics(R);
  physics.world.createCollider(R.ColliderDesc.cuboid(20, .5, 20).setTranslation(0, -.5, 0).setCollisionGroups(groups('WORLD')));
  const player = new Player(new PerspectiveCamera(), physics, document.createElement('canvas'), {
    waterLine: { update: () => undefined, setHint: () => undefined },
  });
  const heightAt = vi.fn(() => 0), waterSurfaceAt = vi.fn(() => surface);
  player.motor.resetAt(player.position);
  player.bindFrame(physics, player.motor, { heightAt, waterSurfaceAt, platforms: [] });
  const release = (): void => { player.motor.dispose(); physics.dispose(); };
  return { player, physics, heightAt, waterSurfaceAt, release };
}

test('native dry walking keeps grounding without sampling an unused water floor', async () => {
  const f = await fixture(null);
  try {
    const command = f.player.sampleCommand();
    for (let tick = 0; tick < 120; tick++) { f.physics.step(); f.player.step(1 / 60, { ...command, steer: { ...command.steer, stickY: 1 } }); }
    expect(f.player.onGround).toBe(true); expect(Math.abs(f.player.position.y)).toBeLessThan(.1);
    expect(f.player.position.z).toBeLessThan(-1);
    expect(f.player.waterSurface).toBeNull(); expect(f.player.depth).toBe(0);
    expect(f.waterSurfaceAt).toHaveBeenCalledTimes(120);
    expect(f.heightAt).not.toHaveBeenCalled();
  } finally { f.release(); }
});

test.each([.2, 3])('native water entry retains its required ground query (surface %s)', async surface => {
  const f = await fixture(surface);
  try {
    f.physics.step(); f.player.step(1 / 60, f.player.sampleCommand());
    expect(f.heightAt).toHaveBeenCalledTimes(1);
    expect(f.player.waterSurface).toBe(surface); expect(f.player.depth).toBeGreaterThan(0);
    expect(f.player.swimming).toBe(surface === 3);
    expect(f.player.wading).toBe(surface === .2);
  } finally { f.release(); }
});

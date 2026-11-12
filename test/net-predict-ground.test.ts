// @vitest-environment node
// NET-LAG NL10 (meta docs/plans/NET-LAG-PLAN.md): a declared page predicts its own feet on the ground the server walks. Signal
// Dunes' server stands on the shard's 257² baked collider; the page stood on a 256² lattice sampled from it, centimetres off on
// every dune, so nearly every acked step corrected (125 to 214 corrections in 22 s on staging).
// oxlint-disable-next-line import/no-nodejs-modules -- Read the built product and the shipped native Wasm.
import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { clientPageGround } from '../src/shared/game/shardfile/clientGround';
import { admittedTerrain } from '../src/server/game/plugin/simulation';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { addLevelTerrain } from '../src/shared/engine/physics/terrain';
import { addBakedTerrainCollider } from '../src/shared/engine/physics/terrainTiles';
import { CharacterMotor, PLAYER_BODY } from '../src/shared/engine/physics/CharacterMotor';
import { bindHeightfield, HeightfieldBinding } from '../src/shared/engine/world/Heightfield';
import { Scope } from '../src/shared/engine/app/scope';
import { configureLevel } from '../src/shared/engine/level/selection';
import type { LevelSpec } from '../src/shared/engine/level/spec';

const disposers: (() => void)[] = [];
afterAll(() => { for (const dispose of disposers.reverse()) dispose(); });

test('Signal Dunes: the page predicts on the server\'s ground, sample for sample', { timeout: 60_000 }, async () => {
  const directory = builtProduct('sunscar-dunes'), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === undefined) throw new Error('Missing native product descriptor');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))] as const));
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  // The server: the admitted collider, as `prepareRuntimeWorld` installs it (addBakedWorld).
  const server = new Physics(R), scope = new Scope('nl10');
  disposers.push(() => { server.dispose(); });
  addBakedTerrainCollider(server, admittedTerrain(shard, assets).bytes, scope);
  // The page: its declared ground, bound as the page binds it, and its level terrain collider as bootstrap and the grid add it.
  const ground = clientPageGround(shard, assets), page = new Physics(R);
  disposers.push(() => { page.dispose(); });
  // bound as the page binds it, so the test also holds if the page ever falls back to sampling the heightfield
  const level = { id: shard.identity.slug, ground } as unknown as LevelSpec;
  configureLevel(level);
  disposers.push(bindHeightfield(new HeightfieldBinding(level)));
  addLevelTerrain(page, ground.collider);
  server.step(); page.step();
  // Ground under a lattice of points across the walkable middle (spawn is at the centre): the two must agree to a millimetre.
  let worst = 0, at = '';
  for (let z = -60; z <= 60; z += 0.73) for (let x = -60; x <= 60; x += 0.91) {
    const ys = [server, page].map(({ world }) => { const hit = world.castRay(new R.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 }), 500, true); return hit === null ? Number.NaN : 200 - hit.timeOfImpact; });
    const gap = Math.abs((ys[0] ?? 0) - (ys[1] ?? 0));
    if (!(gap <= worst)) { worst = gap; at = `${x.toFixed(2)},${z.toFixed(2)} server ${ys[0]?.toFixed(4)} page ${ys[1]?.toFixed(4)}`; }
  }
  expect(worst, at).toBeLessThanOrEqual(0.001);
  // The same command list walked on both: feet within a millimetre after every step.
  const options = { radius: .38, height: 1.7, step: .35, maxClimbDeg: 40, snap: .3, ...PLAYER_BODY };
  const motors = [new CharacterMotor(server, options), new CharacterMotor(page, options)];
  disposers.push(() => { for (const motor of motors) motor.dispose(); });
  const feet = [{ x: -0.5, y: 19, z: 0 }, { x: -0.5, y: 19, z: 0 }];
  for (const [index, motor] of motors.entries()) motor.resetAt(feet[index] ?? { x: 0, y: 0, z: 0 });
  let drift = 0;
  for (let tick = 0; tick < 1200; tick++) {
    const want = { x: Math.sin(tick * .011) * .08, y: -.05, z: -.09 * Math.cos(tick * .004) };
    for (const [index, motor] of motors.entries()) { const point = feet[index] ?? { x: 0, y: 0, z: 0 }; [server, page][index]?.step(); motor.move(point, want); }
    drift = Math.max(drift, Math.hypot((feet[0]?.x ?? 0) - (feet[1]?.x ?? 0), (feet[0]?.y ?? 0) - (feet[1]?.y ?? 0), (feet[0]?.z ?? 0) - (feet[1]?.z ?? 0)));
  }
  expect(drift).toBeLessThanOrEqual(0.001);
});

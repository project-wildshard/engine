// oxlint-disable-next-line import/no-nodejs-modules -- The movers run on the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';
import type { MoverPose } from '../src/shared/engine/physics/mover';
import { installFollowedMovers } from '../src/client/game/plugin/followedMovers';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';

// GRID-CROSSING GC30b (preview 1b2f1ac8, Driftwood to Far Reach): "proof.worker.present: null pointer passed to rust". A cell's
// movers lend the wire their views (`wirePage.movers`), and the cell's scope frees their bodies when it goes, but the views
// stayed: the next `script:` row with that id (`NetMovers.frame`) posed a freed Rapier body (`KinematicMover.setPose`). A cell's
// views leave with it, and a cell that goes never takes another cell's view of the same id with it.

type Install = Parameters<typeof installFollowedMovers>;
const BOAT = 'driftwood.boat';
afterEach(() => { wirePage.movers.clear(); });

async function cell(physics: Physics, name: string): Promise<{ scope: Scope; install: () => void }> {
  const shard = (await loadHeadlessProduct(builtProduct('driftwood-isle'))).shardfile, row = shard.movers.find(mover => mover.id === BOAT);
  if (row === undefined) throw new Error('Driftwood\'s boat is no longer a mover');
  const scope = new Scope(name), ctx = { scope, debug: { expose: () => undefined } } as unknown as Install[0];
  const world = { physics, player: { carried: false } } as unknown as Install[1];
  return { scope, install: () => { installFollowedMovers(ctx, world, { data: [row], systemId: name }); } };
}

test('a cell that goes takes its mover views off the wire, and no other cell\'s', { timeout: 60_000 }, async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const first = await cell(new Physics(rapier), 'first');
  first.install();
  const pose: MoverPose = { position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 }, enabled: true };
  wirePage.movers.get(BOAT)?.pose(pose, {});
  first.scope.dispose();
  // what NetMovers.frame does with the next row: before, this posed the freed body
  expect(() => { wirePage.movers.get(BOAT)?.pose(pose, {}); }).not.toThrow();
  expect(wirePage.movers.has(BOAT)).toBe(false);

  // two cells name the same mover: the one that goes first leaves the other's view
  const a = await cell(new Physics(rapier), 'a'), b = await cell(new Physics(rapier), 'b');
  a.install(); b.install();
  const view = wirePage.movers.get(BOAT);
  a.scope.dispose();
  expect(wirePage.movers.get(BOAT)).toBe(view);
  expect(() => { view?.pose(pose, {}); }).not.toThrow();
  b.scope.dispose();
  expect(wirePage.movers.has(BOAT)).toBe(false);
});

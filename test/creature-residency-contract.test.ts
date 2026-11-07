import { installKitSpecies } from '../src/client/game/systems/species/install';
import { installWorldRegistry } from '@wildshard/engine/world/registry';
import { afterEach, expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { Rng } from '@wildshard/engine/core/rng';
import { pinBrain } from '@wildshard/engine/ai/pinning';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { followRing } from '../src/client/game/shardfile/tileDriver';
import { manager } from '@wildshard/engine/test/manager';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';

installWorldRegistry();
installKitSpecies();

const cleanup: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const stop of cleanup.splice(0).reverse()) stop(); });

function fixture() {
  cleanup.push(bindFlatTerrain({ heightAt: () => 0, normalAt: () => [0, 1, 0], waterLevel: () => -100 }));
  const scope = new Scope('creature-residency-contract'); cleanup.push(() => { scope.dispose(); });
  scope.expose(app, 'levelScope', scope); scope.expose(app, 'physics', null);
  const f = scope.run(() => manager()); cleanup.push(() => { f.game.playerScope.dispose(); });
  const animal = scope.run(() => f.manager.spawn('bear', 0, 200, 0, 'brown', { y: 0 }));
  f.manager.setResidency(followRing());
  return { ...f, animal, scope, step: (dt = .1, viewer = f.player.position): void => {
    scope.run(() => { f.manager.update(dt, 1, f.player.position, false, viewer); });
  } };
}

test('dormancy preserves exact actor and RNG continuation without retiring its identity', () => {
  const f = fixture(), actor = JSON.stringify(f.animal.snapshot()), shared = app.rng.snapshot();
  const rng: unknown = Reflect.get(f.manager, 'rng');
  if (!(rng instanceof Rng)) throw new Error('Missing original population RNG');
  const population = rng.snapshot(), retire = vi.spyOn(f.manager, 'retire'), pose = vi.spyOn(f.animal, 'update');
  const decisions = vi.spyOn(f.manager.scheduler, 'takeBrainDt'), bodies = vi.spyOn(f.manager.scheduler, 'bodyDt');
  for (let frame = 0; frame < 120; frame++) f.step();
  expect(JSON.stringify(f.animal.snapshot())).toBe(actor);
  expect(rng.snapshot()).toEqual(population); expect(app.rng.snapshot()).toEqual(shared);
  expect(retire).not.toHaveBeenCalled(); expect(pose).not.toHaveBeenCalled();
  expect(decisions).not.toHaveBeenCalled(); expect(bodies).not.toHaveBeenCalled();
  expect(f.manager.animals).toEqual([f.animal]); expect(f.animal.mesh.parent).toBe(f.manager.group);
  expect(f.animal.mesh.visible).toBe(false); expect(f.animal.mesh.castShadow).toBe(false);
});

test('residency follows the actor current position and the player, independently of the draw camera', () => {
  const f = fixture(), decisions = vi.spyOn(f.manager.scheduler, 'takeBrainDt').mockReturnValue(0);
  vi.spyOn(f.manager.scheduler, 'bodyDt').mockReturnValue(0);
  f.step(.1, new Vector3(0, 0, 200)); expect(decisions).not.toHaveBeenCalled();
  f.animal.position.z = 0;
  f.step(); expect(decisions).toHaveBeenCalledExactlyOnceWith(expect.any(String), f.animal);
  expect(f.animal.mesh.visible).toBe(true);
  decisions.mockClear(); f.animal.position.z = 200;
  f.step(); expect(decisions).not.toHaveBeenCalled(); expect(f.animal.mesh.visible).toBe(false);
  f.player.position.z = 200;
  f.step(); expect(decisions).toHaveBeenCalledExactlyOnceWith(expect.any(String), f.animal);
  expect(f.animal.mesh.visible).toBe(true); expect(f.manager.animals[0]).toBe(f.animal);
});

test('clearing residency restores whole-world scheduling without respawning the actor', () => {
  const f = fixture(), decisions = vi.spyOn(f.manager.scheduler, 'takeBrainDt').mockReturnValue(0);
  vi.spyOn(f.manager.scheduler, 'bodyDt').mockReturnValue(0);
  f.step(); expect(decisions).not.toHaveBeenCalled();
  f.manager.setResidency(null); f.step(.1, f.animal.position);
  expect(decisions).toHaveBeenCalledExactlyOnceWith(expect.any(String), f.animal);
  expect(f.animal.mesh.visible).toBe(true); expect(f.manager.animals[0]).toBe(f.animal);
});

test.each(['drawPinned', 'driven', 'brain', 'harnessHold', 'simulationBound'] as const)(
  'outside-ring %s retains its existing scheduler and presentation exception', exception => {
    const f = fixture();
    const engagement = f.scope.child('engagement');
    if (exception === 'brain') pinBrain(f.animal, engagement);
    else if (exception === 'simulationBound') {
      const saved = f.animal.snapshot();
      const core = new AnimalSim({ kind: saved.kind, label: saved.label, variant: saved.variant, rarity: saved.rarity,
        hp: saved.motion.maxHp, aggressive: saved.flags.aggressive, dims: f.animal.dims, mods: saved.mods }, saved.motion.seed, saved.motion.scale,
      f.animal.entityId, { heightAt: () => 0, random: () => .5 });
      core.restore(saved); f.animal.bindSimulation(core);
      const step = vi.spyOn(core, 'step'), before = JSON.stringify(core.snapshot());
      const decisions = vi.spyOn(f.manager.scheduler, 'takeBrainDt');
      f.step(.1, f.animal.position);
      expect(decisions).not.toHaveBeenCalled(); expect(step).not.toHaveBeenCalled();
      expect(JSON.stringify(core.snapshot())).toBe(before); expect(f.animal.mesh.visible).toBe(true);
      return;
    } else f.animal[exception] = true;
    const decisions = vi.spyOn(f.manager.scheduler, 'takeBrainDt').mockReturnValue(0);
    const bodies = vi.spyOn(f.manager.scheduler, 'bodyDt').mockReturnValue(0);
    f.step(.1, f.animal.position);
    expect(decisions.mock.calls.length).toBe(exception === 'harnessHold' ? 0 : 1);
    expect(bodies.mock.calls.length).toBe(exception === 'harnessHold' ? 0 : 1);
    expect(f.animal.mesh.visible).toBe(true);
    if (exception === 'brain') {
      engagement.dispose(); decisions.mockClear(); bodies.mockClear();
      f.step(.1, f.animal.position);
      expect(decisions).not.toHaveBeenCalled(); expect(bodies).not.toHaveBeenCalled();
      expect(f.animal.mesh.visible).toBe(false);
    }
  });

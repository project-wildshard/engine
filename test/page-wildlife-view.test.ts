import { expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { app } from '../src/client/engine/app/runtime';
import { Scope } from '../src/shared/engine/app/scope';
import type { AnimalManager } from '../src/server/engine/entities/AnimalManager';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import { PageWildlifeView } from '../src/client/game/population/wildlifeFeature';
import { pageAir } from '../src/client/game/population/pageAir';
import { CrowdTargets } from '../src/shared/game/shardfile/crowdRuntime';
import { FlockBrain } from '../src/shared/engine/ai/flock';
import { parseFlock } from '@wildshard/format/crowds';
import { NALATI_HEADLESS_ASSEMBLY as headlessAssembly } from './fixtures/nalati-headless-assembly';
import { lendNalatiPasture } from './fixtures/nalati-return-modules';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';


const source = headlessAssembly.constants.pageWildlife, kinds = source.kinds;
const body = (kind: string, x: number, z: number, alive = true): Animal => legacyDouble<Animal>({ kind, alive, position: new Vector3(x, 0, z), speed: 0, scale: 1, yaw: 0 });

const crowd = (x: number, z: number, count: number, range: number, seed: number): CrowdTargets => {
  const controller = new FlockBrain({ heightAt: () => 0, normalY: () => 1, inBounds: () => true, wetAt: () => false, playerCrouched: () => false,
    grassHeightAt: () => .5, trample: () => undefined, centre: () => undefined }, parseFlock({ id: 'orchard.crowd', kind: 'flock', x, z, count, range, seed, runSpeed: 4, walkSpeed: 1, grazeStep: .2, bleatCue: 'bleat' }));
  controller.initialize(); return new CrowdTargets(controller, { preyY: .5, hits: [[0, .5, .4]] });
};

test('a page keeps the crowds it draws and reads its wild off rows, spawning nobody', () => {
  const scope = new Scope('wildlife.view'); scope.expose(app, 'levelScope', scope); lendNalatiPasture(scope);
  const spawn = vi.fn(), rows = { ...source, packs: [], herds: [], mountables: [], foragers: null,
    flocks: [{ x: 4, z: 4, count: 24, dog: true, range: 12 }] };
  const near = body(kinds.guardian, 5, 4), far = body(kinds.guardian, 400, 400), wolf = body(kinds.predator, 9, 9), gone = body(kinds.predator, 1, 1, false);
  const animals = legacyDouble<AnimalManager>({ spawn, animals: [far, near, wolf, gone],
    factory: legacyDouble<AnimalManager['factory']>({ *prepareSteps() { yield 0; } }) });
  try {
    const view = new PageWildlifeView<CrowdTargets>(animals, rows, scope), steps = view.buildSteps();
    expect(steps.next().value).toEqual({ kind: 'pause' });
    const step = steps.next().value; if (step?.kind !== 'crowd') throw new Error('Missing crowd step');
    const flock = crowd(step.options.x, step.options.z, step.options.count, step.options.range, step.options.seed), scared = vi.spyOn(flock, 'scare');
    view.attachCrowd(step.index, flock); expect(steps.next().done).toBe(true);
    expect(() => { view.attachCrowd(1, flock); }).toThrow('Invalid population crowd binding');
    expect(spawn).not.toHaveBeenCalled(); expect(view.mountables).toEqual([]); expect(view.packs).toEqual([]); expect(view.herds).toEqual([]);
    expect(view.rowGuardian(0)).toBe(near); expect(view.rowGuardian(1)).toBeNull();
    view.beginFrame(.1, { position: new Vector3(), forward: new Vector3(0, 0, -1), crouching: true }, { mounted: true });
    expect(view.predators).toHaveLength(1); expect(view.predators[0]).toBe(wolf); expect(pageAir.playerCrouched).toBe(true); expect(pageAir.playerMounted).toBe(true);
    view.disturb(4, 4); expect(scared).toHaveBeenCalledOnce();
    view.disturb(100000, 100000); expect(scared).toHaveBeenCalledOnce();
  } finally { scope.dispose(); }
});

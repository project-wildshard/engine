import { Rng } from '../../src/shared/engine/core/rng';
import type { MixedPopulationInput } from '@wildshard/engine/game/population/mixedRoster';
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { SIM_LEVEL } from './sim-level/level';
import { DRIFTWOOD_SPECIES_PROGRAMS } from '../../src/shards/driftwood-isle/generators/speciesPrograms';
import { RETURN_PROGRAM } from './driftwood-guest-programs';
import { enemyPlacements } from '../../src/shards/driftwood-isle/generators/enemyPlacement';
import { keeperRows } from '../../src/shards/driftwood-isle/generators/keeperRows';
import source from '../../src/shards/driftwood-isle/data/mixedPopulation.json' with { type: 'json' };

/** An unrelated orchard population uses one practice animal and a reserved
 * guardian, a different roster bound, floor, return gate and empty pose clips. */
export function orchardPopulation(extra?: { readonly id: string; readonly x: number; readonly z: number; readonly seed: number }): MixedPopulationInput {
  const sample = SIM_LEVEL.entities[0], native = DRIFTWOOD_SPECIES_PROGRAMS.native[0], guard = DRIFTWOOD_SPECIES_PROGRAMS.program.species.find(row => row.kind === 'crab');
  if (sample === undefined || native === undefined || guard === undefined) throw new Error('Missing fixture species');
  const kind = 'orchard-hog', guardian = 'orchard-guard', spec = { ...sample.spec, kind }, guardSpec = { ...sample.spec, kind: guardian }, stream = new Rng(40).snapshot();
  const placement = enemyPlacements(), sourceKeeper = keeperRows(placement, RETURN_PROGRAM);
  const pose = { custom: true, joints: [
    { name: 'body', parent: -1, position: [0, 1, 0], order: 'YXZ', scale: [1, 1, 1] },
    { name: 'head', parent: 0, position: [0, 1, 0], order: 'YXZ', scale: [1, 1, 1] },
  ] } as const;
  return { rows: { ...source, step: 'orchard.population', limit: 8, hunted: [kind], floorKinds: [],
    reserve: { kind: guardian, variant: spec.variant, scale: [1, 1], legacyMemory: [] }, poses: [{ kind, clips: [] }, { kind: guardian, clips: [] }],
    practice: { at: { x: 2, z: 3 }, fade: .1, delay: .2, away: 5 } },
    population: readSpeciesPrograms({ ...DRIFTWOOD_SPECIES_PROGRAMS, native: [{ ...native, kind }], page: [],
      program: { ...DRIFTWOOD_SPECIES_PROGRAMS.program, species: [{ ...guard, kind: guardian }] },
      hunt: { limit: 8, player: 'host', fight: {}, bands: { states: [], legacyKinds: [] }, hit: { namespace: 'creature', tags: [] } } }),
    keeper: { ...sourceKeeper, seed: 9,
      environment: { ...sourceKeeper.environment, id: 'orchard.ground', seed: 9, chunkHalf: 16, water: -10, sea: false },
      variants: [{ kind, rows: [{ id: spec.variant, scale: [1, 1] }] }], herds: [{ kind, x: 2, z: 3 }],
      bodies: [{ id: 'creature:0', kind, variant: spec.variant, herd: 0, x: 2, z: 3, yaw: 0, seed: 7, scale: 1, fauna: true, practice: true, stream: null },
        ...(extra === undefined ? [] : [{ ...extra, kind, variant: spec.variant, herd: 0, yaw: 0, scale: 1, fauna: true, practice: false, stream: null }])],
      fauna: { seed: 9, centres: [[2, 3]], rows: [{ id: 'creature:0', herd: 0, seed: 7, x: 2, z: 3, yaw: 0, stream }, ...(extra === undefined ? [] : [{ ...extra, herd: 0, yaw: 0, stream }])], stream },
      ecology: { ...sourceKeeper.ecology, rules: {}, fixed: [], limit: 8, water: -10 } },
    bake: { ground: { heights: new Float32Array(4), scale: { x: 32 } }, actors: [{ kind, variant: spec.variant, pose }], herds: [{}],
      habitat: { perches: [], perchBases: [], hold: { x: 0, z: 0, r: 1, guardR: 1, step: 1, floor: Array.from({ length: 9 }, () => null) } } },
    reserved: { pose, pool: { x: 5, z: 6, yaw: 0 } }, specs: new Map([[`${kind}.${spec.variant}`, spec], [`${guardian}.${spec.variant}`, guardSpec]]), fauna: new Map([[kind, { ...native, kind }]]),
    placement: { seed: 9, native: { stream } }, perchProgram: RETURN_PROGRAM, launch: { kind: 'target', speed: 9, time: [.8, 1.5], gravity: 9.81, rotation: [1, .7, 0] },
    seed: 9, waterLevel: -10, spawnY: 0, nav: null };
}

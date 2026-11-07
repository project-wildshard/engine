// CI12 Nalati ghost riders: a directed species bound on the native population (NativePopulation.bindSpecies) decides
// through its DirectedLaw exactly as the page's binding does on the same inputs, scales its hits by it, needs no elite
// brain, and binding alone leaves the native population, its roster and its random streams untouched.
// oxlint-disable-next-line import/no-nodejs-modules -- The native comparison uses the unchanged shipped physics bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { SpeciesActorsFileSchema } from '@wildshard/format/speciesBookRows';
import { nativePopulationOf } from '../src/server/game/riding/nativePopulation';
import { DirectedLaw } from '../src/server/game/population/directedLaw';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { ThinkCtx } from '../src/shared/engine/entities/species/registry';
import type { DamageRequest } from '../src/shared/engine/combat/pipeline';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { builtProduct } from './fixtures/builtProduct';
import { createNativeProofResident } from './fixtures/headless-native';
import { prepareNalatiWorld } from './fixtures/nalati-world';
import { readPatrolIntake } from '../src/server/game/boss/patrolNative';
import { canonicalSimDigest } from './fake/simState';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

test('a bound ghost rider decides and scales hits through its law natively, and binding alone changes nothing', async () => {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === undefined) throw new Error('Missing admitted native inventory');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const input = await readPatrolIntake(product, {rows:'combat/timed-encounters.json',actors:'actors/sheep.json'}), book = v.parse(SpeciesActorsFileSchema, await product.json<unknown>('actors/sheep.json')).species.lookBook;
  const row = book.rows.find(candidate => candidate.metadata.kind === 'ghost-rider'), recipe = row?.directed;
  if (recipe === undefined || book.program === undefined) throw new Error('Missing the ghost riders\' directed recipe');
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), preparation = { shard, assets, rapier, product };
  const make = () => createNativeProofResident(preparation, context => prepareNalatiWorld(context, input));
  const plain = await make(), bound = await make();
  try {
    const plainPopulation = nativePopulationOf(plain.host), population = nativePopulationOf(bound.host);
    if (plainPopulation === undefined || population === undefined) throw new Error('Missing native populations');
    const law = new DirectedLaw(recipe, () => ReturnProgram.native(bound.host, book.program));
    population.bindSpecies('ghost-rider', law);
    // binding alone: the same population, roster and random streams, tick by tick
    for (let tick = 0; tick < 60; tick++) {
      plain.step([]); bound.step([]);
      expect(bound.host.rng.snapshot()).toEqual(plain.host.rng.snapshot());
    }
    expect(canonicalSimDigest(snapshotSimHost(bound.host))).toBe(canonicalSimDigest(snapshotSimHost(plain.host)));
    // a rider, its target and the player written into its memory as the patrol director does
    const p = leadPlayer(bound.host).position, variant = input.recipes[0]?.variant ?? 'rider';
    const rider = population.spawnElite('ghost-rider', p.x + 14, p.z + 9, 1.2, variant);
    const decisions: { inputs: { x: number; z: number; yaw: number; mem: Record<string, number>; t: number; player: Vector3 }; motion: number[]; state: string; look: number }[] = [];
    const decide = law.decide.bind(law);
    law.decide = (actor, context) => {
      const inputs = { x: actor.position.x, z: actor.position.z, yaw: actor.yaw, mem: { ...actor.mem }, t: context.t, player: new Vector3(context.player.x, context.player.y, context.player.z) };
      let motion: number[] = [];
      const setMotion = actor.setMotion; actor.setMotion = (yaw, speed, turn) => { motion = [yaw, speed, turn ?? 1]; setMotion.call(actor, yaw, speed, turn); };
      try { decide(actor, context); } finally { actor.setMotion = setMotion; }
      if (motion.length > 0) decisions.push({ inputs, motion, state: actor.state, look: actor.lookWeight });
    };
    for (let tick = 0; tick < 90; tick++) {
      rider.mem['tx'] = p.x + Math.sin(tick / 15) * 20; rider.mem['tz'] = p.z - 6; rider.mem['px'] = p.x; rider.mem['pz'] = p.z;
      bound.step([]);
    }
    // it decided through the law at its cadence (no elite brain was asked for), and each decision is the page's
    expect(decisions.length).toBeGreaterThan(10);
    const page = new DirectedLaw(recipe, () => ReturnProgram.native(bound.host, book.program)).binding;
    for (const d of decisions) {
      let motion: number[] = [];
      const twin = legacyDouble<Animal>({ position: new Vector3(d.inputs.x, 0, d.inputs.z), yaw: d.inputs.yaw, state: 'idle', mem: { ...d.inputs.mem, directedThinkAt: Number.NEGATIVE_INFINITY },
        lookTarget: new Vector3(), lookWeight: 0, setMotion: (yaw: number, speed: number, turn?: number) => { motion = [yaw, speed, turn ?? 1]; } });
      delete twin.mem['directedThinkAt'];
      page.think?.(twin, legacyDouble<ThinkCtx>({ t: d.inputs.t, player: d.inputs.player }));
      expect(motion).toEqual(d.motion); expect(twin.lookWeight).toBe(d.look);
    }
    // its hits scale by the law (the recipe's elite factor is 1 with no elite damage bound, as on the page)
    const scale = rider.combatActor().damageMul;
    if (scale === undefined) throw new Error('The bound rider does not scale hits');
    for (const at of [new Vector3(p.x, 0, p.z), new Vector3(p.x + 3, 0, p.z), new Vector3(p.x + 9, 0, p.z + 2)]) {
      expect(scale(legacyDouble<DamageRequest>({ point: at }))).toBe(law.damageScale(rider.mem, at));
    }
  } finally { bound.dispose(); plain.dispose(); }
}, 60_000);

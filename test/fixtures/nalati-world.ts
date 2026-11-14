import * as v from 'valibot';
import { PopulationFieldSchema } from '@wildshard/format/populationEnvironment';
import type { BakedGrid } from '@wildshard/format/bakedTerrainBytes';
import type { SimHost } from '../../src/server/engine/sim';
import { NativePopulationField } from '@wildshard/engine/game/population/environment';
import { installMountedPlayer } from '@wildshard/engine/game/riding/native';
import { prepareFolderRuntimePlan } from '../../src/server/game/shardfile/nativePlan';
import type { NativeAssemblyPorts } from '../../src/server/game/shardfile/nativeAssemblyInput';
import type { ShardFolder } from '../../src/shared/game/shardfile/shardFolder';
import { headlessAssemblyPorts, type HeadlessRuntimeInstallation, type HeadlessRuntimePlan, type PrepareHeadlessRuntime } from '../../src/server/host/headlessRuntime';
import { withEncounters, type EncounterIntake } from '../../src/server/game/population/encounterIntake';

/** A proof's loans over the product's own world. */
export type NalatiWorldLoans = Pick<NativeAssemblyPorts<HeadlessRuntimeInstallation>, 'pastureCues' | 'observeWeather' | 'observeBindings'>;

/** The world Nalati's product builds, with a proof's encounter species and loans over it. */
export type NalatiEncounterIntake = EncounterIntake;
export async function prepareNalatiWorld(preparation: Parameters<PrepareHeadlessRuntime>[0], encounters?: EncounterIntake, loans: NalatiWorldLoans = {}): Promise<HeadlessRuntimePlan> {
  const product = encounters === undefined ? preparation.product : await withEncounters(preparation.product, encounters);
  return prepareFolderRuntimePlan(product, preparation.assets, { ...headlessAssemblyPorts(preparation.rapier), ...loans });
}

/** Read the original named masks once before either direct native owner consumes them. */
export async function prepareNalatiPopulation(product: Pick<ShardFolder, 'file'>, grid: BakedGrid,
  constants: { readonly nativeField: unknown }, bake: { readonly trees: readonly (readonly [number, number, number])[]; readonly tops: readonly number[] }) {
  const pond = { file: 'data/geography-pond.bin', bytes: await product.file('data/geography-pond.bin') };
  const input = constants.nativeField, rows = v.parse(PopulationFieldSchema, input), wet = rows.world.wet;
  const wetFile = typeof wet === 'string' || typeof wet.data === 'string' ? undefined : wet.data.file;
  const wetBlock = wetFile === undefined ? undefined : { file: wetFile, bytes: await product.file(wetFile) };
  const field = new NativePopulationField(grid, input, bake.trees, bake.tops, pond, wetBlock);
  return { field, installMounted: (host: SimHost, profile: unknown) => installMountedPlayer(host, profile, pond, wetBlock) };
}

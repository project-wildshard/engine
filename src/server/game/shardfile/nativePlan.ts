import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { prepareRuntimePlan, type NativeRuntimeRecipe } from '../plugin/simulation';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { outputDescriptor, serverReadsFile } from '../../../shared/game/shardfile/outputDescriptor';
import { hasNativeAssembly, prepareNativeAssembly, type NativeAssemblyRuntime } from './nativeAssembly';
import type { NativeAssemblyContext, NativeAssemblyPorts } from './nativeAssemblyInput';

/** Select the native interpreter from the built product: its server-class native assembly (P1-E3.1b) when it ships
 * one, else `sim/runtime-plan`'s held-melee. No source entry, module URL, shard callback or fallback participates in
 * this boundary. */
export async function prepareFolderRuntimePlan<C extends NativeAssemblyContext>(product: ShardFolder, assets: ReadonlyMap<string, Uint8Array>, ports?: NativeAssemblyPorts<C>): Promise<NativeAssemblyRuntime<C> | Awaited<ReturnType<typeof prepareRuntimePlan>>> {
  if (hasNativeAssembly(product)) {
    if (ports === undefined) throw new Error('A native assembly needs its server ports');
    return prepareNativeAssembly(product, assets, ports);
  }
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Native plan requires a verified built output');
  const declaration = parseNativeRuntimePlan(product.section('sim/runtime-plan'));
  const recipe: NativeRuntimeRecipe = declaration.recipe;
  const admitted = new Map(assets);
  for (const file of descriptor.index.files) {
    const ref = file.commons === true ? `commons:${file.hash}` : file.hash;
    if (admitted.has(ref) || !serverReadsFile(file, product.shardfile.terrain?.collider)) continue;
    if (file.name === undefined) throw new Error('Missing unnamed native plan asset');
    admitted.set(ref, await product.file(file.name));
  }
  return prepareRuntimePlan(product.shardfile, admitted, declaration.baked, recipe, descriptor.sections);
}

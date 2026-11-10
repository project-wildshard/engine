import * as v from 'valibot';
import { NATIVE_ASSEMBLY_FILE, parseNativeAssembly } from '@wildshard/format/nativeAssembly';
import type { ShardProduct } from '../../src/shared/game/shardfile/shardProduct';
import type { PrepareHeadlessRuntime } from '../../src/server/host/headlessRuntime';
import { prepareProductPlan } from './headless-native';
import { registerNativeWalkBounds } from './headless/nativeBounds';

// CI21 (J232): engine's copy reads Nine's walk bounds from the pinned product's own `ui/level` manifest section, not from
// shard source (J65). Same plan, same claw, same bounds as shard-nine-dragon's test/fixtures/nine-headless.ts.
const LevelBounds = v.object({ manifest: v.object({ bounds: v.optional(v.object({
  x0: v.number(), x1: v.number(), z0: v.number(), z1: v.number(), floor: v.number(),
})) }) });

/** Nine's own plan with the claw's rise turned off: the path a lifting crossing used to take. */
async function flatProduct(product: ShardProduct): Promise<ShardProduct> {
  const plan = parseNativeAssembly(await product.json(NATIVE_ASSEMBLY_FILE));
  const bytes = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.map(row => row.host === 'grapple' ? { ...row, rise: false } : row) }));
  return { ...product, file: name => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : product.file(name) };
}

/** The world Nine's product builds, with the walk proofs' bounds lent over it. `rise` false is a negative control. */
export function nineHeadlessRuntime(rise: boolean): PrepareHeadlessRuntime {
  return async preparation => {
    const bounds = v.parse(LevelBounds, preparation.product.section('ui/level')).manifest.bounds;
    if (bounds === undefined) throw new Error('Nine product declares no walk bounds');
    const product = rise ? preparation.product : await flatProduct(preparation.product), plan = await prepareProductPlan({ ...preparation, product });
    return { ...plan, install: (host, context) => { registerNativeWalkBounds(host, bounds); plan.install(host, context); } };
  };
}

/** Current browser winner; the flat factory remains a negative QB17 control. */
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = nineHeadlessRuntime(true);

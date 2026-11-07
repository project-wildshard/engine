import type { ForestPageRows } from '@wildshard/format/forestPage';
import type { ShardContext } from '../plugin/context';
import { readWholeGeometry, type WholeGeometryView } from '../plugin/geometry';
import { productCoverAppearance, type CoverAppearance } from './coverAppearance';

interface ForestGroundInputPorts {
  readonly appearance: typeof productCoverAppearance;
  readonly geometry: typeof readWholeGeometry;
}
const INPUT_PORTS: ForestGroundInputPorts = { appearance: productCoverAppearance, geometry: readWholeGeometry };
type GroundInputs = readonly [PromiseSettledResult<CoverAppearance>, PromiseSettledResult<unknown>, PromiseSettledResult<Map<string, WholeGeometryView>>];

/** Independent verified inputs overlap; all started work drains before the caller
 * validates them in its original appearance/layout/geometry order. Geometry keeps
 * the same construction scope, including its normal cancellation and disposal. */
export async function readForestGroundInputs(ctx: Pick<ShardContext, 'product' | 'scope'>,
  rows: Pick<ForestPageRows['ground'], 'appearance' | 'layout' | 'sources'>,
  ports: ForestGroundInputPorts = INPUT_PORTS): Promise<GroundInputs> {
  if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Forest ground owner is retired');
  const result = await Promise.allSettled([
    ports.appearance(ctx.product, rows.appearance),
    ctx.product.json<unknown>(rows.layout),
    ports.geometry(ctx.scope, ctx.product.shardfile, rows.sources),
  ]);
  if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Forest ground owner is retired');
  return result;
}

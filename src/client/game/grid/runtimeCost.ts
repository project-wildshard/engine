import * as v from 'valibot';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { contentCost, type ContentCostInput } from '@wildshard/format/contentCost';

import { RuntimeCostSchema, RegionalSimCostSchema, runtimeAccountedBytes, type RuntimeCost, type RegionalSimCost } from '@wildshard/format/runtimeCost';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { TRANSFER_WALL_BYTES } from '@wildshard/engine/physics/transferWalls';

/** G188: images-first playing envelope. Grid callers include their current residents; omitted residents retain standalone Auto. */
export function imagesFirstPlayingBytes(input: RuntimeCost | undefined, residents?: Readonly<ContentCostInput>): number | undefined {
  if (input === undefined) return undefined;
  const row = v.parse(RuntimeCostSchema, input);
  const base = residents ?? { l0: 0, l1: 0, far: 0, libraries: 0, commons: 0, sims: 0, overlap: CONTENT_CAPS.overlap };
  return contentCost({ ...base, sims: base.sims + runtimeAccountedBytes(row.imagesFirst ?? row) }).playing;
}

/**
 * The bytes a regional shardfile sim charges: its measured resident reading with the calibration undone once (the allocator
 * applies `residentFactor` again in the predicted total), plus the platform-installed extras the reading did not include,
 * never more than the declared ceiling. Without a reviewed reading the declared ceiling is the charge.
 */
export function regionalSimAccountedBytes(declaredIdentity: string, declaredBytes: number, extraBytes: number, manifest: { readonly slug: string; readonly regionalSimCost?: RegionalSimCost } | undefined): number {
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || !Number.isSafeInteger(extraBytes) || extraBytes < 0) throw new RangeError('Invalid regional sim cost');
  const ceiling = declaredBytes + extraBytes;
  if (manifest?.regionalSimCost === undefined) return ceiling;
  const { slug: registeredIdentity } = manifest;
  if (registeredIdentity !== declaredIdentity) throw new Error('Regional sim measurement differs from its shard');
  const row = v.parse(RegionalSimCostSchema, manifest.regionalSimCost);
  const measured = Math.ceil(row.residentMB * 1_000_000 / CONTENT_CAPS.residentFactor);
  if (!Number.isSafeInteger(measured)) throw new RangeError('Regional sim measurement exceeds safe resident accounting');
  return Math.min(ceiling, measured + extraBytes);
}

/** The ground a data cell with no baked terrain generates (two float heightfields at its edge resolution). */
export function generatedGroundBytes(source: Pick<Shardfile, 'edge' | 'terrain'>): number {
  const resolution = source.edge.north.heights.length === 256 ? 256 : 257;
  return source.terrain === null ? 2 * resolution ** 2 * Float32Array.BYTES_PER_ELEMENT : 0;
}

/** What an entered data cell's region charges: its sim, its generated ground and its transfer walls. An owned data home
 * is admitted at exactly this, so the live grid's initial handoff matches it. */
export function regionalDataCellBytes(slug: string, source: Pick<Shardfile, 'budgets' | 'edge' | 'terrain'>, manifest: Parameters<typeof regionalSimAccountedBytes>[3]): number {
  return regionalSimAccountedBytes(slug, source.budgets.sim.resident + generatedGroundBytes(source) + 4096, TRANSFER_WALL_BYTES, manifest);
}

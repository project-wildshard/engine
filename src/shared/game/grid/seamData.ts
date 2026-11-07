import type { GridEdgeSource } from './edgeProfiles';
import type { CompiledGridSelector } from './compiledStrips';
import { readGridAssetBytes } from './gridAssetBytes';

export interface GridSeamAddress { readonly url: string; readonly bytes: number; readonly sha256: string; readonly geometry?: CompiledGridSelector;
  readonly plans?: { readonly url: string; readonly bytes: number; readonly sha256: string };
  readonly edgeCosts?: { readonly source: string; readonly rows: readonly (readonly [string, number])[] } }
interface GridSeamRows {
  readonly plans: readonly (readonly [string, readonly number[][]])[];
  readonly edges: readonly (readonly [string, Extract<GridEdgeSource, { kind: 'declared' }>])[];
}
interface GridSeamData extends GridSeamRows {
  readonly readPlans?: (read: (url: string) => Promise<Response>) => Promise<GridSeamData['plans']>;
  /** Compiler charges for this exact verified wire only; never a caller-input cache. */
  readonly edgeCosts?: ReadonlyMap<string, number>;
}
const sides = ['north', 'east', 'south', 'west'] as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.every((item: unknown) => typeof item === 'number' && Number.isFinite(item));
const matrix = (value: unknown): value is number[][] => Array.isArray(value) && value.every(numbers);
function observation(value: unknown): boolean {
  return record(value) && typeof value['entryWidth'] === 'number' && Number.isFinite(value['entryWidth'])
    && (value['geometry'] === undefined || value['geometry'] === 'ground' || value['geometry'] === 'void')
    && (value['waterSurface'] === undefined || typeof value['waterSurface'] === 'number' && Number.isFinite(value['waterSurface']))
    && (value['sourceSurface'] === undefined || typeof value['sourceSurface'] === 'string')
    && (value['outflows'] === undefined || Array.isArray(value['outflows']) && value['outflows'].every((row: unknown) => record(row)
      && typeof row['from'] === 'number' && Number.isFinite(row['from']) && typeof row['to'] === 'number' && Number.isFinite(row['to'])));
}
function edge(value: unknown): value is Extract<GridEdgeSource, { kind: 'declared' }> {
  if (!record(value) || value['kind'] !== 'declared' || !record(value['profiles']) || !record(value['observations'])) return false;
  const profiles = value['profiles'], observations = value['observations'];
  return sides.every(side => {
    const row = profiles[side];
    return record(row) && numbers(row['heights']) && matrix(row['colours']) && typeof row['roadHeight'] === 'number' && observation(observations[side]);
  });
}
function data(value: unknown): value is GridSeamRows {
  if (!record(value) || !Array.isArray(value['plans']) || !Array.isArray(value['edges'])) return false;
  const plans = value['plans'], edges = value['edges'];
  return plans.every((row: unknown) => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && matrix(row[1]))
    && edges.every((row: unknown) => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && edge(row[1]));
}

function verifiedCosts(value: unknown, source: string, rows: GridSeamRows): ReadonlyMap<string, number> | undefined {
  if (!record(value) || value['source'] !== source || !Array.isArray(value['rows'])
    || value['rows'].length !== rows.edges.length || value['rows'].length > 512) return undefined;
  const names = new Set(rows.edges.map(([name]) => name));
  if (names.size !== rows.edges.length) return undefined;
  const costs = new Map<string, number>();
  for (const row of value['rows']) {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !names.delete(row[0])
      || typeof row[1] !== 'number' || !Number.isSafeInteger(row[1]) || row[1] < 64) return undefined;
    costs.set(row[0], row[1]);
  }
  return costs;
}

/** No module cache owns the parsed rows. The session consumes them during construction;
 * existing edge and seam certifiers still check every physical profile/lattice. */
export async function readGridSeamData(address: GridSeamAddress, read: (url: string) => Promise<Response>): Promise<GridSeamData> {
  const wire = await readGridAssetBytes(address, read, 'seams');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire));
  if (!data(parsed) || address.plans !== undefined && parsed.plans.length > 0) throw new Error('Invalid grid seam data');
  const edgeCosts = verifiedCosts(address.edgeCosts, address.sha256, parsed);
  const result = { plans: parsed.plans, edges: parsed.edges, ...(edgeCosts === undefined ? {} : { edgeCosts }) };
  if (address.plans === undefined) return result;
  const plans = { ...address.plans };
  return { ...result, readPlans: async fetchPlans => {
    const bytes = await readGridAssetBytes(plans, fetchPlans, 'seam-plans');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data(value) || value.edges.length > 0) throw new Error('Invalid grid seam plans');
    return value.plans;
  } };
}

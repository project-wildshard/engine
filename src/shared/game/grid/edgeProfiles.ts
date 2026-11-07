import { bakedEdgeProfiles, immutableEdgeProfile, type EdgeColour, type EdgeProfiles } from '@wildshard/engine/sim/edgeProfiles';
import type { PlatformCell } from '@wildshard/engine/sim/strips';
import type { GridCell } from './assembly';

/** Physical boundary observations are admitted beside the rows; they cannot invent height at an entry. */
export type GridEdgeObservations = NonNullable<PlatformCell['observations']>;
/** A declared full row or the complete first-party WSTR bake, never an all-zero substitute for missing data. */
export type GridEdgeSource = { readonly kind: 'declared'; readonly profiles: EdgeProfiles; readonly observations: GridEdgeObservations }
  | { readonly kind: 'baked'; readonly bytes: Uint8Array; readonly palette: readonly [EdgeColour, EdgeColour, EdgeColour, EdgeColour]; readonly observations: GridEdgeObservations };
/** Admission/hash/transport belong to the reader. This pure ready-data seam precedes one platform mesh generation. */
export function loadGridEdgeProfiles(cells: readonly GridCell[], read: (cell: GridCell) => Promise<GridEdgeSource>): Promise<readonly PlatformCell[]> {
  if (cells.length === 0 || new Set(cells.map((c) => c.instance)).size !== cells.length) throw new RangeError('Invalid edge profile cells');
  const bySlug = new Map<string, Promise<{ profiles: EdgeProfiles; observations: GridEdgeObservations }>>();
  return Promise.all(cells.map(async (cell): Promise<PlatformCell> => {
    let pending = bySlug.get(cell.slug);
    if (pending === undefined) {
      pending = (async () => {
        const source = await read(cell), profiles = source.kind === 'baked' ? bakedEdgeProfiles(source.bytes, source.palette) : source.profiles;
        const frozen = (side: keyof EdgeProfiles) => immutableEdgeProfile(profiles[side]);
        const observation = (side: keyof GridEdgeObservations) => {
          const row = source.observations[side];
          return Object.freeze({ ...row, ...(row.outflows === undefined ? {} : { outflows: Object.freeze(row.outflows.map((flow) => Object.freeze({ ...flow }))) }) });
        };
        return { profiles: Object.freeze({ north: frozen('north'), east: frozen('east'), south: frozen('south'), west: frozen('west') }), observations: Object.freeze({ north: observation('north'), east: observation('east'), south: observation('south'), west: observation('west') }) };
      })();
      bySlug.set(cell.slug, pending);
    }
    const data = await pending;
    return Object.freeze({ instance: cell.instance, origin: Object.freeze({ x: cell.origin.x, z: cell.origin.z }), cell: Object.freeze([cell.cell[0], cell.cell[1]] as const), edges: data.profiles, observations: data.observations });
  }));
}

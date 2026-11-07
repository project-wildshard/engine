import { catalogueDocument } from './catalogueDocument';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { parseGridCatalogue, type CopyIdentity, type GridCatalogue, type GridEdgeLook, type GridMode } from './catalogue';

/** A world-space or cell-local point; authoritative simulations only receive the latter. */
export interface GridPoint { x: number; y: number; z: number }
/** Stable instance identity with its independent cell placement and derived rendering translation. */
export interface GridCell { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number]; readonly origin: Readonly<GridPoint>;
  /** a shared product's copy identity, when the placement declares one (copyIdentity.ts) */
  readonly identity?: CopyIdentity;
  /** Optional curtain appearance from the placement layout, independent of admission and collision. */
  readonly edgeLook?: Readonly<GridEdgeLook>;
  /** `road`: this cell's shard declares `hoverSpeedClass: road`, so a board keeps road speed across it. The server reads no manifest, so the placement carries it (P1-E5.3-A10). */
  readonly speedClass?: 'road' }
/** Neighbour queries use the same signed convention as the grid: north is positive z. */
export type GridSide = 'north' | 'east' | 'south' | 'west';
/** Outside the finite grid, seams ease into road-level open water and fog instead of another sim. */
export interface EmptyNeighbour {
  readonly kind: 'sea'; readonly level: 0;
  readonly fog: { readonly colour: readonly [number, number, number]; readonly near: number; readonly far: number };
  readonly edge: { readonly heights: readonly number[]; readonly colours: readonly (readonly [number, number, number])[]; readonly roadHeight: 0 };
}
const directions = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] } as const;
const finite = (point: GridPoint): void => { if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error('Grid coordinates must be finite'); };

/** Assemble the one platform catalogue without changing any shard's local simulation or standalone placement. */
export class GridAssembly {
  readonly cells: readonly GridCell[];
  readonly pitch: number;
  readonly emptyNeighbour: EmptyNeighbour;
  private readonly byInstance: ReadonlyMap<string, GridCell>;
  private readonly byCell: ReadonlyMap<string, GridCell>;
  /** `lone`: a session of that one shard, placed at the origin with nothing around it: what a one-shard page runs, on the grid or not. It keeps the grid cell's identity, as a page keeps one save for either entry. */
  constructor(_mode: GridMode, input: unknown = catalogueDocument().grid, lone?: string) {
    const data = parseGridCatalogue(input), rows: GridCatalogue['cells'] = lone === undefined ? data.cells : [{ instance: new Map(data.cells.map((row) => [row.slug, row.instance])).get(lone) ?? lone, slug: lone, cell: [0, 0] }];
    if (new Set(rows.map((row) => row.instance)).size !== rows.length) throw new Error('Duplicate assembled grid identity');
    this.pitch = data.pitch;
    this.cells = Object.freeze(rows.map((row): GridCell => Object.freeze({ instance: row.instance, slug: row.slug,
      cell: Object.freeze([row.cell[0], row.cell[1]] as const), origin: Object.freeze({ x: row.cell[0] * data.pitch, y: 0, z: row.cell[1] * data.pitch }),
      ...(row.identity === undefined ? {} : { identity: row.identity }),
      ...(row.edgeLook === undefined ? {} : { edgeLook: Object.freeze({ ...row.edgeLook }) }),
      ...(row.speedClass === undefined ? {} : { speedClass: row.speedClass }) })));
    this.byInstance = new Map(this.cells.map((row) => [row.instance, row])); this.byCell = new Map(this.cells.map((row) => [row.cell.join(','), row]));
    const colour = Object.freeze([...data.emptyNeighbour.edgeColour] as const);
    this.emptyNeighbour = Object.freeze({ kind: 'sea', level: 0, fog: Object.freeze({ colour: Object.freeze([...data.emptyNeighbour.fog.colour] as const), near: data.emptyNeighbour.fog.near, far: data.emptyNeighbour.fog.far }),
      edge: Object.freeze({ roadHeight: 0, heights: Object.freeze(Array.from({ length: 257 }, () => 0)), colours: Object.freeze(Array.from({ length: 257 }, () => colour)) }) });
  }
  /** Resolve a stable save/fact identity, independent of its current cell. */
  cell(instance: string): GridCell { const row = this.byInstance.get(instance); if (row === undefined) throw new Error(`Unknown grid instance ${instance}`); return row; }
  /** Only cell interiors select a shard; strips/highway remain the platform frame. */
  at(x: number, z: number): GridCell | undefined {
    if (![x, z].every(Number.isFinite)) throw new Error('Grid coordinates must be finite');
    return this.cells.find((row) => Math.abs(x - row.origin.x) <= CHUNK_HALF && Math.abs(z - row.origin.z) <= CHUNK_HALF);
  }
  /** Adjacent cells or the explicit empty-neighbour seam profile. */
  neighbour(cell: GridCell, side: GridSide): GridCell | EmptyNeighbour {
    const [x, z] = directions[side]; return this.byCell.get(`${cell.cell[0] + x},${cell.cell[1] + z}`) ?? this.emptyNeighbour;
  }
  /** Rebase rendering to this cell; all visible cells subtract this origin from their render translations. */
  renderOrigin(cell: GridCell): GridPoint { return { ...cell.origin }; }
  /** Global placement never enters authoritative shard state. */
  local(point: GridPoint, cell: GridCell): GridPoint { finite(point); return { x: point.x - cell.origin.x, y: point.y, z: point.z - cell.origin.z }; }
  /** Convert a pose to world coordinates without mutating or respawning an actor. */
  world(point: GridPoint, cell: GridCell): GridPoint { finite(point); return { x: point.x + cell.origin.x, y: point.y, z: point.z + cell.origin.z }; }
  /** Horizontal cell/strip traversal belongs to the grid driver; the authored fall floor still recovers the player. */
  boundsMode(): boolean { return true; }
  /**
   * O11: a radial admission (runtime prefetch, tile admission) of a cell `distance` metres from its content square
   * fires within `reach`, and never at a pitch or more: that far, a whole cell column stands between (the outer road
   * is 562.5-625 m from ring 1, inside a hybrid shard's 567 m readiness reach and the boosted 640 m tile reach).
   */
  approaching(distance: number, reach: number): boolean { return distance <= reach && distance < this.pitch; }
}

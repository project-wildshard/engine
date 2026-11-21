// meta ONE-FORMAT OF22e2 (opus-drift6), OF22n (opus-nine-cell): a grid data cell's client plan. A one-shard page installs every
// `client/plan` feature a plain upload declares (`ShardfileClient` through `installClientPhase`) and a grid runtime cell does
// too (`runtimePage.ts`), but a data cell installed only its audio scene (`plotAudio.ts`), so on the grid Nine's city stood
// half built: no assembly, no place sets, no movers' views, no portal veil (test/grid-data-cell-plan-parity.test.ts named
// them). The entered cell now installs the rest of its plan on the page's context, its product the cell's own, for as long
// as the feet stay in it, in the one-shard page's phase order. The scene keeps the home's frame (liveSession C39): the home
// cell draws in the page context's frame, and a cell entered from the road draws under a root at its origin less the
// home's, as a regional runtime's view root stands (`regionalView.ts`), while its walk, physics and ground stay frame-local.
// (A walk through a walled cell's gate is a zone entry that makes that cell the home (ZE5, J352), so Nine from the road
// takes the home path; the offset path is for a data cell the feet stand in while another cell is the home.)
import { Group } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { admitClientPlan, installClientPhase, type ClientPhase } from '../shardfile/clientPlan';
import type { RegionalRuntimePage } from './regionalRuntime';

/** How the feet reach a data cell: it is the page's home, or they walk in from the road. */
export type DataCellEntry = 'home' | 'road';
/** The entries that enter a data cell's plan (OF22e2 entered the home only; OF22n the road too). */
export const DATA_CELL_PLAN_ENTRIES: ReadonlySet<DataCellEntry> = new Set<DataCellEntry>(['home', 'road']);
/** Where an entered data cell's plan draws in the home's frame: null for the home, else its origin less the home's. */
export interface DataCellPlanFrame { readonly name: string; readonly x: number; readonly z: number }
interface CellAt { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }
export function dataCellPlanFrame(cell: CellAt, home: CellAt): DataCellPlanFrame | null {
  return cell.instance === home.instance ? null : { name: cell.instance, x: cell.origin.x - home.origin.x, z: cell.origin.z - home.origin.z };
}
/** The road-entered cell's plan root: hung on `scene` at the frame's offset for the stay's lifetime. */
export function dataCellPlanRoot(scene: { add: (object: Group) => unknown }, frame: DataCellPlanFrame, stay: Scope): Group {
  const root = new Group(); root.name = `grid-data-plan:${frame.name}`; root.position.set(frame.x, 0, frame.z);
  scene.add(root); root.updateMatrixWorld(true);
  stay.onDispose(() => { root.removeFromParent(); });
  return root;
}

/** Plan features a data cell installs another way: its audio scene and the audio rows of its world updates (`plotAudio.ts`). */
export const DATA_CELL_OWN_PLAN: ReadonlySet<string> = new Set(['audio.scene', 'world.updates']);
const PHASES: readonly ClientPhase[] = ['world', 'world-bindings', 'kit', 'prepare-play', 'play'];

/** The plan rows a data cell must enter itself; none for a cell with no plan or only what it covers. */
export function dataCellPlanRows(folder: Pick<ShardFolder, 'has' | 'section'>): readonly ClientFeatureRow[] {
  if (!folder.has('client/plan')) return [];
  return folder.section('client/plan').features.filter(row => !DATA_CELL_OWN_PLAN.has(row.kind));
}

/** Enter the cell's own plan rows on the page's context for the stay's lifetime; `frame` (a road entry) draws them under
 *  a root at the cell's offset in the home's frame. */
export async function enterDataCellPlan(folder: ShardFolder, page: RegionalRuntimePage, stay: Scope, frame: DataCellPlanFrame | null = null): Promise<void> {
  const rows = dataCellPlanRows(folder);
  if (rows.length === 0) return;
  const plan = admitClientPlan({ version: 1, features: rows }, folder);
  const root = frame === null ? page.context.root : dataCellPlanRoot(page.world.game.rootScene, frame, stay);
  const ctx = { ...page.context, scope: stay, product: folder, root };
  for (const phase of PHASES) {
    if (stay.disposed || stay.disposing) return;
    await installClientPhase(ctx, plan, phase, stay);
  }
}

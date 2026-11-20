// meta ONE-FORMAT OF22e2 (opus-drift6): a grid data cell's client plan. A one-shard page installs every `client/plan` feature
// a plain upload declares (`ShardfileClient` through `installClientPhase`) and a grid runtime cell does too (`runtimePage.ts`),
// but a data cell installed only its audio scene (`plotAudio.ts`), so on the grid Nine's city stood half built: no
// assembly, no place sets, no movers' views, no portal veil (test/grid-data-cell-plan-parity.test.ts named them). The
// entered home cell now installs the rest of its plan on the page's context, its product the cell's own, for as long as the feet
// stay in it, in the one-shard page's phase order. Only the home cell: the scene keeps the home's frame (liveSession C39) and
// the plan draws in the page context's frame, so a data cell entered from the road keeps the old behaviour (a follow-up).
import type { Scope } from '@wildshard/engine/app/scope';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { admitClientPlan, installClientPhase, type ClientPhase } from '../shardfile/clientPlan';
import type { RegionalRuntimePage } from './regionalRuntime';

/** Plan features a data cell installs another way: its audio scene and the audio rows of its world updates (`plotAudio.ts`). */
export const DATA_CELL_OWN_PLAN: ReadonlySet<string> = new Set(['audio.scene', 'world.updates']);
const PHASES: readonly ClientPhase[] = ['world', 'world-bindings', 'kit', 'prepare-play', 'play'];

/** The plan rows a data cell must enter itself; none for a cell with no plan or only what it covers. */
export function dataCellPlanRows(folder: Pick<ShardFolder, 'has' | 'section'>): readonly ClientFeatureRow[] {
  if (!folder.has('client/plan')) return [];
  return folder.section('client/plan').features.filter(row => !DATA_CELL_OWN_PLAN.has(row.kind));
}

/** Enter the cell's own plan rows on the page's context for the stay's lifetime. */
export async function enterDataCellPlan(folder: ShardFolder, page: RegionalRuntimePage, stay: Scope): Promise<void> {
  const rows = dataCellPlanRows(folder);
  if (rows.length === 0) return;
  const plan = admitClientPlan({ version: 1, features: rows }, folder), ctx = { ...page.context, scope: stay, product: folder };
  for (const phase of PHASES) {
    if (stay.disposed || stay.disposing) return;
    await installClientPhase(ctx, plan, phase, stay);
  }
}

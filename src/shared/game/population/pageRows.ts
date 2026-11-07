import { parseRuntimeSpawns, type RuntimeSpawns } from '@wildshard/format/runtimeSpawns';
import type { NativeRuntimePlanData } from '@wildshard/format/nativeRuntimePlan';

/** Browser allocation uses the native plan's existing roster and encounter
 * ownership. No second list of body recipes is admitted by client/plan. */
export function pagePopulationRows(plan: NativeRuntimePlanData): RuntimeSpawns {
  const { rows, owner } = plan.recipe.population;
  const body = (row: typeof rows.homes[number]) => {
    if (row.look === undefined) throw new Error(`Native page body needs its authored look: ${row.id}`);
    return { id: row.id, kind: row.kind, at: row.at, yaw: row.yaw, look: row.look };
  };
  if (owner.profile.pattern === 'held') {
    if (rows.boss !== undefined || rows.homes.some(row => row.respawn !== 0)) throw new Error('Held page requires its finite native roster');
    return parseRuntimeSpawns({ homes: [], bosses: rows.homes.filter(row => row.id === owner.actor).map(body),
      actors: rows.homes.filter(row => row.id !== owner.actor).map(body) });
  }
  const boss = rows.boss;
  if (boss === undefined || boss.id !== owner.actor || boss.look === undefined) throw new Error('Spawned page requires its native boss row');
  return parseRuntimeSpawns({ homes: rows.homes.map(row => Object.assign(body(row), { respawn: row.respawn })), bosses: [boss] });
}

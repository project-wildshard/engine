import { MoverScriptDriver, playerGrounds, type MoverRuntime } from '../../src/server/game/plugin/mover';
import type { MoverData } from '@wildshard/format/movers';
import type { SimHost } from '../../src/server/engine/sim';

export interface FixtureMovers { runtime: MoverRuntime; failures: () => number }
export function installMoverFixture(host: SimHost, rows: MoverData, modules: ReadonlyMap<string, Uint8Array>, options: {
  systemId: string; restoring: boolean; initialPermissions?: ReadonlyMap<string, number>;
  permissions?: () => ReadonlyMap<string, number>; sharedState?: (field: number) => number | boolean | undefined; activation?: boolean;
}): FixtureMovers {
  const driver = new MoverScriptDriver(rows, host), lane = driver.compose({ identity: { seed: 0 },
    sim: { scripts: [...modules.keys()], bindings: [], scriptTickDivisor: 1 }, state: { shared: [], player: [] } }, modules,
    { rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 }, entities: [], actors: new Map(), query: () => [] }, undefined,
    options.permissions ?? (() => options.initialPermissions ?? new Map()));
  const runtime = driver.install(host, lane, { id: options.systemId, restoring: options.restoring, drive: true,
    ...(options.activation === false ? {} : { activation: { ground: () => playerGrounds(host),
      ...(options.sharedState === undefined ? {} : { shared: options.sharedState }) } }) });
  return { runtime, failures: () => lane.host.failureCount };
}

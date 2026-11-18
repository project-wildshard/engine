// SHARD-SOURCE SS-MS1b: a data cell's race clock inside the grid. A one-shard page installs it in its shardfile client
// (SS-MS1a3, `raceClock.ts`); a grid copy never did, so on staging (v0.1.40) Mirror Salt's arch line ran on the cell's server
// with no clock on the page. While the feet stand in the copy its races run the clock off the cell server's owned lines and
// tick; mid-crossing the wire is another cell's, so the clock holds until it is this cell's again.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { app } from '@wildshard/engine/app/runtime';
import { installRaceClock, type RaceClockView } from '../shardfile/raceClock';
import { wirePage } from '../shardfile/wirePage';

/** Whether a copy declares any race. */
export const hasRaces = (source: Pick<Shardfile, 'quests'>): boolean => (source.quests.races?.length ?? 0) > 0;

/** The chip and the frame clock the clock uses: the page's (`enterDataCellRaces`), or a test's. */
export interface DataCellRacePorts { readonly system: (spec: SystemSpec) => void; readonly view: RaceClockView }

/** Install a copy's race clock for one stay in it. `here` says whether the wire is this cell's. */
export function installCellRaces(source: Pick<Shardfile, 'quests'>, here: () => boolean, ports: DataCellRacePorts): void {
  installRaceClock(source.quests.races ?? [], { system: ports.system, view: ports.view,
    line: (name) => (here() ? wirePage.line(name) : 0), tick: () => (here() ? wirePage.tick() : null) });
}

/** The page's install: the race chip (with the quest views) and a frame system named for the cell, both gone with `scope`. */
export async function enterDataCellRaces(source: Pick<Shardfile, 'quests'>, scope: Scope, instance: string, here: () => boolean): Promise<void> {
  const { RaceClockChip } = await import('@wildshard/engine/quest/view/ui');
  if (scope.disposed || scope.disposing) return;
  installCellRaces(source, here, {
    view: new RaceClockChip(scope),
    system: (spec) => { app.addSystem({ ...spec, id: `grid.races.${instance}` }, scope); } });
}

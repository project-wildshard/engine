// SHARD-SOURCE SS-GP3: a data cell's declared HUD and boss panels inside the grid. A one-shard page mounts its `ui` rows
// reading the shard's fields and draws a boss bar per declared boss panel off the wire's encounter rows (`client.ts`,
// `installDeclaredHud`); a grid copy did neither. While the feet stand in the copy its HUD reads the cell server's rows; mid-
// crossing the wire is another cell's, so its counters and bars hold this cell's last word. All of it leaves with the stay.
import type { Scope } from '@wildshard/engine/app/scope';
import type { DeclaredHudHandles } from '@wildshard/engine/ui/declared';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { declaredFields, installDeclaredHud, type DeclaredHudInstall } from '../shardfile/declaredHud';
import { ownedLineFields } from '../shardfile/ownedLines';
import { wirePage } from '../shardfile/wirePage';
import type { RegionalRuntimePage } from './regionalRuntime';
import { stayContext } from './stayContext';

type HudSource = Pick<Shardfile, 'ui' | 'encounters' | 'state' | 'targets' | 'sim'>;
/** The stay's HUD, Bag, frame clock and boss panels' page: the page's (`enterDataCellHud`), or a test's. */
export type DataCellHudPorts = Omit<DeclaredHudInstall, 'read' | 'encounters' | 'scope'>;

/** Install a copy's declared HUD for one stay in it. `here` says whether the wire is this cell's. */
export function installCellHud(source: HudSource, stay: Scope, here: () => boolean, ports: DataCellHudPorts): DeclaredHudHandles {
  const lines = ownedLineFields(source), held = new Map<string, number>();
  const fields = declaredFields(source, { row: name => (here() ? wirePage.row(name) : undefined),
    line: name => (here() && lines.has(name) && wirePage.client !== null ? wirePage.line(name) : undefined) });
  const read = (name: string): number => {
    const last = here() ? undefined : held.get(name);
    if (last !== undefined) return last;
    const value = fields.named(name);
    if (here()) held.set(name, value);
    return value;
  };
  return installDeclaredHud(source, { ...ports, scope: stay, read, encounters: () => (here() ? wirePage.encounters() : null) });
}

/** The page's install: the HUD on the page's context bound to the stay; a boss intro holds the page's weapons. */
export function enterDataCellHud(source: HudSource, page: Pick<RegionalRuntimePage, 'context' | 'play'>, stay: Scope, instance: string, here: () => boolean): void {
  const at = stayContext(page.context, stay, instance);
  installCellHud(source, stay, here, { hud: at.hud, bag: at.bag, system: at.system, boss: {
    lock: on => { page.play.weapons.setEnabled(!on); },
    attempt: (boss, outcome) => { at.app.events.emit('boss.attempt', { boss, outcome }); },
    died: then => { at.on('player.died', ({ actor }) => { if (actor === at.app.player) then(); }); } } });
}

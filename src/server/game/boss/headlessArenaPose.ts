/**
 * CI12: the Storm Titan's pose view natively. The fight's frame slot (format/arenaView) runs its admitted view module
 * (behaviour/titanView) over the fight's own sources and cells, through the engine's view lane, without a client plan or a
 * renderer: its ground tells draw nothing. The eased pose it writes feeds the fight's next decisions, so the lane runs on
 * every frame (`displayHz` 15) instead of the page's cost-halved rate.
 *
 *   bindArenaPoseView(fight, module, rows, { scope, player, camera });   // then fight.update(dt, t, fighting) as on the page
 */
import type { Vector3 } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { viewProgram, type ViewCamera, type ViewTell } from '@wildshard/engine/script/viewProgram';
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import { ARENA_VIEW, arenaChainTell } from '@wildshard/format/arenaView';
import type { ViewProgramRows } from '@wildshard/format/viewProgram';
import type { ArenaDraw, ArenaPoseCells, OpenArenaFight } from '../../../shared/game/boss/openArenaFight';

/** the display rate that keeps the view lane at every frame (its halving floor is the display rate over 15 Hz) */
const EVERY_FRAME_HZ = 15;
/** a native tell of an id the fight lends nothing for (each id its own: the lane claims one target once) */
const silentTell = (): ViewTell => ({ ring: () => undefined, lane: () => undefined, wedge: () => undefined, hide: () => undefined });

/** Bind `fight`'s frame slot to its view `module` (admitted with `rows`) for `scope`'s life, reading the fight's sources
 *  and writing its cells as the page's lent slot does. */
export function bindArenaPoseView(fight: Pick<OpenArenaFight<ArenaDraw>, 'viewSource' | 'poseCells' | 'adoptView' | 'viewLoan'>, module: Uint8Array, rows: ViewProgramRows,
  ports: { readonly scope: Scope; readonly player: { readonly position: Vector3; readonly velocity: Vector3; readonly yaw: number }; readonly camera: ViewCamera }): void {
  if (rows.slot !== ARENA_VIEW.slot) throw new Error('Arena pose view needs the fight frame slot');
  const bytes = Uint8Array.from(module);
  admitScriptV2(bytes, { lane: 'view', ioBytes: rows.budget.ioBytes });
  const cells: ArenaPoseCells = fight.poseCells(), ids = ARENA_VIEW.cells;
  // the fight's own tells: a server's say what they'd draw (headlessArenaViews.ts)
  const { arena, chains } = fight.viewLoan, tells = new Map<string, ViewTell>([[ARENA_VIEW.tells.spear, arena.tell('spear')], [ARENA_VIEW.tells.fork, arena.tell('fork')], ...chains.map((tell, index) => [arenaChainTell(index), tell] as const)]);
  const byId = new Map<string, { value: number }>([[ids.bend, cells.bend], [ids.raise, cells.raise], [ids.castL, cells.castL], [ids.struck, cells.struck], [ids.alpha, cells.alpha]]);
  const program = viewProgram(bytes, rows, { scope: ports.scope, player: ports.player, camera: ports.camera, displayHz: EVERY_FRAME_HZ,
    values: source => fight.viewSource(source), floor: () => null, slots: () => null,
    object: id => { throw new Error(`Arena pose view lends no object ${id}`); }, look: look => { throw new Error(`Arena pose view lends no look ${look}`); },
    cell: id => { const cell = byId.get(id); if (cell === undefined) throw new Error(`Arena pose view lends no cell ${id}`); return cell; },
    tell: id => { let tell = tells.get(id); if (tell === undefined) { tell = silentTell(); tells.set(id, tell); } return tell; } });
  if (program === null) throw new Error('Arena pose view did not bind');
  fight.adoptView(ports.scope, { frame: (dt, time) => { program.frame(dt, time); }, cells });
}

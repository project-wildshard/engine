// SHARD-SOURCE SS-GP6: a data cell's look graphs inside the grid. A one-shard page binds its material graphs (and look curves)
// to the frame owner's hour and its live state fields (`client.ts` `graphs.bind`) and ticks its presentation each frame; the
// grid's tile admission (`session.ts`) compiled a data cell's look and did neither, so a graph bound to a state field stood at
// the field's default and a day-bound one at the hour it compiled. While the feet stand in the copy its look reads the cell's
// fields off the wire, as a one-shard page reads its own, and ticks; mid-crossing (the wire another cell's) it holds.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { app } from '@wildshard/engine/app/runtime';
import type { GraphSources } from '../shardfile/clientGraphs';
import { ownedLineFields } from '../shardfile/ownedLines';
import { wirePage } from '../shardfile/wirePage';

type FieldScope = 'shared' | 'player';
/** A data cell's compiled look as its tile admission keeps it: its graph feeds' binding and its presentation clock. */
export interface CellLook { readonly source: Pick<Shardfile, 'state' | 'targets' | 'sim'>; readonly bind: (sources: GraphSources) => void; readonly tick: (dt: number) => void }

/** Each admitted data cell's look by instance (`offerCellLook`); a re-admission replaces it. */
export const cellLooks: Map<string, CellLook> = new Map<string, CellLook>();
const offered = new Set<(instance: string) => void>();
/** The tile admission's offer: the cell's look is compiled. A stay already waiting in that cell installs now. */
export function offerCellLook(instance: string, look: CellLook): void {
  cellLooks.set(instance, look);
  for (const listen of offered) listen(instance);
}

/** A field as a one-shard page reads it on the wire (`client.ts` `fieldValue`): a public shared field's row, a player's own
 *  owned line, else its declared default; a host field, or a player's field no line carries, reads nothing here. */
export function cellFieldReader(source: Pick<Shardfile, 'state' | 'targets' | 'sim'>): (scope: FieldScope, name: string) => number | undefined {
  const lines = ownedLineFields(source);
  return (scope, name) => {
    const field = source.state[scope].find((row) => row.name === name);
    if (field === undefined || (scope === 'shared' ? field.privacy !== 'public' : field.privacy === 'host')) return undefined;
    const value = scope === 'player' ? (lines.has(name) ? wirePage.line(name) : undefined) : wirePage.row(name);
    if (value !== undefined || typeof field.default === 'string') return value;
    return typeof field.default === 'boolean' ? Number(field.default) : field.default;
  };
}

/** The frame clock and hour a stay's look uses: the page's (`enterCellLooks`), or a test's. */
export interface DataCellLookPorts { readonly system: (spec: SystemSpec) => void; readonly hour: () => number | null }

/** Bind a copy's look for one stay in it and tick it each frame. `here` says whether the wire is this cell's. */
export function installCellLooks(look: CellLook, stay: Scope, here: () => boolean, ports: DataCellLookPorts): void {
  const read = cellFieldReader(look.source), held = new Map<string, number | undefined>();
  look.bind({ hour: ports.hour, state: (scope, name) => {
    const key = `${scope}.${name}`;
    if (here()) held.set(key, read(scope, name));
    return held.get(key);
  } });
  ports.system({ id: 'looks', phase: 'update', run: (dt) => { if (!stay.disposed) look.tick(dt); } });
}

/** The page's install: the cell's look, if admitted, bound to the page's hour and ticked by a frame system gone with `stay`. */
export function enterCellLooks(instance: string, stay: Scope, here: () => boolean): void {
  const look = cellLooks.get(instance); if (look === undefined) return;
  installCellLooks(look, stay, here, { hour: () => app.dayCycle?.hour ?? null,
    system: (spec) => { app.addSystem({ ...spec, id: `grid.looks.${instance}` }, stay); } });
}

/** The grid's cell events this follows (`gridCells`, or a test's). */
export interface CellLookEvents {
  readonly onEnter: (fn: (cell: { readonly instance: string }) => void) => () => void;
  readonly onLeave: (fn: () => void) => () => void;
}

/**
 * Install `enter` once per stay in a data cell (`isData`) whose look is admitted, whether it admits before the feet arrive
 * or after; the stay's scope ends when the feet leave or `scope` goes. The grid's one hook (`liveSession.ts`).
 */
export function followCellLooks(scope: Scope, events: CellLookEvents, isData: (instance: string) => boolean, enter: (instance: string, stay: Scope) => void): void {
  let waiting: string | null = null, stay: Scope | null = null;
  const leave = (): void => { waiting = null; const left = stay; stay = null; left?.dispose(); };
  const start = (instance: string): void => {
    if (waiting !== instance || stay !== null || !cellLooks.has(instance) || scope.disposed || scope.disposing) return;
    stay = scope.child(`grid.looks.${instance}`); enter(instance, stay);
  };
  scope.onDispose(events.onEnter((cell) => { leave(); if (!isData(cell.instance)) return; waiting = cell.instance; start(cell.instance); }));
  scope.onDispose(events.onLeave(leave));
  offered.add(start); scope.onDispose(() => { offered.delete(start); leave(); });
}

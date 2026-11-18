// SHARD-SOURCE SS-GP3: a shard's declared fields as its page reads them, and its declared HUD and boss panels, one install for
// a one-shard page (`client.ts`) and a grid data cell (`grid/dataCellHud.ts`), so the grid cannot miss them again.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { DeclaredHudHandles } from '@wildshard/engine/ui/declared';
import { BossRowBar, type EncounterRow } from '../boss/barFeed';
import { mountDeclaredUi, type DeclaredUiPorts } from '../shard/declaredUi';

/** Which book a declared field is in. */
export type FieldScope = 'shared' | 'player';
/** The wire's word on a field: a public shared field's row, a player field's owned line; undefined when it has said none. */
export interface FieldWire { readonly row: (name: string) => number | undefined; readonly line: (name: string) => number | undefined }
/** A source's fields as a page may see them. */
export interface DeclaredFields {
  /** A field a player may see: the wire's word, else its authored default; undefined for a hidden field or a text default. */
  readonly value: (scope: FieldScope, name: string) => number | undefined;
  /** A numeric field by id; a hidden one reads its default. */
  readonly read: (scope: FieldScope, id: number) => number;
  /** A numeric field by name, shared first (a HUD counter's). */
  readonly named: (name: string) => number;
}

/** Whether a source declares any HUD row (markers, counters, Bag panels, boss panels, relabels). */
export const hasDeclaredHud = (source: Pick<Shardfile, 'ui'>): boolean => source.ui.length > 0;

/** A field a player may see, on this page: the server's row where it sends one. Only public shared fields have rows, so a
 *  player's own stands at its authored default: no such row, and none invented here (RETIRE-FEED A6). */
export function declaredFields(source: Pick<Shardfile, 'state'>, wire: FieldWire): DeclaredFields {
  const value = (scope: FieldScope, name: string): number | undefined => {
    const field = source.state[scope].find((row) => row.name === name);
    if (field === undefined || (scope === 'shared' ? field.privacy !== 'public' : field.privacy === 'host')) return undefined;
    const said = scope === 'player' ? wire.line(name) : wire.row(name);
    if (said !== undefined || typeof field.default === 'string') return said;
    return typeof field.default === 'boolean' ? Number(field.default) : field.default;
  };
  const read = (scope: FieldScope, id: number): number => {
    const field = source.state[scope].find((row) => row.id === id); if (field === undefined) throw new Error('Missing declared state field');
    const said = value(scope, field.name);
    if (said !== undefined) return said;
    if (typeof field.default === 'string') throw new Error('UI requires numeric state'); return typeof field.default === 'boolean' ? Number(field.default) : field.default;
  };
  const named = (name: string): number => {
    const scope = source.state.shared.some((row) => row.name === name) ? 'shared' : 'player', field = source.state[scope].find((row) => row.name === name);
    if (field === undefined) throw new Error('Missing declared counter field');
    return read(scope, field.id);
  };
  return { value, read, named };
}

/** What a boss panel does to the page: hold its weapons through the intro, count an attempt, hear its player die. */
export interface BossPanelPorts {
  readonly lock: (on: boolean) => void;
  readonly attempt: (boss: string, outcome: 'started' | 'won' | 'lost' | 'left') => void;
  readonly died: (then: () => void) => void;
}
/** The HUD's ports, the field reader, the encounter rows (null: hold this frame) and the boss panels' page. */
export interface DeclaredHudInstall extends DeclaredUiPorts {
  readonly encounters: () => readonly EncounterRow[] | null;
  readonly boss: BossPanelPorts;
}

/** Mount `source.ui` for the ports' scope. C10: a declared boss panel has one driver, its encounter's row (J130), as every
 *  native bar does: its bar, name card and retry. */
export function installDeclaredHud(source: Pick<Shardfile, 'ui' | 'encounters'>, ports: DeclaredHudInstall): DeclaredHudHandles {
  const { encounters, boss, ...hud } = ports, handles = mountDeclaredUi(source.ui, hud);
  const panels = [...handles.bosses].map(([id, panel]) => {
    const encounter = source.encounters.find(row => row.id === id);
    if (encounter === undefined) throw new Error(`Boss panel requires its declared encounter: ${id}`);
    const bar = new BossRowBar(panel.presentation, { id, ...panel.definition, phases: encounter.phases.map(phase => ({ at: phase.at, caption: phase.caption, name: phase.name })) }, null, {
      lock: boss.lock, attempt: outcome => { boss.attempt(id, outcome === 'died' ? 'lost' : outcome); } });
    boss.died(() => { bar.playerDied(); });
    return bar;
  });
  if (panels.length > 0) ports.system({ id: 'shardfile.boss-panels', phase: 'update', run: dt => {
    const rows = encounters(); if (rows === null) return;
    for (const bar of panels) bar.draw(rows, dt);
  } });
  return handles;
}

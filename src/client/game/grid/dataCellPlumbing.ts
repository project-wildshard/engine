// SHARD-SOURCE SS-GP4c: a data cell's declared input inside the grid. A one-shard page installs its `plumbing` input
// contexts (`client.ts`, `installDeclaredPlumbing`): the keys and touch buttons its tools and scenes answer to. A grid copy
// built the kit (`dataCellKit.ts`) but no plumbing, so the Template's lantern had no L key and no LANTERN button on a grid
// cell (GRID-CELL-PARITY row 30). While the feet stand in the copy its input contexts are the page's, enabled only while the
// wire is this cell's; a scene that is an item's request goes to the cell server, as the kit's relay does. Its contexts are
// named for the cell, so a copy of the home's own product never clashes with the home's. Tier knobs are build-time values
// the cell's admission already used, and Debug rows are a one-shard page's, so neither is registered here.
import type { Scope } from '@wildshard/engine/app/scope';
import type { InputService } from '@wildshard/engine/input/InputService';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { TIER } from '@wildshard/engine/core/tier';
import type { InputObservation } from '@wildshard/format/inputDeclarations';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { installDeclaredPlumbing, type PlumbingHandles } from '../shard/declaredPlumbing';
import { handledItemInputs } from '../shardfile/clientItems';
import { wirePage } from '../shardfile/wirePage';
import { playerModes } from '@wildshard/engine/player/modes';
import type { RegionalRuntimePage } from './regionalRuntime';
import { stayContext } from './stayContext';

type PlumbingSource = Pick<Shardfile, 'plumbing' | 'items' | 'targets'>;

/** Whether a copy declares input or Debug rows. */
export const hasPlumbing = (source: Pick<Shardfile, 'plumbing'>): boolean => source.plumbing !== null && source.plumbing.input.length > 0;

/** The page's input and play state, and where a scene goes: the page's (`enterDataCellPlumbing`), or a test's. */
export interface DataCellPlumbingPorts {
  readonly input: InputService;
  readonly playing: () => boolean;
  readonly observation: InputObservation;
  readonly send: (scene: string) => void;
  readonly system: (spec: SystemSpec) => void;
}

/** Install a copy's declared input for one stay in it. `here` says whether the wire is this cell's. */
export function installCellPlumbing(source: PlumbingSource, instance: string, stay: Scope, here: () => boolean, ports: DataCellPlumbingPorts): PlumbingHandles | null {
  const plumbing = source.plumbing;
  if (plumbing === null || plumbing.input.length === 0) return null;
  const requests = new Set((source.targets.itemActions ?? []).map(row => row.scene));
  const handles = installDeclaredPlumbing({ ...plumbing, debug: [] }, { handledInput: handledItemInputs(source), instance, tier: TIER, scope: stay, input: ports.input,
    active: () => ports.playing() && here(), knobs: () => undefined, debugRow: () => undefined, observation: ports.observation,
    // an item's request is the scene the server takes it by (SR11); any other scene has no page owner on a grid cell, as on a one-shard page
    scene: (id) => { if (here() && requests.has(id)) ports.send(id); } });
  if (plumbing.input.some(row => row.when !== undefined)) ports.system({ id: 'declared.input.conditions', phase: 'input', before: ['engine.input.contexts'], run: handles.update });
  return handles;
}

/** The page's install: its input service and frame clock, the cell server's flags as the observation. */
export function enterDataCellPlumbing(source: PlumbingSource, page: Pick<RegionalRuntimePage, 'context' | 'world'>, stay: Scope, instance: string, here: () => boolean): void {
  const { app } = page.context, player = page.world.player;
  installCellPlumbing(source, instance, stay, here, { input: app.input, playing: () => app.state === 'play',
    observation: { get mode() { return playerModes(player).current(); }, get item() { return app.equipment?.current.row.id ?? null; },
      get flags() { return wirePage.client === null || !here() ? [] : [...wirePage.client.flags()]; } },
    send: (scene) => { if (wirePage.client !== null) wirePage.send(scene); },
    system: stayContext(page.context, stay, instance).system });
}

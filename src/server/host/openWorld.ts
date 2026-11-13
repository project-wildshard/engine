// SERVER-PARITY HS1 (meta docs/plans/SERVER-PARITY-PLAN.md): one world-build entry. A dedicated room, the phone's grid worker
// (through `openCellWorld`, its per-cell form) and the headless tick adapter a shard's CI and the bake worker boot all open the
// same composition: the trusted resident, then the server's chapters, doors, discoveries, owned book, lone walls and fall floor.
// Before HS1 the tick adapter booted the bare resident, a fourth world no player runs, so a shard journey had to install
// chapters (and the rest) by hand to test what a room does.
import { createSimSnapshotSerializer, checkSimSnapshotWire, snapshotSimHostBytes, type SimSnapshot } from '@wildshard/engine/sim/snapshot';
import type { SimHost } from '@wildshard/engine/sim';
import { SaveStore } from '@wildshard/engine/saves/store';
import { createTrustedHeadlessTape } from '../../shared/host/headlessTape';
import { runHeadlessJourney } from '../../shared/host/headlessJourney';
import { MAX_TICK_SNAPSHOT_CHARS, type HeadlessCommand } from '../../shared/host/tickProtocol';
import type { HeadlessRuntimeInput } from './headlessRuntime';
import type { TickWorkerAdapter } from './tickWorkerLoop';
import { nativeCell, openCellWorld, type CellWorld, type CellWorldOptions } from './standalone/cellWorld';
import { residentFallNet, shardPlayArea } from './standalone/fallFloor';

/** How a world opens. `room`: every solid held and no page's save seeds it (a dedicated room, a CI journey). */
export interface OpenWorldOptions extends Partial<Omit<CellWorldOptions, 'wholeSolids' | 'pageless'>> {
  readonly room?: boolean;
  /** The grid instance it is. Left out, the shard's own slug. */
  readonly cell?: string;
  readonly snapshot?: string | SimSnapshot;
}

/** Open `input`'s world, native or data. Left out, the saves are this world's own (nothing persists) and the world is lone. */
export function openWorld(input: HeadlessRuntimeInput, options: OpenWorldOptions = {}): Promise<CellWorld> {
  const { room = false, cell, snapshot, saves = new SaveStore({ local: null, session: null }), lone = true, ...rest } = options;
  return openCellWorld({ instance: cell ?? input.shard.identity.slug }, input, snapshot, { ...rest, saves, lone, ...(room ? { wholeSolids: true, pageless: true } : {}) });
}

/** The headless tick adapter, on a room's world. */
export type WorldAdapter = TickWorkerAdapter & { readonly host: SimHost };

/** A tick adapter (a shard's CI journeys, the bake worker) on the world `openWorld` opens as a room. A data cell has no trusted
 *  resident to tick: the bake worker runs a data shard on its own simulation. */
export async function openWorldAdapter(input: HeadlessRuntimeInput, snapshot?: string): Promise<WorldAdapter> {
  if (!nativeCell(input)) throw new Error('A tick adapter runs a native world');
  const world = await openWorld(input, { room: true, ...(snapshot === undefined ? {} : { snapshot }) }), { host, resident } = world;
  if (resident === undefined) { world.dispose(); throw new Error('A tick adapter runs a native world'); }
  // a room's resident leaves falls to its seats (ENG-18). With no seats here, every player keeps the resident's own net: the
  // page's play area, and its grace for an edge dock under the floor (Sky Reach's)
  const caught = residentFallNet(host, shardPlayArea(input.shard.manifest?.bounds, input.product), host.level.player.at);
  const step = (commands: readonly HeadlessCommand[]): void => { resident.step(commands); caught(); };
  let tape: ReturnType<typeof createTrustedHeadlessTape>, serializer: ReturnType<typeof createSimSnapshotSerializer>;
  try { tape = createTrustedHeadlessTape(host, step, () => resident.effects); serializer = createSimSnapshotSerializer(); } catch (error) { world.dispose(); throw error; }
  return {
    host,
    step,
    observe: () => {
      checkSimSnapshotWire(snapshotSimHostBytes(host), MAX_TICK_SNAPSHOT_CHARS);
      return { tick: host.state.tick, effects: [...resident.effects] };
    },
    verbTape: tape,
    journey: plan => runHeadlessJourney(host, step, plan),
    commit: () => ({ tick: host.state.tick, snapshot: serializer.serialize(snapshotSimHostBytes(host)), effects: [...resident.effects] }),
    finish: () => ({ ticks: host.state.tick, lanes: 0, steps: 0 }),
    dispose: () => { try { world.dispose(); } finally { serializer.dispose(); } },
  };
}

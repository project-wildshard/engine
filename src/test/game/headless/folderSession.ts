// oxlint-disable-next-line import/no-unassigned-import -- Install portable Math before simulation modules.
import '../../../shared/engine/core/portableMathFirst';
import {HeadlessSimulation} from '../../../server/host/headless';
import {loadHeadlessFolder} from '../../../server/host/headlessFolder';
import {folderHeadlessSections} from '../../../shared/host/headlessSections';
import {outputDescriptor} from '../../../shared/game/shardfile/outputDescriptor';
import {builtFolder} from '../builtFolder';
import {createNativeProofWorker} from '../headlessWorker';
import {admittedFolder} from './admittedFolderCache';

export type FolderSimulation = Pick<HeadlessSimulation, 'verbTape' | 'verbTapePart' | 'streamVerbTape' | 'journey' | 'walkLeg' | 'step' | 'dispose' | 'quarantined' | 'checkpoint'>;
export interface FolderSessionOptions {
  /** Trusted proof composition owned by the consumer. Omit to run the product's ordinary native runtime. */
  prepare?: URL;
  snapshot?: string;
}

/** Start replay admission while its caller records native input. With no `prepare`, the replay runs on the room's world
 * (`openWorldAdapter`, as a dedicated room boots it), so record on that same world: `openWorld(input, { room: true })` or
 * `openWorldAdapter`. A tape recorded on the bare `createTrustedHeadlessResident` leaves it once the worlds differ (Dunes'
 * Signal: the Matriarch fight the fire summons, from tick 9280); that is two worlds, not replay drift (mini-replay).
 * A failed admission is observed immediately, even before the caller asks for ready(). */
export async function beginFolderSession(slug: string, options: FolderSessionOptions = {}): Promise<{
  ready: () => Promise<FolderSimulation>; assets: ReadonlyMap<string, Uint8Array>;
  product: Awaited<ReturnType<typeof loadHeadlessFolder>>;
}> {
  const directory = builtFolder(slug), {product,assets} = await admittedFolder(directory,'full'), source = product.shardfile;
  if (outputDescriptor(source) === undefined) throw new Error('Missing admitted headless inventory');
  const sections = folderHeadlessSections(product);
  const pending = options.prepare === undefined
    ? HeadlessSimulation.create(source, assets, options.snapshot, {deadline: 'advisory', sections, product: directory})
    : createNativeProofWorker(source, assets, options.prepare, {sections, directory, ...(options.snapshot === undefined ? {} : {snapshot: options.snapshot})});
  const outcome = (async () => {try {return {ok: true as const, sim: await pending};} catch (error) {return {ok: false as const, error};}})();
  return {product, assets, ready: async () => {const result = await outcome; if (!result.ok) throw result.error; return result.sim;}};
}

export async function openFolderSession(slug: string, options: FolderSessionOptions = {}): Promise<{
  sim: FolderSimulation; product: Awaited<ReturnType<typeof loadHeadlessFolder>>;
}> {
  const session = await beginFolderSession(slug, options);
  return {sim: await session.ready(), product: session.product};
}

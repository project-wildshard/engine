import type { QuestPageRows } from '@wildshard/format/questPageComposition';
import type { AdventureContent } from '@wildshard/format/questStory';
import type { InteractTable } from '@wildshard/engine/world/interact/types';
import type { ShardProduct } from '../shardfile/shardProduct';

interface AssemblyRows { readonly constants: { readonly interact: InteractTable; readonly interactSpots: unknown } }
interface QuestPageReads {
  readonly discovery: () => Promise<AdventureContent | null>;
  readonly stall: () => Promise<unknown>;
  readonly assembly: () => Promise<AssemblyRows['constants'] | null>;
}

// Observe a started read immediately, but deliver its original failure only at
// its consumer. A failed earlier input must not leave a later rejected promise
// unobserved, nor replace the earlier input's diagnostic.
function deferredRead<T>(read: Promise<T>): () => Promise<T> {
  const settled = (async (): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }> => {
    try { return { ok: true, value: await read }; }
    catch (error: unknown) { return { ok: false, error }; }
  })();
  return async () => {
    const result = await settled;
    if (!result.ok) throw result.error;
    return result.value;
  };
}

/** Start only the page's three declared immutable inputs. Consumption, parsing
 * and scene/service publication remain at the existing ordered call sites. */
export function startQuestPageReads(product: Pick<ShardProduct, 'file' | 'json'>, files: QuestPageRows['files']): QuestPageReads {
  const discovery = deferredRead(files.discovery === undefined ? Promise.resolve(null) : product.json<AdventureContent>(files.discovery));
  const stall = deferredRead(product.file(files.stall));
  const assembly = deferredRead(files.assembly === undefined ? Promise.resolve(null) : product.json<AssemblyRows>(files.assembly));
  return {
    discovery,
    stall: async (): Promise<unknown> => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await stall())),
    assembly: async (): Promise<AssemblyRows['constants'] | null> => (await assembly())?.constants ?? null,
  };
}

import { parseWorldScenePlacementPage, type WorldScenePlacementPage } from '@wildshard/format/worldScenePlacement';
import type { WorldSceneReads } from './worldSceneReads';
import { macrotask } from '@wildshard/engine/boot/plan';
import { WORK_SLICE_MS } from '@wildshard/engine/core/workSlice';
import { diagnosticNow } from '@wildshard/engine/core/clock';

type Prepared = { readonly ok: true; readonly bytes: Uint8Array; readonly page: WorldScenePlacementPage }
  | { readonly ok: false; readonly error: unknown };
const decoder = new TextDecoder('utf-8', { fatal: true });
/** DL21: pages whose reads land together parsed in one task (Nine's cold phone-link card froze 0.6 s at CPU 10x on its
 *  placement pages' JSON guard and schema). `run` queues each parse behind the one before it (so every read landing in
 *  the same turn is judged after the previous parse ended: sp-x1's review of 19f18e419f, where all of a batch checked the
 *  clock before any had parsed): a parse straight after another (within 1 ms of its end) continues that stretch, and once
 *  the stretch has run `budget` the next starts a fresh task (`hop`); any gap starts a new stretch, so a lone page parses
 *  at once, in the same turn. */
export function parseSlicer(now: () => number = diagnosticNow, hop: () => Promise<void> = macrotask, budget: number = WORK_SLICE_MS): {
  run: <T>(work: () => T) => Promise<T>;
} {
  let busySince = Number.NEGATIVE_INFINITY, lastParsed = Number.NEGATIVE_INFINITY, queue: Promise<unknown> = Promise.resolve();
  const timed = <T>(work: () => T): T => { try { return work(); } finally { lastParsed = now(); } };
  return {
    run: <T>(work: () => T): Promise<T> => {
      const turn = queue.then(async (): Promise<T> => {
        const at = now();
        if (at - lastParsed > 1) busySince = at;
        else if (at - busySince >= budget) { await hop(); busySince = now(); }
        return timed(work);
      });
      queue = turn.then(() => undefined, () => undefined);
      return turn;
    },
  };
}
const pageSlices = parseSlicer();

/** Decode complete verified pages during metadata read-ahead. Failures stay
 * retained until the original ordered admission cursor; no row is published. */
export class WorldScenePlacementPages {
  private readonly entries = new Map<string, Promise<Prepared>>();
  constructor(reads: Pick<WorldSceneReads, 'file'>, names: readonly string[]) {
    for (const name of names) {
      if (this.entries.has(name)) continue;
      this.entries.set(name, this.prepare(reads, name));
    }
  }
  private async prepare(reads: Pick<WorldSceneReads, 'file'>, name: string): Promise<Prepared> {
    try {
      const bytes = await reads.file(name);
      return { ok: true, bytes, page: await pageSlices.run(() => parseWorldScenePlacementPage(JSON.parse(decoder.decode(bytes)))) };
    } catch (error) { return { ok: false, error }; }
  }
  async read(name: string, bytes: Uint8Array): Promise<WorldScenePlacementPage> {
    const pending = this.entries.get(name);
    if (pending === undefined) throw new Error('Missing prepared placement page');
    const result = await pending;
    if (!result.ok) throw result.error;
    if (result.bytes !== bytes) throw new Error('Scene placement page owner changed');
    return result.page;
  }
  clear(): void { this.entries.clear(); }
}

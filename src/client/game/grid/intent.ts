import * as v from 'valibot';
import { freshPageArrival } from '@wildshard/engine/boot/titleArrival';
import { saves } from '@wildshard/engine/saves/runtime';
/**
 * Infinite Wildshard boots only from a one-shot tap intent (SF21a, R3-C5). The title's tap writes it, the next boot
 * consumes it, and it is gone: a reload, a Safari WebContent restart or an iOS memory kill never lands back in the grid,
 * it lands on the title with Select a shard focused (G58: the grid crashing must always leave a way back).
 *
 * Like the title arrival (src/client/engine/boot/titleArrival.ts) it is written twice: to the session (the normal case) and to the
 * device as a backup (iOS home-screen navigation can replace WebContent between the title and the game document, and the
 * new process may lose the session). Both copies are consumed together; the receiving navigation must start within 60 s.
 */
export interface GridIntent { readonly instance: string; readonly slug: string; readonly at: number;
  /** GO7: a chosen destination (Shard select on a world that hosts the grid). The page asks the world to seat it in this cell,
   *  where a title tap's PLAY takes the seat the world already keeps (GO5). */
  readonly goto?: boolean }
const finite = v.pipe(v.number(), v.finite());
const schema: v.GenericSchema<unknown, GridIntent | null> = v.nullable(v.object({ instance: v.string(), slug: v.string(), at: finite, goto: v.exactOptional(v.boolean()) }));

export interface GridIntents {
  /** the title's tap on Infinite Wildshard: the home cell the grid boots into; false if neither copy persisted */
  set: (target: { readonly instance: string; readonly slug: string; readonly goto?: boolean }) => boolean;
  /** Read-only accounting hint, never entry authority; consumes neither copy. */
  pending: (slug: string) => boolean;
  /** the boot's one read: the intent for this page's shard (fresh at document arrival, at most 60 s old) or null; both copies are removed */
  consume: (slug: string) => GridIntent | null;
  /** GO7: this document turned its own `?chunk=` page into a grid page. Held in the document, so a slow boot can't age it out. */
  admit: (target: { readonly instance: string; readonly slug: string; readonly goto?: boolean }) => void;
}

/** The injectable store and clock let a Node test run the real write / consume / expiry round trip. */
/** the app's save store (src/shared/engine/saves/store.ts) */
type Store = typeof saves;
export function gridIntents(store: Store, now: () => number = Date.now): GridIntents {
  const session = store.define({ key: 'gridIntent', scope: 'session', version: 1, schema, initial: () => null });
  const device = store.define({ key: 'gridIntent.once', scope: 'device', version: 1, schema, initial: () => null });
  const fresh = (intent: GridIntent | null, slug: string): GridIntent | null => {
    if (intent === null || ![slug].includes(intent.slug)) return null; // the same page's shard only
    return freshPageArrival(intent.at, now()) ? intent : null;
  };
  let admitted: GridIntent | null = null;
  const held = (slug: string): GridIntent | null => admitted !== null && [slug].includes(admitted.slug) ? admitted : null;
  return {
    pending: slug => held(slug) !== null || fresh(session.read(), slug) !== null || fresh(device.read(), slug) !== null,
    admit: (target) => { admitted = { instance: target.instance, slug: target.slug, at: now(), ...(target.goto === true ? { goto: true } : {}) }; },
    set: (target) => {
      const intent: GridIntent = { instance: target.instance, slug: target.slug, at: now(), ...(target.goto === true ? { goto: true } : {}) };
      const inSession = session.write(intent), onDevice = device.write(intent);
      return inSession || onDevice;
    },
    consume: (slug) => {
      const fromSession = session.read(), fromDevice = device.read();
      const local = held(slug);
      session.reset(); device.reset(); admitted = null;
      return local ?? fresh(fromSession, slug) ?? fresh(fromDevice, slug);
    },
  };
}

let page: GridIntents | null = null;
/** this page's intents, on the app's save store (defined on first use) */
export function pageGridIntents(): GridIntents {
  page ??= gridIntents(saves);
  return page;
}

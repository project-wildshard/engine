import type { Scope } from '@wildshard/engine/app/scope';

/** The existing T5 overlay's actual owner data; null means no collider ownership port was observed. */
export interface EnteredTileReadout {
  readonly render: ReadonlySet<number>;
  readonly colliders: ReadonlySet<number> | null;
  readonly bytes: ReadonlyMap<number, number>;
}
interface Reader { read: () => EnteredTileReadout }
const readers = new WeakMap<Scope, Reader>();
let latest: { readonly owner: Scope; readonly reader: Reader } | null = null;

/** Publish a native driver or data streamer's existing state, without allocating tiles or installing a scheduler. */
export function noteEnteredTiles(owner: Scope, read: () => EnteredTileReadout): void {
  if (owner.disposed || owner.disposing) throw new Error('Entered tile readout owner left');
  let reader = readers.get(owner);
  if (reader === undefined) {
    reader = { read }; readers.set(owner, reader);
    const owned = reader;
    owner.onDispose(() => { readers.delete(owner); if (latest?.reader === owned) latest = null; });
  } else reader.read = read;
  latest = { owner, reader };
}
/** Borrow scalars only for the currently entered owner; disposal drops the last strong readout reference. */
export function enteredTiles(): EnteredTileReadout | null {
  return latest === null || latest.owner.disposed || latest.owner.disposing ? null : latest.reader.read();
}

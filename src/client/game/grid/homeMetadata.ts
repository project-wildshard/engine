import type { SessionState } from '../session/context';
import type { Scope } from '@wildshard/engine/app/scope';

interface MetadataOwner { readonly disposed: boolean; readonly disposing: boolean; onDispose: (release: () => void) => void }
interface MetadataLease { readonly release: () => void }

/** Match the original initial-home entry condition; road recovery needs no home. */
export function initialHomeMetadataRequired(session: Pick<SessionState, 'ownedGridHome' | 'recovery'>): boolean {
  return session.ownedGridHome === true && (session.recovery === undefined || session.recovery.saved?.location.kind === 'cell');
}

/** Start only a known initial home's required metadata. Keep its original
 * rejection for the Home barrier, and its one real lease on the page owner. */
export function prepareHomeMetadata(owner: MetadataOwner, read: () => Promise<MetadataLease | null> | null): Promise<void> {
  const ready = Promise.resolve().then(() => {
    if (owner.disposed || owner.disposing) throw new Error('Initial home metadata owner left');
    return read();
  }).then(metadata => {
    if (metadata === null) return undefined;
    if (owner.disposed || owner.disposing) { metadata.release(); throw new Error('Initial home metadata owner left'); }
    owner.onDispose(metadata.release);
    return undefined;
  });
  // The consumer still awaits this exact rejected promise at its original
  // barrier. An earlier page-setup failure cannot leave an unhandled rejection.
  void ready.catch(() => undefined);
  return ready;
}

/** The page remains the product-cache owner. Only the borrowed metadata lease
 * belongs to this child lifetime, so failed session creation cannot retain it.
 * Metadata rejection stays behind the original Home wait; it never rejects an
 * otherwise successful session constructor. */
export async function withInitialHomeMetadata<T>(owner: Scope, read: () => Promise<MetadataLease | null> | null,
  create: (ready: Promise<void>) => Promise<T>): Promise<T> {
  const lifetime = owner.child('initial home metadata');
  const ready = prepareHomeMetadata(lifetime, read);
  try { return await create(ready); }
  catch (error) { lifetime.dispose(); throw error; }
}

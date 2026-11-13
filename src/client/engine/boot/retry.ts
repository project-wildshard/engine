import { recoverChunkFailure } from './browserChunkRecovery';
/** Load a module once. A stale deployment starts a new document once; retrying
 * a rejected module URL in this document cannot repair WebKit's module map.
 * The historical name remains for callers outside the title entry.
 */
export async function retried<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (error) {
    // QA 11-12 row 36: an offline page's failed read is the network, not a newer build: fail now, onto the card's RETRY
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw error;
    if (await recoverChunkFailure(error)) return new Promise<never>(() => { /* The new document resumes the original entry. */ });
    throw error;
  }
}

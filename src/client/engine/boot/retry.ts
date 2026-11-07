import { recoverChunkFailure } from './browserChunkRecovery';
/** Load a module once. A stale deployment starts a new document once; retrying
 * a rejected module URL in this document cannot repair WebKit's module map.
 * The historical name remains for callers outside the title entry.
 */
export async function retried<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (error) {
    if (await recoverChunkFailure(error)) return new Promise<never>(() => { /* The new document resumes the original entry. */ });
    throw error;
  }
}

import type { Scope } from '@wildshard/engine/app/scope';
import { workSlice } from '@wildshard/engine/core/workSlice';

/** Completed foundation stages share the existing page/frame CPU slice. Keep
 * the injected yield when due, and the retirement fence at every checkpoint. */
export function regionalBuildCheckpoint(owner: Scope, pause: () => Promise<void>): () => Promise<void> {
  let slice = workSlice(undefined, owner);
  const live = (): void => {
    if (owner.disposed || owner.disposing) throw new Error('Regional world left during foundation construction');
  };
  return async () => {
    live();
    if (slice.due()) {
      await pause();
      slice = workSlice(undefined, owner);
    }
    live();
  };
}

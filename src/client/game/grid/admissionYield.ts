import type { Scope } from '@wildshard/engine/app/scope';
import { presenting } from '@wildshard/engine/core/framePacing';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { diagnosticNow } from '@wildshard/engine/core/clock';

/** Before the game draws (the loading screen), construction pieces run back to back this long before a paint boundary. */
const LOADER_SLICE_MS = 12;
let loaderSliceStart = -Infinity;
/** Cheap regional construction pieces share the engine's bounded build slice rather than each consuming a full
 * painted frame. In play that is the engine's build slice; on the loading screen it is LOADER_SLICE_MS of pieces, then
 * one paint boundary (a boundary per piece made the home's 5 custom schemas, ~20 pauses, take 0.49 s of Home region on
 * the Simulator, nearly all of it waiting for frames). Admission checkpoints still use the unconditional paint boundary
 * below. A retired scope rejects either way. */
export function yieldGridConstruction(scope: Scope): Promise<void> {
  if (presenting()) return buildYield(scope);
  if (scope.disposed) return Promise.reject(new Error('Grid admission scope disposed'));
  if (diagnosticNow() - loaderSliceStart < LOADER_SLICE_MS) return Promise.resolve();
  return yieldGridAdmission(scope).then(() => { loaderSliceStart = diagnosticNow(); return undefined; });
}

/** End an admission batch after a browser paint opportunity, so the road and G217 loading screen keep drawing.
 * Node has no presentation loop; cancellation rejects the pending batch before any further allocation. */
export function yieldGridAdmission(scope: Scope): Promise<void> {
  if (scope.disposed) return Promise.reject(new Error('Grid admission scope disposed'));
  if (typeof globalThis.requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const forget = scope.capture('disposers', () => {
      if (done) return;
      done = true; reject(new Error('Grid admission scope disposed'));
    });
    scope.raf(() => { scope.timeout(0, () => {
      if (done) return;
      done = true; forget(); resolve();
    }); });
  });
}

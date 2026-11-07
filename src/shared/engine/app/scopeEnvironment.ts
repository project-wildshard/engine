import type { Object3D } from 'three';
import type { Disposable3 } from './scope';

/** Native frame scheduling and diagnostic target classification are injected by the browser entry. */
export interface ScopeEnvironment {
  /** Exact native mesh classification; absent on pure simulation hosts. */
  primitives?: (root: Object3D, own: (resource: Disposable3) => void, instances: boolean) => void;
  targetKind: (target: EventTarget) => 'window' | 'document' | 'canvas' | 'other';
  frame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  /** Whether `frame` can schedule now (the browser's needs a native rAF); absent: any frame but the bare one can. */
  framesAvailable?: () => boolean;
  /** Browser-owned requests share one native carrier; logical owners retain cancellation. */
  sharedFrames?: boolean;
  framePending?: () => boolean;
}
const bareFrame = (): number => { throw new Error('Frame scheduling is unavailable in this host'); };
let environment: ScopeEnvironment = {
  targetKind: () => 'other', frame: bareFrame,
  cancelFrame: () => { /* No browser frame exists in a bare host. */ },
};
/** Install native presentation services explicitly; simulation scopes retain ownership without them. */
export function installScopeEnvironment(value: ScopeEnvironment): void { environment = value; }
export function scopeEnvironment(): ScopeEnvironment { return environment; }
/** Whether the installed environment schedules native frames: a bare simulation host (no environment installed, or one
 *  that keeps the bare frame) has none, so a frame wait settles at once instead of throwing. */
export function framesAvailable(): boolean { return environment.framesAvailable?.() ?? environment.frame !== bareFrame; }

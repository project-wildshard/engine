import type { Scope } from '@wildshard/engine/app/scope';
import { TIER } from '@wildshard/engine/core/tier';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import type { RoadSign } from '../../../shared/game/grid/roadLayout';
import { coverageTable } from './roadSolid';
import { roadSignPaintLayout, type RoadSignSource } from './roadSignPaint';
import { roadSignScale } from './roadSignScale';

export interface RoadSignPreparation { readonly ready: Promise<void>; readonly get: RoadSignSource; readonly release: () => void }
interface SignWorkerLease { readonly worker: Worker; readonly reusable: boolean; readonly release: (completed: boolean) => void }
type SignWorkerSource = () => SignWorkerLease;

function startSignWorker(): Worker {
  return new Worker(new URL('roadSign.worker.ts', import.meta.url), { type: 'module', name: 'grid-road-signs' });
}
function oneShotSignWorker(): SignWorkerLease {
  const worker = startSignWorker();
  return { worker, reusable: false, release: () => { worker.terminate(); } };
}

/** Reuse the grid's painter across banks. Retiring a canvas worker can block a
 * desktop frame while Blink waits for GPU commands. An overlapping bank gets
 * its own worker, and a failed, cancelled or timed out job retires its worker. */
export function roadSignWorkerSource(owner: Scope,
  reuse: boolean = TIER === 'desktop' && jsonSlot('debug.worldWatchDrawCheck', 'device').read() === true): SignWorkerSource {
  if (!reuse) return oneShotSignWorker;
  let worker: Worker | undefined;
  let busy = false;
  const stop = (): void => { worker?.terminate(); worker = undefined; };
  owner.onDispose(stop);
  return () => {
    if (busy) return oneShotSignWorker();
    const reader = worker ??= startSignWorker();
    busy = true;
    return { worker: reader, reusable: true, release: completed => {
      busy = false;
      if (!completed) stop();
    } };
  };
}

/** One road bank's scoped coverage; exact original main-thread painting remains the fallback. */
export function startRoadSigns(parent: Scope, allocator: ResidencyAllocator, home: string, signs: readonly RoadSign[],
  phase: 'initial' | 'outer' = 'initial', acquire: SignWorkerSource = oneShotSignWorker): RoadSignPreparation | undefined {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || parent.disposed || parent.disposing) return undefined;
  const layout = roadSignPaintLayout(signs, roadSignScale()), rows = [...layout.lines.values()], signature = JSON.stringify(rows), count = layout.width * layout.height;
  if (rows.length > 2048 || count > 16 * 1024 * 1024 || signature.length > 131072) return undefined;
  // Canvas + RGBA readback + final RG8 + conversion lookup; duplicated job text is bounded too.
  // T10: claimed at once: a stepped eviction here (6369cf2558, retired with the rest of it) kept the evicted world
  // resident while the drive's other admissions went on, raising the Pine drive's claims peak 182 -> 190-197 MB
  const lease = allocator.reserve({ id: `product:grid:road-signs:${home}${phase === 'outer' ? ':outer' : ''}`, category: 'product', owner: home,
    bytes: count * 10 + 131072 + signature.length * 4 + 1024, distance: 0, needed: true });
  if (lease === null) return undefined;
  if (parent.disposed || parent.disposing) { lease.release(); return undefined; }
  const scope = parent.child(phase === 'outer' ? 'road-signs-outer' : 'road-signs'); let painter: SignWorkerLease | undefined, plane: Uint8Array<ArrayBuffer> | undefined;
  let settled = false, complete: (() => void) | undefined, deadline: ReturnType<Scope['timeout']> | undefined;
  const ready = new Promise<void>(resolve => { complete = resolve; }), listeners: (() => void)[] = [];
  const stop = (completed: boolean): void => {
    scope.cancelTimer(deadline); deadline = undefined;
    for (const forget of listeners.splice(0)) forget();
    painter?.release(completed); painter = undefined;
  };
  const finish = (): void => { if (!settled) { settled = true; complete?.(); complete = undefined; } };
  scope.onDispose(() => { stop(false); plane = undefined; lease.release(); finish(); });
  const failed = (message: string): void => { console.warn(`[grid] worker signs use original painting: ${message}`); scope.dispose(); };
  try {
    painter = acquire();
    const { worker, reusable } = painter;
    listeners.push(scope.listen(worker, 'message', event => {
      const reply: unknown = event.data;
      if (typeof reply !== 'object' || reply === null) { failed('invalid reply'); return; }
      const pixels: unknown = Reflect.get(reply, 'pixels');
      if (!(pixels instanceof Uint8Array) || !(pixels.buffer instanceof ArrayBuffer) || pixels.length !== count * 2
        || Reflect.get(reply, 'width') !== layout.width || Reflect.get(reply, 'height') !== layout.height || plane !== undefined) { failed('unavailable or malformed plane'); return; }
      plane = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length); stop(true); finish();
    }));
    listeners.push(scope.listen(worker, 'error', event => { event.preventDefault(); failed('worker failed'); }));
    listeners.push(scope.listen(worker, 'messageerror', () => { failed('transfer failed'); }));
    deadline = scope.timeout(30_000, () => { failed('worker deadline'); });
    const colours = { from: '#0d6b3c', to: '#e9ebe6', blueFromRed: 0.45, sentinel: { v: 1.5, colour: '#6f7378' } };
    worker.postMessage({ rows, scale: layout.scale, reusable, red: coverageTable(colours, 0), green: coverageTable(colours, 1) }, { transfer: [] });
  } catch (error) { failed(error instanceof Error ? error.message : String(error)); }
  return { ready, get: current => settled && current.width === layout.width && current.height === layout.height && current.scale === layout.scale
    && JSON.stringify([...current.lines.values()]) === signature ? plane : undefined, release: () => { scope.dispose(); } };
}

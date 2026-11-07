import type { Scope } from '@wildshard/engine/app/scope';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { ROAD_GRAIN_PLANES, type RoadGrainKind, type RoadGrainPixels, type RoadGrainSource } from './roadGrain';

export interface RoadGrainPreparation { readonly ready: Promise<void>; readonly get: RoadGrainSource; readonly release: () => void }

/** Two fixed planes, charged before painting and owned by this construction; no game texture/scene publication. */
export function startRoadGrain(parent: Scope, allocator: ResidencyAllocator, home: string): RoadGrainPreparation | undefined {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || parent.disposed || parent.disposing) return undefined;
  const bytes = Object.values(ROAD_GRAIN_PLANES).reduce((sum, row) => sum + row.width * row.height * 8, 0);
  const lease = allocator.reserve({ id: `product:grid:road-grain:${home}`, category: 'product', owner: home, bytes, distance: 0, needed: true });
  if (lease === null) return undefined;
  const scope = parent.child('road-grain'), planes = new Map<RoadGrainKind, RoadGrainPixels>();
  let worker: Worker | undefined, settled = false, complete: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { complete = resolve; });
  const listeners: (() => void)[] = [];
  let deadline: ReturnType<Scope['timeout']> | undefined;
  const stopWorker = (): void => {
    scope.cancelTimer(deadline); deadline = undefined;
    for (const forget of listeners.splice(0)) forget();
    worker?.terminate(); worker = undefined;
  };
  const finish = (): void => { if (!settled) { settled = true; complete?.(); complete = undefined; } };
  scope.onDispose(() => { stopWorker(); planes.clear(); lease.release(); finish(); });
  const failed = (message: string): void => { console.warn(`[grid] worker grain uses original painting: ${message}`); scope.dispose(); };
  try {
    worker = new Worker(new URL('roadGrain.worker.ts', import.meta.url), { type: 'module', name: 'grid-road-grain' });
    listeners.push(scope.listen(worker, 'message', event => {
      const reply: unknown = event.data;
      if (typeof reply !== 'object' || reply === null) { failed('invalid reply'); return; }
      const kind: unknown = Reflect.get(reply, 'kind'), pixels: unknown = Reflect.get(reply, 'pixels'), fillStyle: unknown = Reflect.get(reply, 'fillStyle');
      if (kind !== 'asphalt' && kind !== 'junction') { failed('invalid plane'); return; }
      const { width, height } = ROAD_GRAIN_PLANES[kind];
      if (!(pixels instanceof Uint8ClampedArray) || !(pixels.buffer instanceof ArrayBuffer) || pixels.length !== width * height * 4
        || typeof fillStyle !== 'string' || fillStyle.length > 256 || planes.has(kind)) { failed('unavailable or malformed plane'); return; }
      planes.set(kind, { pixels: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), fillStyle });
      if (planes.size === 2) { stopWorker(); finish(); }
    }));
    listeners.push(scope.listen(worker, 'error', event => { event.preventDefault(); failed('worker failed'); }));
    listeners.push(scope.listen(worker, 'messageerror', () => { failed('transfer failed'); }));
    deadline = scope.timeout(30_000, () => { failed('worker deadline'); });
    worker.postMessage('asphalt', { transfer: [] }); worker.postMessage('junction', { transfer: [] });
  } catch (error) { failed(error instanceof Error ? error.message : String(error)); }
  return { ready, get: kind => settled && planes.size === 2 ? planes.get(kind) : undefined, release: () => { scope.dispose(); } };
}

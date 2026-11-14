import type { Scope } from '@wildshard/engine/app/scope';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import type { RoadSign } from '../../../shared/game/grid/roadLayout';
import { coverageTable } from './roadSolid';
import { roadSignPaintLayout, type RoadSignSource } from './roadSignPaint';
import { roadSignScale } from './roadSignScale';

export interface RoadSignPreparation { readonly ready: Promise<void>; readonly get: RoadSignSource; readonly release: () => void }
/** One road bank's scoped coverage; exact original main-thread painting remains the fallback. */
export function startRoadSigns(parent: Scope, allocator: ResidencyAllocator, home: string, signs: readonly RoadSign[], phase: 'initial' | 'outer' = 'initial'): RoadSignPreparation | undefined {
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
  const scope = parent.child(phase === 'outer' ? 'road-signs-outer' : 'road-signs'); let worker: Worker | undefined, plane: Uint8Array<ArrayBuffer> | undefined;
  let settled = false, complete: (() => void) | undefined, deadline: ReturnType<Scope['timeout']> | undefined;
  const ready = new Promise<void>(resolve => { complete = resolve; }), listeners: (() => void)[] = [];
  const stop = (): void => { scope.cancelTimer(deadline); deadline = undefined; for (const forget of listeners.splice(0)) forget(); worker?.terminate(); worker = undefined; };
  const finish = (): void => { if (!settled) { settled = true; complete?.(); complete = undefined; } };
  scope.onDispose(() => { stop(); plane = undefined; lease.release(); finish(); });
  const failed = (message: string): void => { console.warn(`[grid] worker signs use original painting: ${message}`); scope.dispose(); };
  try {
    worker = new Worker(new URL('roadSign.worker.ts', import.meta.url), { type: 'module', name: 'grid-road-signs' });
    listeners.push(scope.listen(worker, 'message', event => {
      const reply: unknown = event.data;
      if (typeof reply !== 'object' || reply === null) { failed('invalid reply'); return; }
      const pixels: unknown = Reflect.get(reply, 'pixels');
      if (!(pixels instanceof Uint8Array) || !(pixels.buffer instanceof ArrayBuffer) || pixels.length !== count * 2
        || Reflect.get(reply, 'width') !== layout.width || Reflect.get(reply, 'height') !== layout.height || plane !== undefined) { failed('unavailable or malformed plane'); return; }
      plane = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length); stop(); finish();
    }));
    listeners.push(scope.listen(worker, 'error', event => { event.preventDefault(); failed('worker failed'); }));
    listeners.push(scope.listen(worker, 'messageerror', () => { failed('transfer failed'); }));
    deadline = scope.timeout(30_000, () => { failed('worker deadline'); });
    const colours = { from: '#0d6b3c', to: '#e9ebe6', blueFromRed: 0.45, sentinel: { v: 1.5, colour: '#6f7378' } };
    worker.postMessage({ rows, scale: layout.scale, red: coverageTable(colours, 0), green: coverageTable(colours, 1) }, { transfer: [] });
  } catch (error) { failed(error instanceof Error ? error.message : String(error)); }
  return { ready, get: current => settled && current.width === layout.width && current.height === layout.height && current.scale === layout.scale
    && JSON.stringify([...current.lines.values()]) === signature ? plane : undefined, release: () => { scope.dispose(); } };
}

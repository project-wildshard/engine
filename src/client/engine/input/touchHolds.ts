import type { Scope } from '../../../shared/engine/app/scope';
import { listenDom } from './dom';

/**
 * QA-FEEDBACK 11-19 row 21 (Jake, iPhone, Driftwood): the move stick stuck pinned up-left in SPRINT and no touch could
 * move it. The touch layer holds a pointer per control (stick, look, attack) until its pointerup or pointercancel, and a
 * held control ignores every new finger in its zone. A lift that never arrives (an app switch mid-drag, a lost capture,
 * an overlay opened over the stick) stranded it for good.
 *
 * Nothing may strand a hold now:
 *  - the page hides, loses focus or unloads (visibilitychange hidden, blur, pagehide): every hold is released;
 *  - the layer loses a pointer's capture (lostpointercapture): that hold is released;
 *  - an overlay opens or closes over the layer (`overlayChanged`; app state changes are wired by the layer): all released;
 *  - every new touch re-checks the holds against TouchEvent.touches: a hold with no finger near its last spot is stale and
 *    is released, so the finger that found the stick stuck takes it at once.
 */
const NEAR_PX = 48;

export interface Spot { readonly clientX: number; readonly clientY: number }

export class TouchHolds {
  private readonly held = new Map<number, { x: number; y: number }>();
  /** holds taken since the last check: the new fingers' own (WebKit fires pointerdown before touchstart) */
  private readonly fresh = new Set<number>();
  private readonly drop: (pointerId: number) => void;
  /** `drop(id)` ends that control exactly as its lift would */
  constructor(drop: (pointerId: number) => void) { this.drop = drop; }
  hold(pointerId: number, x: number, y: number): void { this.held.set(pointerId, { x, y }); this.fresh.add(pointerId); }
  move(pointerId: number, x: number, y: number): void { const h = this.held.get(pointerId); if (h !== undefined) { h.x = x; h.y = y; } }
  lift(pointerId: number): void { this.held.delete(pointerId); this.fresh.delete(pointerId); }
  get size(): number { return this.held.size; }
  releaseAll(): void { for (const id of this.held.keys()) this.release(id); }
  release(pointerId: number): void { if (this.held.has(pointerId)) { this.drop(pointerId); this.held.delete(pointerId); } }
  /** the fingers already down when a new touch starts: a hold none of them is near is stale. Returns the ids released. */
  revalidate(fingers: readonly Spot[]): number[] {
    const free = [...fingers], stale: number[] = [];
    for (const [id, at] of this.held) {
      if (this.fresh.has(id)) continue;
      let best = -1, bestD = NEAR_PX;
      free.forEach((f, i) => { const d = Math.hypot(f.clientX - at.x, f.clientY - at.y); if (d <= bestD) { best = i; bestD = d; } });
      if (best < 0) stale.push(id); else free.splice(best, 1);
    }
    this.fresh.clear();
    for (const id of stale) this.release(id);
    return stale;
  }
}

/** the fingers that were already down when this touchstart began */
export function fingersBefore(e: TouchEvent): Spot[] {
  const fresh = new Set<number>();
  for (const t of Array.from(e.changedTouches)) fresh.add(t.identifier);
  return Array.from(e.touches).filter(t => !fresh.has(t.identifier));
}

const overlayListeners = new Set<() => void>();
/** an overlay (a panel, sheet or menu that can sit over the touch layer) opened or closed: release every touch hold */
export function overlayChanged(): void { for (const fn of overlayListeners) fn(); }

/** Wire the page-level release paths for one touch layer. `revalidated` runs after each new touch's check. */
export function wireTouchHolds(scope: Scope, root: HTMLElement, holds: TouchHolds, revalidated: () => void): void {
  const all = (): void => { holds.releaseAll(); };
  listenDom(scope, window, 'blur', all);
  listenDom(scope, window, 'pagehide', all);
  listenDom(scope, document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') all(); });
  listenDom(scope, root, 'lostpointercapture', (e) => { if (e.target === root) holds.release(e.pointerId); });
  listenDom(scope, root, 'touchstart', (e) => { holds.revalidate(fingersBefore(e)); revalidated(); }, { capture: true, passive: true });
  overlayListeners.add(all);
  scope.onDispose(() => { overlayListeners.delete(all); });
}

import { listenDom, listenPage } from '../input/dom';
import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
/**
 * TouchFly — the phone's god-mode flight controls for the World Explorer (project/archive/2026-09-23-explore-world.md X2, mockups
 * art/build-world/round-4-god-mode-flight/). Drives the same FreeCam the desktop keys do:
 *
 *   FLY stick (bottom-left)       → cam.move.x / .z  (strafe / forward along the view)
 *   one finger anywhere else      → spin the view (cam.look), or orbit the pivot while an orbit target is set
 *   two fingers                   → pinch = fly forward / back (cam.dolly)
 *   ▲ / ▼ (held)                  → cam.move.y (Explore binds them with `holdButton`, below)
 *   a tap (no drag)               → onTap(x, y) — Explore selects what is under it
 *
 *   const fly = new TouchFly(layer, cam, host); fly.onTap = (x, y) => …; fly.orbiting = true / false;
 *
 * Multi-touch (E329, Jake on his iPhone: "I can't change speed whilst flying"): every control keeps its own fingers by
 * pointerId and captures them on its own element: the stick one thumb, the world any others (look / pinch), each rail
 * button its own. Nothing ends or steals another control's finger. The overlay's plain buttons (SPEED, MAP, ORBIT, the
 * tabs …) listen for `click`, which the browser synthesises only for a one-finger tap: iOS WebKit and Chrome both drop
 * the tap once a second touch is on the glass, so with the stick held the SPEED chip went dead. `MultiTouchTaps` relays
 * those taps (below). The pattern is the play deck's (src/client/engine/player/TouchControls.ts: pointer ids, capture, act on the
 * pointer, not on click).
 */
import type { FreeCam } from './FreeCam';

const TOUCH_LOOK = 0.0042; // rad / px — a phone swipe is shorter than a mouse drag
const STICK_R = 46;        // px — the thumb's travel
const TAP_SLOP = 14;       // px — a button touch that travels further than this is not a tap
const RELAY_SWALLOW_MS = 700; // the browser's own click for a relayed tap, should one still come, lands inside this

/** capture a finger on its control's element (its moves and lift follow it anywhere); a pointer already gone throws */
function capture(el: HTMLElement, id: number): void {
  try { el.setPointerCapture(id); } catch { /* lifted before we got here: its pointerup is on its way */ }
}

/**
 * A held button (the rail's ▲ / ▼): held while any finger that went down on it is still down. It keeps its own pointer
 * ids and captures them on itself, and only that finger's lift or cancel lets go: no pointerleave, and another control's
 * finger never touches it, so it holds beside the stick and a look drag (E329). The lift is heard on the window (capture
 * phase), so a hold still ends if the rail hides under the finger and the capture is lost. Lit `.on` while held.
 */
export function holdButton(b: HTMLElement, onHold: (held: boolean) => void): void {
  const scope = (app.levelScope ?? app.engineScope).child('fly-held-button');
  scope.onDispose(() => { onHold(false); });
  const ids = new Set<number>();
  listenDom(scope, b, 'pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    capture(b, e.pointerId);
    ids.add(e.pointerId);
    if (ids.size === 1) { b.classList.add('on'); onHold(true); }
  });
  const up = (e: PointerEvent): void => {
    if (!ids.delete(e.pointerId) || ids.size > 0) return;
    b.classList.remove('on'); onHold(false);
  };
  listenPage(scope, 'pointerup', up, { capture: true });
  listenPage(scope, 'pointercancel', up, { capture: true });
}

interface PendingTap { btn: HTMLButtonElement; x: number; y: number; shared: boolean }

/**
 * Taps on the overlay's buttons while another finger is on the glass (E329). A button that acts on `click` gets that
 * click from the browser only for a one-finger tap, so with the stick held a tap on SPEED (or MAP, ORBIT, a tab) did
 * nothing. Every touch is tracked by pointerId; a tap on a button that shared the glass with another finger at any point
 * (down and up on the same button, under TAP_SLOP px of travel) gets its click dispatched here. The browser's own click,
 * should one still come for that tap, is swallowed, so it never fires twice. A one-finger tap is left to the browser.
 * The listeners are passive observers in the capture phase: nothing is prevented, stopped or released.
 */
class MultiTouchTaps {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  private readonly down = new Set<number>();
  private readonly taps = new Map<number, PendingTap>();
  private relayed: { btn: HTMLElement; until: number } | null = null;

  private readonly overlay: HTMLElement;
  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
    listenPage(this.uiScope, 'pointerdown', this.onDown, { capture: true });
    listenPage(this.uiScope, 'pointerup', this.onUp, { capture: true });
    listenPage(this.uiScope, 'pointercancel', this.onCancel, { capture: true });
    listenDom(this.uiScope, window, 'click', this.onClick, true);
    listenDom(this.uiScope, document, 'visibilitychange', this.onHidden);
  }

  dispose(): void {
    this.uiScope.dispose(); this.down.clear(); this.taps.clear(); this.relayed = null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.down.add(e.pointerId);
    if (this.down.size > 1) for (const t of this.taps.values()) t.shared = true; // a finger landed during their tap
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn === null || !this.overlay.contains(btn)) return;
    this.taps.set(e.pointerId, { btn, x: e.clientX, y: e.clientY, shared: this.down.size > 1 });
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.down.delete(e.pointerId);
    const t = this.taps.get(e.pointerId);
    if (t === undefined) return;
    this.taps.delete(e.pointerId);
    if (!t.shared || t.btn.disabled || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) return;
    const under = document.elementFromPoint(e.clientX, e.clientY); // the finger's target is the captured button, wherever it is
    if (under === null || !t.btn.contains(under)) return;
    this.relayed = { btn: t.btn, until: performance.now() + RELAY_SWALLOW_MS };
    t.btn.click();
  };

  private readonly onCancel = (e: PointerEvent): void => { this.down.delete(e.pointerId); this.taps.delete(e.pointerId); };

  /** the browser's own click for a tap already relayed */
  private readonly onClick = (e: MouseEvent): void => {
    const r = this.relayed;
    if (r === null || !e.isTrusted) return;
    if (performance.now() > r.until) { this.relayed = null; return; }
    if (e.target instanceof Node && r.btn.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); this.relayed = null; }
  };

  /** the app went to the background mid-touch: its lifts may never come */
  private readonly onHidden = (): void => { if (document.hidden) { this.down.clear(); this.taps.clear(); } };
}

interface Finger { id: number; x: number; y: number; x0: number; y0: number; t0: number; moved: boolean }

export class TouchFly {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  onTap?: (x: number, y: number) => void;
  /** one finger orbits `cam.pivot` instead of turning the head (a selected object) */
  orbiting = false;
  /** off outside the World Explorer (the Model Explorer's turntable takes the fingers there) */
  enabled = true;
  readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private stickId: number | null = null;
  private stickX = 0; private stickY = 0;
  private readonly fingers = new Map<number, Finger>();
  private pinch = 0;
  private readonly taps: MultiTouchTaps;

  private readonly surface: HTMLElement;
  private readonly cam: FreeCam;
  constructor(surface: HTMLElement, cam: FreeCam, host: HTMLElement) {
    this.surface = surface;
    this.cam = cam;
    this.stick = document.createElement('div'); this.stick.className = 'ws-x-stick';
    this.knob = document.createElement('i'); this.stick.append(this.knob);
    const label = document.createElement('b'); label.textContent = engineString('s_31bbe05d4315'); this.stick.append(label);
    host.append(this.stick);
    this.taps = new MultiTouchTaps(host.closest<HTMLElement>('.ws-x') ?? host);
    listenDom(this.uiScope, this.stick, 'pointerdown', this.onStickDown);
    listenDom(this.uiScope, surface, 'pointerdown', this.onDown);
    listenPage(this.uiScope, 'pointermove', this.onMove);
    listenPage(this.uiScope, 'pointerup', this.onUp);
    listenPage(this.uiScope, 'pointercancel', this.onUp);
    this.uiScope.onDispose(() => { this.taps.dispose(); this.stick.remove(); this.fingers.clear(); this.stickId = null; this.cam.move.set(0, 0, 0); });
  }

  /** hold a vertical button: +1 up, −1 down, 0 released */
  vertical(v: number): void { this.cam.move.y = v; }

  dispose(): void {
    this.taps.dispose();
    this.stick.remove();
    this.uiScope.dispose(); this.fingers.clear(); this.stickId = null;
    this.cam.move.set(0, 0, 0);
  }

  private setStick(dx: number, dy: number): void {
    const d = Math.hypot(dx, dy), k = d > STICK_R ? STICK_R / d : 1;
    this.stickX = dx * k; this.stickY = dy * k;
    this.knob.style.transform = `translate(${this.stickX}px, ${this.stickY}px)`;
    this.cam.move.x = this.stickX / STICK_R;
    this.cam.move.z = -this.stickY / STICK_R;
  }

  private readonly onStickDown = (e: PointerEvent): void => {
    e.preventDefault(); e.stopPropagation();
    if (this.stickId !== null) return; // one thumb flies: a second finger on the stick neither takes it over nor ends it
    this.stickId = e.pointerId;
    capture(this.stick, e.pointerId);
    const r = this.stick.getBoundingClientRect();
    this.stick.classList.add('on');
    this.setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || !this.enabled) return; // the desktop mouse belongs to FreeCam
    e.preventDefault();
    capture(this.surface, e.pointerId);
    this.fingers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
    if (this.fingers.size === 2) this.pinch = this.spread();
  };

  private spread(): number {
    const [a, b] = [...this.fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      const r = this.stick.getBoundingClientRect();
      this.setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      return;
    }
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX; f.y = e.clientY;
    if (Math.hypot(f.x - f.x0, f.y - f.y0) > 8) f.moved = true;
    if (this.fingers.size >= 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.cam.dolly((s - this.pinch) / 260);
      this.pinch = s;
      return;
    }
    if (!f.moved) return;
    const k = TOUCH_LOOK / this.cam.lookSpeed; // FreeCam.look takes pixels at its own sensitivity
    if (this.orbiting) this.cam.orbit(dx * k, dy * k); else this.cam.look(dx * k, dy * k);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = null; this.stick.classList.remove('on');
      this.setStick(0, 0);
      return;
    }
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (this.fingers.size < 2) this.pinch = 0;
    if (e.type === 'pointerup' && !f.moved && performance.now() - f.t0 < 350 && this.fingers.size === 0) this.onTap?.(f.x, f.y);
  };
}

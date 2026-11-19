// @vitest-environment happy-dom
// QA-FEEDBACK 11-19 row 21 (Jake, iPhone, Driftwood): the move stick stuck pinned up-left in SPRINT, and no touch could
// move it. Each path that can lose the stick's lift must release it, and a stale stick resets on the next touch.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { PHASES } from '../app/systems';
import { installBrowserScopeEnvironment } from '../app/view/scopeEnvironment';
import { overlayChanged } from '../input/touchHolds';
import { TouchControls } from './TouchControls';
import type { Player } from './Player';

interface Body { touchMove: { x: number; y: number }; touchSprint: boolean; touchDodge: boolean; touchSurface: boolean; touchDive: boolean;
  submerged: boolean; swimming: boolean; hover: boolean; dodgeCooldown: number; lookMult: number; yaw: number; pitch: number }
const body = (): Body => ({ touchMove: { x: 0, y: 0 }, touchSprint: false, touchDodge: false, touchSurface: false, touchDive: false,
  submerged: false, swimming: false, hover: false, dodgeCooldown: 0, lookMult: 1, yaw: 0, pitch: 0 });
const kit = { enabled: true, adsHeld: false, altHeld: false, current: { charge: 0 }, tryFire: () => undefined };

let player: Body, layer: TouchControls, root: HTMLElement;
function mount(): void {
  installBrowserScopeEnvironment();
  document.body.innerHTML = '<div id="hud"></div>';
  player = body();
  const make: unknown = TouchControls;
  if (typeof make !== 'function') throw new Error('Missing touch layer');
  layer = Reflect.construct(make, [player satisfies Partial<Player>, kit, true]);
  const found = document.querySelector<HTMLElement>('.ws-touch');
  if (found === null) throw new Error('Missing touch root');
  root = found;
}
const pointer = (type: string, id: number, x: number, y: number): void => {
  root.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
};
/** a finger lands at (x, y) while `down` fingers are already on the glass (pointer events first, then touch, as WebKit) */
const touchDown = (id: number, x: number, y: number, down: readonly { id: number; x: number; y: number }[]): void => {
  pointer('pointerdown', id, x, y);
  const t = (f: { id: number; x: number; y: number }): Touch => new Touch({ identifier: f.id, target: root, clientX: f.x, clientY: f.y });
  const fresh = t({ id, x, y });
  root.dispatchEvent(new TouchEvent('touchstart', { touches: [...down.map(t), fresh], changedTouches: [fresh], targetTouches: [fresh], bubbles: true, cancelable: true }));
};
/** the stick held up-left in SPRINT (the move zone is the layer's left: in this page every rect is at 0, 0) */
const sprintUpLeft = (id = 1): void => {
  touchDown(id, 0, 0, []);
  pointer('pointermove', id, -40, -90);
  expect(player.touchSprint).toBe(true);
  expect(player.touchMove.x).toBeLessThan(0);
};
const released = (): void => {
  expect(player.touchMove).toEqual({ x: 0, y: 0 });
  expect(player.touchSprint).toBe(false);
};

describe('the move stick is never stranded', () => {
  beforeEach(mount);
  afterEach(() => {
    const scope: unknown = Reflect.get(layer, 'scope');
    if (scope instanceof Scope) scope.dispose();
    vi.restoreAllMocks();
  });

  test('a lift still releases it, as before', () => { sprintUpLeft(); pointer('pointerup', 1, -40, -90); released(); });
  test('pointercancel releases it', () => { sprintUpLeft(); pointer('pointercancel', 1, -40, -90); released(); });
  test('lostpointercapture on the layer releases it', () => { sprintUpLeft(); pointer('lostpointercapture', 1, -40, -90); released(); });
  test('window blur releases it', () => { sprintUpLeft(); window.dispatchEvent(new Event('blur')); released(); });
  test('pagehide releases it', () => { sprintUpLeft(); window.dispatchEvent(new Event('pagehide')); released(); });
  test('a hidden page releases it', () => {
    sprintUpLeft();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    released();
  });
  test('a visible page keeps a held stick', () => {
    sprintUpLeft();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(player.touchSprint).toBe(true);
  });
  test('an overlay opening or closing over it releases it (the frame meter panel, a menu)', () => {
    sprintUpLeft(); overlayChanged(); released();
    sprintUpLeft(2); app.events.emit('app.state', { prev: 'play', next: 'paused' }); app.events.flush(PHASES[0]); released();
  });
  test('a stale stick resets on the next touch, and that finger takes it at once', () => {
    sprintUpLeft();
    // the lift was lost: no finger is down any more, and a new one lands in the move zone, pushing down-right
    touchDown(7, 0, 0, []);
    pointer('pointermove', 7, 30, 20);
    expect(player.touchSprint).toBe(false);
    expect(player.touchMove.x).toBeGreaterThan(0);
    expect(player.touchMove.y).toBeLessThan(0);
    pointer('pointerup', 7, 30, 20); released();
  });
  test('a live stick keeps its hold when another finger lands', () => {
    sprintUpLeft();
    touchDown(8, 300, 0, [{ id: 1, x: -40, y: -90 }]);
    expect(player.touchSprint).toBe(true);
    pointer('pointerup', 8, 300, 0);
    expect(player.touchSprint).toBe(true);
  });
});

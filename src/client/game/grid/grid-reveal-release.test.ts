// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { installGridReveal } from './reveal';

const scopes: Scope[] = [];
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function arrival(ready = false, firstFrame = true) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const scope = new Scope('reveal.test'); scopes.push(scope);
  const hudRoot = document.createElement('div'); document.body.append(hudRoot);
  const controls = document.createElement('button'); controls.textContent = 'MOVE'; hudRoot.append(controls);
  const weapons = { enabled: true, visible: true, setEnabled(on: boolean): void { this.enabled = on; } };
  const viewmodel = { visible: true };
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  let late: () => void = () => { throw new Error('Missing late callback'); };
  const active = installGridReveal({ scope, camera: new PerspectiveCamera(), hudRoot, canvas, home: 'Driftwood Isle',
    onLate: fn => { late = () => { fn(1 / 30); }; }, ringsReady: () => ready, homeSimReady: () => ready,
    weapons, viewmodel, entered: () => true });
  // round 40: before the first gated frame the canvas holds no frame of this world and the HUD has nothing over it
  expect(hudRoot.classList.contains('ws-grid-revealing')).toBe(true);
  expect(canvas.style.visibility).toBe('hidden');
  if (firstFrame) {
    late();
    expect(hudRoot.classList.contains('ws-grid-revealing')).toBe(true);
    expect(canvas.style.visibility).toBe('');
  }
  const released = (): void => {
    expect(active()).toBe(false);
    expect(hudRoot.classList.contains('ws-grid-revealing')).toBe(false);
    expect(hudRoot.querySelector('.ws-grid-reveal')).toBeNull();
    expect(weapons).toMatchObject({ enabled: true, visible: true });
    expect(viewmodel.visible).toBe(true);
    const collect = vi.spyOn(app.input, 'clear');
    const input = app.systemsByPhase().input.find(system => system.id === 'game.grid.reveal.input');
    input?.run(0, 0);
    expect(collect).not.toHaveBeenCalled();
  };
  return { late, hudRoot, controls, released };
}

test('any touch skips at once and still reaches the control under it (G622 D1)', () => {
  const run = arrival();
  let touched = false;
  run.controls.addEventListener('pointerdown', () => { touched = true; });
  run.controls.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  run.released();
  expect(touched).toBe(true);
  expect(window.__wsReveal?.skipped).toBe(true);
});

test('a key since the last frame skips and goes through to the player', () => {
  const run = arrival();
  app.input.executeCommand({ kind: 'physical', code: 'KeyW', on: true, at: 0 });
  const clear = vi.spyOn(app.input, 'clear');
  app.systemsByPhase().input.find(system => system.id === 'game.grid.reveal.input')?.run(0, 0);
  expect(clear).not.toHaveBeenCalled();
  run.released();
  expect(window.__wsReveal?.skipped).toBe(true);
  clear.mockRestore(); app.input.clear();
});

test('a touch before the first frame skips the whole path', () => {
  const run = arrival(false, false);
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  run.late();
  run.released();
  expect(window.__wsReveal).toMatchObject({ skipped: true, endedMs: 0 });
});

test('real-time ceiling releases while gameplay and its clock are gated', () => {
  const run = arrival();
  const frameClock = app.clock.real;
  vi.advanceTimersByTime(5000);
  expect(app.clock.real).toBe(frameClock);
  run.released();
  expect(window.__wsReveal).toMatchObject({ ceiling: true, endedMs: 5000 });
});

test('opening and closing a pause menu during arrival leaves it usable', () => {
  const run = arrival();
  window.dispatchEvent(new Event('ws-menu'));
  run.released();
  window.dispatchEvent(new Event('ws-menu'));
  run.late();
  run.released();
});

test('background and return release without needing a resumed gameplay frame', () => {
  const run = arrival();
  document.dispatchEvent(new Event('ws:background'));
  run.released();
  document.dispatchEvent(new Event('visibilitychange'));
  run.late();
  run.released();
});

test('a visible return alone releases an arrival whose hidden event was missed', () => {
  const run = arrival();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  run.released();
});

test('the three-second path hands over control without waiting for the rings or the home handoff', () => {
  const run = arrival(false);
  vi.advanceTimersByTime(2900);
  run.late();
  expect(run.hudRoot.classList.contains('ws-grid-revealing')).toBe(true);
  vi.advanceTimersByTime(100);
  run.late();
  run.released();
  expect(window.__wsReveal).toMatchObject({ ceiling: false, skipped: false, ringsReadyMs: null, homeSimMs: null, endedMs: 3000 });
});

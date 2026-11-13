// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { app } from '../app/runtime';
import { DeathFade, DARK_UNTIL, FADE_IN, type DeathHooks } from './DeathFade';

const fades: DeathFade[] = [];
afterEach(() => { for (const fade of fades.splice(0)) fade.scope.dispose(); document.body.replaceChildren(); });

/** A death card and a log of when its hooks ran, in steps of `dt`. */
function dying(ready?: () => boolean): { fade: DeathFade; log: string[]; button: HTMLButtonElement; run: (seconds: number, dt?: number) => void } {
  const fade = new DeathFade({ now: 'Respawn now', waiting: 'Respawning…' }); fades.push(fade);
  const log: string[] = [];
  const hooks: DeathHooks = { dark: () => { log.push('dark'); }, done: () => { log.push('done'); }, skipped: () => { log.push('skipped'); }, ...(ready === undefined ? {} : { ready }) };
  fade.play('Fell too far', 'respawning at the spawn', hooks);
  const button = document.querySelector<HTMLButtonElement>('.ws-combat-death-now');
  if (button === null) throw new Error('no Respawn now button on the death card');
  return { fade, log, button, run: (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) fade.update(dt); } };
}

test('QA 11-13 (Jake: "It needs a button, a Respawn now button"): the death card shows a Respawn now button', () => {
  const { button } = dying();
  expect(button.textContent).toBe('Respawn now');
  expect(button.type).toBe('button');
  expect(button.disabled).toBe(false);
});

test('a tap on Respawn now respawns at once and gives control back after a short fade, long before the timer would', () => {
  const { fade, log, button, run } = dying();
  run(0.05);
  expect(log).toEqual([]);
  button.click();
  expect(log).toEqual(['dark', 'skipped']); // the respawn runs on the tap, not at the timer's dark; a server's world is asked too
  run(0.3);
  expect(log).toEqual(['dark', 'skipped', 'done']);
  expect(fade.active).toBe(false);
});

test('Respawn now after the respawn already ran skips the rest of the dark hold and never respawns twice', () => {
  const { log, button, run } = dying();
  run(0.45);
  expect(log).toEqual(['dark']);
  button.click(); button.click();
  run(0.3);
  expect(log).toEqual(['dark', 'skipped', 'done']);
});

test('the automatic wait is shorter than the old 1.8 s and still respawns then gives control back', () => {
  expect(DARK_UNTIL + FADE_IN).toBeLessThanOrEqual(1.4);
  const { log, run } = dying();
  run(DARK_UNTIL + FADE_IN + 0.05);
  expect(log).toEqual(['dark', 'done']);
});

test('a slow phone (10 fps and hitches) does not stretch the automatic wait much past its length', () => {
  const { log, run } = dying();
  run(DARK_UNTIL + FADE_IN + 0.25, 0.25);
  expect(log).toEqual(['dark', 'done']);
});

test('the respawn point not ready: the button says it is waiting and fires the moment it can', () => {
  let ready = false;
  const { log, button, run } = dying(() => ready);
  button.click();
  expect(log).toEqual([]);
  expect(button.classList.contains('waiting')).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.textContent).toBe('Respawning…');
  run(0.1);
  expect(log).toEqual([]);
  ready = true;
  run(1 / 60);
  expect(log).toEqual(['dark', 'skipped']);
  run(0.3);
  expect(log).toEqual(['dark', 'skipped', 'done']);
});

test('the timer also waits for the respawn point: no respawn under the dark until it is ready', () => {
  let ready = false;
  const { log, run } = dying(() => ready);
  run(DARK_UNTIL + FADE_IN + 1);
  expect(log).toEqual([]);
  ready = true;
  run(DARK_UNTIL + FADE_IN);
  expect(log).toEqual(['dark', 'done']);
});

test('Enter or Space on a keyboard presses Respawn now once the card shows; neither does anything once control is back', () => {
  for (const key of ['Enter', ' ']) {
    const { log, run } = dying();
    const press = (): KeyboardEvent => { const e = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : 'Enter', bubbles: true, cancelable: true }); window.dispatchEvent(e); return e; };
    expect(press().defaultPrevented).toBe(false); // a Space tapped during the fall never skips the card before it shows
    run(0.2);
    const e = press();
    expect(log).toEqual(['dark', 'skipped']);
    expect(e.defaultPrevented).toBe(true); // Space never also scrolls or reaches the game as a jump
    run(0.3);
    expect(log).toEqual(['dark', 'skipped', 'done']);
    press();
    expect(log).toEqual(['dark', 'skipped', 'done']);
  }
});

test('a focused button on a card over the death card keeps its own Enter and Space, and a paused game takes none', () => {
  const { log, run } = dying();
  run(0.2);
  const other = document.createElement('button'); document.body.append(other); other.focus();
  other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(log).toEqual([]);
  app.clock.paused = true;
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    expect(log).toEqual([]);
  } finally { app.clock.paused = false; }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
  expect(log).toEqual(['dark', 'skipped']);
});

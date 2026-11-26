// @vitest-environment happy-dom
// ZONE-ENTRY ZE23 (SENTRY-TRIAGE S21's lesson): a proof fails whenever the error card, the glitch chip or a faulted system
// shows, not only on an uncaught page error. Nalati's card read "Something broke" for two releases while zone-gate-proof,
// zone-pair-proof and journey-proof passed: a frame-loop system's throw is caught by Game.ts (console `[faults] ...`, no
// `pageerror`), and the proofs' modal selector `.ws-err` matched nothing (the card is `#wserr`).
// oxlint-disable-next-line import/no-nodejs-modules -- reads the proof scripts and the modal's source
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { cardNow, ERROR_CARD, faultProblem, recordCards, watchFaults } from '../src/scripts/proof-faults.mjs';

test('a faulted system, a stopped loop, a page error and a card each make a problem; other console lines do not', () => {
  expect(faultProblem('[faults] system "crash-test" threw: Error: forced system error (?crash=system)\n    at Object.run (control.js:2:86797)')).toBe('system "crash-test" faulted: Error: forced system error (?crash=system)');
  expect(faultProblem('[faults] core system "render" failed 3 times: the frame loop stops')).toBe('core system "render" stopped the frame loop');
  expect(faultProblem('[faults] a fault listener threw Error: x')).toBe('a fault listener threw: Error: x');
  expect(faultProblem('[proof-card] error card: grid.live: Cannot read properties of undefined')).toBe('the error card showed: grid.live: Cannot read properties of undefined');
  expect(faultProblem('[proof-card] glitch chip: Something glitched')).toBe('the glitch chip showed: Something glitched');
  expect(faultProblem('[grid] entered nalati-grasslands')).toBeNull();
  expect(faultProblem('[crash] forcing a "system" error')).toBeNull();
});

test('the card selector is the modal\'s real ids (ErrorModal.ts), never the class that matches nothing', () => {
  const modal = readFileSync('src/client/engine/ui/ErrorModal.ts', 'utf8');
  expect(modal).toContain("el.id = 'wserr';");
  expect(modal).toContain("chip.id = 'wserr-chip';");
  expect(ERROR_CARD).toBe('#wserr, #wserr-chip');
  // the screen samplers that call an error up a modal use the real id too
  expect(readFileSync('src/scripts/journey-proof.mjs', 'utf8')).not.toMatch(/\.ws-err\b/u);
  expect(readFileSync('src/scripts/staging-smoke/checks.mjs', 'utf8')).not.toMatch(/\.ws-err\b/u);
});

test('the page recorder logs every card that mounts once, and cardNow reads the one on screen', async () => {
  const logged: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => { logged.push(line); };
  try {
    recordCards();
    recordCards(); // idempotent: a second init script on the same document adds no second observer
    const card = document.createElement('div');
    card.id = 'wserr';
    card.innerHTML = '<div class="box"><p class="what"></p></div>';
    document.body.append(card);
    // ErrorModal mounts the card, then fills its line in the same task: the observer reads it after
    (card.querySelector('.what') as HTMLElement).textContent = 'grid.live: boom';
    const chip = document.createElement('div');
    chip.id = 'wserr-chip';
    chip.textContent = 'Something glitched';
    document.body.append(chip);
    await new Promise((done) => { setTimeout(done, 0); });
    expect(logged).toEqual(['[proof-card] error card: grid.live: boom', '[proof-card] glitch chip: Something glitched']);
    expect(cardNow()).toEqual(['error card: grid.live: boom', 'glitch chip: Something glitched']);
    card.remove(); chip.remove();
    expect(cardNow()).toEqual([]);
  } finally { console.warn = warn; }
});

/** a page that plays back what a real one emits */
function fakePage(onScreen: string[] = []) {
  const on: Record<string, ((value: unknown) => void)[]> = {};
  const scripts: unknown[] = [];
  return {
    scripts,
    on(event: string, fn: (value: unknown) => void) { (on[event] ??= []).push(fn); },
    addInitScript(fn: unknown) { scripts.push(fn); return Promise.resolve(); },
    evaluate() { return Promise.resolve(onScreen); },
    emit(event: string, value: unknown) { for (const fn of on[event] ?? []) fn(value); },
  };
}
const consoleLine = (text: string) => ({ text: () => text });

test('watchFaults: a page error, a faulted system and a card push into the proof\'s errors; a clean page pushes nothing', async () => {
  const clean = fakePage(), cleanErrors: string[] = [];
  const quiet = await watchFaults(clean as never, cleanErrors);
  clean.emit('console', consoleLine('[grid] entered nalati-grasslands'));
  await quiet.settle();
  expect(cleanErrors).toEqual([]);
  expect(clean.scripts).toEqual([recordCards]);

  const page = fakePage(['error card: grid.live: boom']), errors: string[] = [];
  const faults = await watchFaults(page as never, errors, 'C');
  page.emit('pageerror', new Error('x is not a function'));
  page.emit('console', consoleLine('[faults] system "grid.live" threw: TypeError: boom'));
  page.emit('console', consoleLine('[proof-card] error card: grid.live: boom'));
  await faults.settle(); // the card still up is the one already logged: no second row
  expect(errors).toEqual(['C: uncaught page error: x is not a function', 'C: system "grid.live" faulted: TypeError: boom', 'C: the error card showed: grid.live: boom']);
});

test('a chip whose line gained its sent tick is still one chip', async () => {
  const page = fakePage(['glitch chip: A glitch was reported ✓']), errors: string[] = [];
  const faults = await watchFaults(page as never, errors);
  page.emit('console', consoleLine('[proof-card] glitch chip: A glitch was reported'));
  await faults.settle();
  expect(errors).toEqual(['the glitch chip showed: A glitch was reported']);
});

test('a card on screen that the recorder never logged still fails the proof at settle', async () => {
  const page = fakePage(['error card: boot: no world']), errors: string[] = [];
  await (await watchFaults(page as never, errors)).settle();
  expect(errors).toEqual(['the error card showed: boot: no world']);
});

test('ZONE-ENTRY\'s proofs and the journey proof all use the shared check', () => {
  for (const script of ['src/scripts/zone-gate-proof.mjs', 'src/scripts/zone-pair-proof.mjs', 'src/scripts/journey-proof.mjs']) {
    const text = readFileSync(script, 'utf8');
    expect(text, script).toMatch(/from '\.\/proof-faults\.mjs'/u);
    expect(text, script).not.toMatch(/page\.on\('pageerror'/u);
    expect(text, script).toMatch(/\.settle\(\)/u);
  }
});

test('SB44: a WebKit access-control error beside the page\'s own navigation is a cancelled fetch; one far from any still fails', async () => {
  const handlers = new Map<string, ((value: unknown) => void)[]>();
  const main = {};
  const page = { mainFrame: () => main, on: (name: string, fn: (value: unknown) => void) => { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
    addInitScript: () => Promise.resolve(), evaluate: () => Promise.resolve([]) };
  const emit = (name: string, value: unknown): void => { for (const fn of handlers.get(name) ?? []) fn(value); };
  const errors: string[] = [];
  const faults = await watchFaults(page as never, errors);
  emit('pageerror', new Error('/packs.wildshard.io/content/3c89/shardfiles/pine-hollow/discovery.json?v=1 due to access control checks.'));
  emit('framenavigated', main);
  emit('pageerror', new Error('TypeError: x is undefined'));
  await faults.settle();
  expect(errors).toEqual(['uncaught page error: TypeError: x is undefined']);
  const late: string[] = [], again = await watchFaults(page as never, late);
  handlers.delete('framenavigated');
  emit('pageerror', new Error('/packs.wildshard.io/a.json due to access control checks.'));
  await again.settle();
  expect(late).toEqual(['uncaught page error: /packs.wildshard.io/a.json due to access control checks.']);
});

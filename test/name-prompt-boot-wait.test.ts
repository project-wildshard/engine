// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { progressOfCard, STUCK_STEP_MS, watchStuckStep } from '../src/client/engine/boot/stuckStep';
import { showNamePrompt } from '../src/client/engine/ui/namePrompt';

// QA 11-16 mini row 85: a joining page asks the Name inside the loading card's "server" step (clientWorker.ts `askNameToJoin`).
// The boot watchdog read that wait as a hang, so a player (or the hosted iOS Simulator's harness) that took a minute to answer got
// "The game stopped loading at step "server" (no progress for 60 s)". WebKit reproduced it on staging with the answer at 65 s.
afterEach(() => { document.body.replaceChildren(); });

test('the Name prompt waits on the player: no stall while it is up, the bound starts over once it is answered', async () => {
  const scope = new Scope('name-wait'), card = { dataset: { step: 'server' } };
  let now = 0;
  const stalls: string[] = [], ticks: (() => void)[] = [];
  const answered = showNamePrompt(scope, { parent: document.body });
  expect(progressOfCard(card, document)).toMatchObject({ step: 'server', player: true });
  const stop = watchStuckStep(new Promise(() => undefined), { progress: () => progressOfCard(card, document), now: () => now,
    every: (_ms, run) => { ticks.push(run); return () => undefined; }, stalled: step => { stalls.push(step); } });
  const tick = (): void => { for (const run of ticks) run(); };
  for (let second = 0; second < (STUCK_STEP_MS / 1000) * 2; second++) { now += 1000; tick(); }
  expect(stalls).toEqual([]);
  const box = document.querySelector<HTMLFormElement>('#ws-name-box');
  if (box === null) throw new Error('No Name prompt');
  const input = box.querySelector('input');
  if (input === null) throw new Error('No Name field');
  input.value = 'Wren'; box.requestSubmit();
  expect(await answered).toBe('Wren');
  expect(progressOfCard(card, document).player).toBe(false);
  for (let second = 0; second < STUCK_STEP_MS / 1000 + 1; second++) { now += 1000; tick(); }
  expect(stalls).toEqual(['server']);
  stop(); scope.dispose();
});

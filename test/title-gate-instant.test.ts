// QA-FEEDBACK 2026-11-23-b row 5 (Jake, ~11:40 Cancún: "when i hit enter zone on zone select its not instant in going to the loading
// sreen"): ENTER ZONE enters in the tap's own turn. The world is asked first (a module load, then a socket) only when this tab heard
// it restart.
import { expect, test } from 'vitest';
import { titleGate } from '../src/client/app/titleGate';

const WORLD = { release: 'https://packs.example/releases/staging.json', key: 'k' };

test('a tap enters in its own turn and loads nothing when no restart was heard', () => {
  let loads = 0, entered = 0;
  const gate = titleGate(WORLD, () => { loads++; return new Promise(() => undefined); }, () => false);
  const result = gate(() => { entered++; });
  expect(entered, 'the loading screen does not wait on a request').toBe(1);
  expect(loads).toBe(0);
  expect(result).toBeUndefined();
});

test('after a heard restart the world is asked first, and a second tap meanwhile enters nothing', async () => {
  let entered = 0, release: () => void = () => undefined;
  const gate = titleGate(WORLD, () => Promise.resolve({ titleEntryGate: () => (go: () => void) => new Promise<void>(resolve => { release = () => { go(); resolve(); }; }) }), () => true);
  const first = gate(() => { entered++; });
  gate(() => { entered++; });
  await Promise.resolve(); await Promise.resolve();
  expect(entered).toBe(0);
  release(); await first;
  expect(entered).toBe(1);
});

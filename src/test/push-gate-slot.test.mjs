// Build-max C5: over a 1-minute load of 24, push gates take one machine slot at a time; under it they run side by side.
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {GATE_SERIAL_LOAD, GATE_SLOT_MAX_WAIT_MS, GATE_SLOT_POLL_MS, gateSlot} from '../scripts/push-gate-slot.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
function slotFile() {
  const parent = resolve(process.env.VITEST_TMP_ROOT ?? 'tmp/vitest');
  mkdirSync(parent, {recursive: true});
  const root = mkdtempSync(join(parent, 'gate-slot-'));
  roots.push(root);
  return join(root, 'push-gate-slot.lock');
}
/** A clock that only the fake sleep moves. */
function clock() {
  let at = 0;
  return {now: () => at, sleep: async (/** @type {number} */ ms) => { at += ms; }};
}

test('under the load line a gate runs at once, without the slot', async () => {
  const file = slotFile(), {now, sleep} = clock();
  const held = await gateSlot({load: () => 40, file, now, sleep, log: () => undefined});
  const lines = /** @type {string[]} */ ([]);
  const free = await gateSlot({load: () => GATE_SERIAL_LOAD, file, now, sleep, log: line => { lines.push(line); }});
  expect(lines).toEqual([]);
  free(); held();
});

test('engine 2026-11-21, load 25 to 37: the second gate waits for the first, then takes the slot', async () => {
  const file = slotFile(), {now, sleep} = clock();
  /** @type {string[]} */ const lines = [];
  const log = (/** @type {string} */ line) => { lines.push(line); };
  const first = await gateSlot({load: () => 31.2, file, now, sleep, log});
  expect(lines.at(-1)).toMatch(/load 31\.2 is over 24; this gate holds the machine's one slot$/u);
  let polls = 0;
  const second = gateSlot({load: () => 31.2, file, now, log, sleep: async ms => { await sleep(ms); if (++polls === 3) first(); }});
  const release = await second;
  expect(lines).toContainEqual(expect.stringMatching(/waiting for pid \d+'s gate/u));
  expect(lines.at(-1)).toMatch(/holds the machine's one slot after 45 s$/u);
  expect(polls * GATE_SLOT_POLL_MS).toBe(45_000);
  release();
});

test('a load that falls lets a waiting gate run beside the holder; a long wait runs anyway and says so', async () => {
  const file = slotFile(), {now, sleep} = clock();
  const held = await gateSlot({load: () => 30, file, now, sleep, log: () => undefined});
  let load = 30;
  /** @type {string[]} */ const lines = [];
  const falls = await gateSlot({load: () => load, file, now, log: line => { lines.push(line); }, sleep: async ms => { await sleep(ms); load = 12; }});
  expect(lines.at(-1)).toMatch(/load 12\.0 is back under 24; running beside the holder/u);
  falls();
  lines.length = 0;
  const waited = await gateSlot({load: () => 30, file, now, sleep, log: line => { lines.push(line); }});
  expect(lines.at(-1)).toMatch(new RegExp(`waited ${String(GATE_SLOT_MAX_WAIT_MS / 60_000)} min at load 30\\.0; running beside pid \\d+`, 'u'));
  waited(); held();
});

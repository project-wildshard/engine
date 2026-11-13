#!/usr/bin/env node
// T2E-2 (TEMPLATE-E2E-PLAN): the Template 2 smoke's fault drill. Each step of the smoke has a fault planted in the real
// source that should turn that step, and no earlier one, red. The drill plants one fault at a time, runs the smoke
// (`--project template-2`), puts the source back, and checks which step failed first.
//
//   node scripts/e2e-faults.mjs            every fault, one smoke run each (about 1.5 min each)
//   node scripts/e2e-faults.mjs <id>...    only these
//
// Run it in a worktree you own: it rewrites tracked source for the length of a run and restores the bytes it read,
// also on Ctrl-C. Each run builds the client cold and checks the served build holds this plant and no other. Steps 4
// (the bag key unbound) and 5 (the attack dropped) join once Template 2 carries a pickup and a weapon (shard-format
// S2-1, S2-2).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { CLIENT_DIR, E2E_DIR, STATE_FILE } from './e2e-paths.mjs';

const root = resolvePath(import.meta.dirname, '..');
const REPORT = `${E2E_DIR}/faults-report.json`;

/** @typedef {{ id: string, step: string, why: string, file: string, find: string, plant: string }} Fault */
/** @type {readonly Fault[]} */
const FAULTS = [
  { id: 'use-unbound', step: '3.', why: 'E is bound to nothing in play',
    file: 'src/client/game/inputContexts.ts', find: "dodge: ['KeyV', 'AltLeft'], use: ['KeyE'],", plant: "dodge: ['KeyV', 'AltLeft'], use: ['e2e-fault-use-unbound'],"
  },
  { id: 'door-hook-stubbed', step: '3.', why: "the door's scene (blender.door.toggle) runs nothing",
    file: 'src/server/game/plugin/simulation.ts', find: 'seats.step(); createQuestScriptPorts(lane, hooks, actors).scene(row.scene, player); return true;', plant: "seats.step(); Reflect.set(globalThis, 'e2eFault', 'e2e-fault-door-hook-stubbed'); return true;"
  },
  // The door's state is its shared field, `blender.door.open` (id 101). Leaving only the quest's `blender.door` flag out of
  // the snapshot stays green: the quest earns it again from that field as the world restores.
  { id: 'save-skips-door', step: '7.', why: "the save keeps the door's field (blender.door.open, 101) at its default",
    file: 'src/shared/engine/script/state.ts', find: 'shared: [...this.shared], players:',
    plant: "shared: (Reflect.set(globalThis, 'e2eFault', 'e2e-fault-save-skips-door'), this.shared.map((value, index) => this.declaration.shared[index]?.id === 101 ? 0 : value)), players:"
  },
];

/** @param {string} text @param {string} part */
const count = (text, part) => text.split(part).length - 1;

/** The first test.step with an error, depth first, from Playwright's JSON report. @param {any[]} steps @returns {any} */
function firstRed(steps) {
  for (const step of steps ?? []) {
    if (step.error !== undefined) return firstRed(step.steps) ?? step;
  }
  return undefined;
}

/** Every fault's marker: a string its plant carries that survives the bundle. @param {Fault} fault */
const marker = fault => `e2e-fault-${fault.id}`;

/** The markers the served client holds: the smoke's JavaScript under CLIENT_DIR. @returns {Set<string>} */
function served() {
  const found = new Set();
  /** @param {string} dir */
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.js')) { const text = readFileSync(path, 'utf8'); for (const fault of FAULTS) if (text.includes(marker(fault))) found.add(fault.id); }
    }
  };
  walk(join(root, CLIENT_DIR));
  return found;
}

/** This worktree's watcher, as the smoke drives it. @param {'ready'|'stop'} command */
function client(command) {
  const run = spawnSync(process.execPath, ['--import', './scripts/format-hook.mjs', 'scripts/e2e-client.mjs', command], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`e2e-faults: e2e-client ${command} failed\n${run.stdout}\n${run.stderr}`);
}

/** Wait until this worktree has no watcher: the next ready builds the source as it now stands. */
function stopClient() {
  client('stop');
  for (let wait = 0; wait < 100 && existsSync(join(root, STATE_FILE)); wait += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}

/** @param {Fault} fault */
function drill(fault) {
  const path = join(root, fault.file), before = readFileSync(path, 'utf8');
  if (count(before, fault.find) !== 1) return { id: fault.id, ok: false, detail: `${fault.file} no longer holds the line to plant in once` };
  if (!fault.plant.includes(marker(fault))) return { id: fault.id, ok: false, detail: `its plant carries no ${marker(fault)}` };
  const restore = () => { writeFileSync(path, before); };
  // A warm watcher can miss a write and restore made seconds apart (its file events are not reliable), so each drill
  // builds cold, about 25 s: a fresh watcher before the plant and another after the restore.
  stopClient();
  process.once('SIGINT', () => { restore(); process.exit(130); });
  writeFileSync(path, before.replace(fault.find, fault.plant));
  rmSync(join(root, REPORT), { force: true });
  const started = performance.now();
  let run;
  try {
    // A drill is only as good as the build it ran: the served client must hold this plant and no other.
    client('ready');
    const held = [...served()];
    if (held.length !== 1 || held[0] !== fault.id) return { id: fault.id, ok: false, detail: `the served client holds [${held.join(', ')}], not just this plant` };
    run = spawnSync('pnpm', ['exec', 'playwright', 'test', '--config', 'src/e2e/playwright.config.ts', '--project', 'template-2', '--reporter', 'json'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: join(root, REPORT) }, maxBuffer: 64 * 1024 * 1024 });
  } finally {
    restore();
    stopClient();
    process.removeAllListeners('SIGINT');
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (run.status === 0) return { id: fault.id, ok: false, detail: `the smoke stayed green (${seconds} s)` };
  if (!existsSync(join(root, REPORT))) return { id: fault.id, ok: false, detail: `no report (exit ${String(run.status)})\n${run.stderr.slice(-2000)}` };
  const report = JSON.parse(readFileSync(join(root, REPORT), 'utf8'));
  const results = report.suites.flatMap((/** @type {any} */ suite) => suite.specs).flatMap((/** @type {any} */ spec) => spec.tests).flatMap((/** @type {any} */ test) => test.results);
  const red = results.map((/** @type {any} */ result) => firstRed(result.steps)).find((/** @type {any} */ step) => step !== undefined);
  if (red === undefined) return { id: fault.id, ok: false, detail: `red outside any step (${seconds} s): ${String(results[0]?.error?.message ?? '').split('\n')[0]}` };
  const ok = String(red.title).startsWith(fault.step);
  const message = stripVTControlCharacters(String(red.error?.message ?? '')).split('\n').find(line => line.trim() !== '') ?? '';
  return { id: fault.id, ok, detail: `red at "${String(red.title)}" (want step ${fault.step}) in ${seconds} s: ${message.trim()}` };
}

const asked = process.argv.slice(2);
const unknown = asked.filter(id => !FAULTS.some(fault => fault.id === id));
if (unknown.length > 0) throw new Error(`e2e-faults: no fault ${unknown.join(', ')}; known: ${FAULTS.map(fault => fault.id).join(', ')}`);
let failed = 0;
for (const fault of FAULTS.filter(row => asked.length === 0 || asked.includes(row.id))) {
  const result = drill(fault);
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'RED AS PLANTED' : 'DRILL FAILED'}  ${fault.id} (${fault.why}): ${result.detail}`);
}
process.exit(failed === 0 ? 0 : 1);

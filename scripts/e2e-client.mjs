#!/usr/bin/env node
// TB-1 and T2E-1 (J233): get the Template 2 smoke a served client, without network or a cook.
//
//   node scripts/e2e-client.mjs ready   Template 2 from @wildshard/format, the one-shard catalogue, a warm watcher's
//                                       settled build; prints one JSON line with the preview origin and the split
//   node scripts/e2e-client.mjs stop    stop this worktree's watcher (it frees its build lease)
//   node scripts/e2e-client.mjs status  the watcher's state file, or nothing
//
// The first `ready` in a worktree starts scripts/e2e-watcher.mjs under a heavy-lane build lease and waits for its first
// build; later ones reuse it and wait only for the rebuild of what changed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { CATALOGUE, E2E_DIR, STATE_FILE, TEMPLATE, WATCH_LOG } from './e2e-paths.mjs';
import { shardfileValidationRevision } from './shardfile-validation-revision.mjs';

const root = resolvePath(import.meta.dirname, '..');
const SLUG = 'blender-template';
const FORMAT_INDEX = 'node_modules/@wildshard/format/corpus/handwritten/shard.json';
// A cold watcher can queue up to heavy-lane's 5 minute admission wait, then build.
const START_TIMEOUT_MS = 8 * 60_000;

/** @param {string} path */
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** T2E-1: Template 2 is the format dependency's product, admitted through the pin validator. Skipped when the installed
 * receipt already names this dependency's index under this validator revision. @returns {boolean} installed now */
function template() {
  const indexHash = createHash('sha256').update(readFileSync(join(root, FORMAT_INDEX))).digest('hex');
  const receiptPath = join(root, TEMPLATE, 'validation.json');
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.source?.indexHash === indexHash && receipt.revision === shardfileValidationRevision(root)) return false;
  }
  const run = spawnSync(process.execPath, ['scripts/pins.ts', 'install', '--from-format', SLUG], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`e2e-client: Template 2 install failed\n${run.stdout}\n${run.stderr}`);
  return true;
}

/** Template 2 in every cell, so a build needs no other product (it is the only one installed). */
function catalogue() {
  const receipt = readJson(`${TEMPLATE}/validation.json`), full = readJson('test/pins/catalogue.json');
  const shard = full.shards.find((/** @type {{slug:string}} */ row) => row.slug === SLUG);
  const placement = full.placements.find((/** @type {{slug:string}} */ row) => row.slug === SLUG);
  if (shard === undefined || placement === undefined) throw new Error('e2e-client: the pinned catalogue has no Template 2');
  const text = `${JSON.stringify({
    ...full,
    shards: [{ ...shard, hash: receipt.pin.hash, revision: receipt.pin.revision }],
    placements: [{ ...placement, cell: [0, 0] }],
    missing: [],
    grid: { ...full.grid, cells: full.grid.cells.map((/** @type {{instance:string,cell:number[]}} */ row) => ({ slug: SLUG, instance: row.instance, cell: row.cell })) },
  })}\n`;
  const path = join(root, CATALOGUE);
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
}

/** @returns {{pid:number,port:number,token:string,origin:string}|undefined} */
function watcherState() {
  const path = join(root, STATE_FILE);
  if (!existsSync(path)) return undefined;
  const state = JSON.parse(readFileSync(path, 'utf8'));
  try { process.kill(state.pid, 0); return state; } catch { rmSync(path, { force: true }); return undefined; }
}

/** @param {{port:number,token:string}} state @param {string} path */
async function ask(state, path) {
  const response = await fetch(`http://127.0.0.1:${String(state.port)}${path}`, { headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(180_000) });
  return { status: response.status, body: await response.json() };
}

async function startWatcher() {
  const log = openSync(join(root, WATCH_LOG), 'a');
  const child = spawn('python3', ['scripts/heavy-lane.py', 'build', '--max', '30', '--', process.execPath, '--import', './scripts/format-hook.mjs', 'scripts/e2e-watcher.mjs'],
    { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, WILDSHARD_CATALOGUE: join(root, CATALOGUE) } });
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.unref();
  const deadline = performance.now() + START_TIMEOUT_MS;
  for (;;) {
    const state = watcherState();
    if (state !== undefined) return state;
    if (exited || performance.now() > deadline) {
      const tail = readFileSync(join(root, WATCH_LOG), 'utf8').split('\n').slice(-30).join('\n');
      throw new Error(`e2e-client: the watcher ${exited ? 'exited' : 'did not start in time'}; ${WATCH_LOG} ends:\n${tail}`);
    }
    await sleep(200);
  }
}

async function ready() {
  const started = performance.now();
  mkdirSync(join(root, E2E_DIR), { recursive: true });
  const installed = template();
  catalogue();
  const templateMs = performance.now() - started;
  let state = watcherState(), warm = state !== undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    state ??= await startWatcher();
    let answer;
    try { answer = await ask(state, '/ready'); } catch { answer = { status: 0, body: {} }; }
    if (answer.status === 200) {
      return { ...answer.body, warm, installed, templateMs, readyMs: performance.now() - started };
    }
    if (answer.status === 500) throw new Error(`e2e-client: the client build failed: ${String(answer.body.error)}`);
    // 409: its prepared inputs moved; 0: it died. Either way a fresh one is started.
    for (let wait = 0; wait < 50 && watcherState() !== undefined; wait += 1) await sleep(100);
    state = undefined; warm = false;
  }
  throw new Error('e2e-client: no watcher answered after three starts');
}

const [command = 'ready'] = process.argv.slice(2);
if (command === 'ready') console.log(JSON.stringify(await ready()));
else if (command === 'stop') { const state = watcherState(); if (state !== undefined) await ask(state, '/stop').catch(() => undefined); }
else if (command === 'status') console.log(JSON.stringify(watcherState() ?? null));
else throw new Error(`e2e-client: unknown command ${command}`);

#!/usr/bin/env node
// MEMORY-STRUCTURE STR2, STR3 (J414, J419): `pnpm dev`. Builds the game client in devserver mode, starts the game server
// as a local Node process with saves on disk (src/scripts/dev-world.mjs), and prints one URL. No page runs the in-page server
// worker: that belongs to the deployed preview alone (J414). Then it watches `src/`: a server-side edit rebuilds the
// server and restarts the world (the open page redials and stays in play); a client edit rebuilds the client and the open
// page opens the new build.
//
//   pnpm dev [--shard brasscap-mesa] [--port 4402] [--dist <built client folder>] [--saves disk|memory] [--no-watch]
//            [--public-origin https://<name> --public-socket wss://<name>:8443/ --socket-port 4412]   (serve-local.mjs)
//
// Its files live in ./tmp/dev-world/ (key, saves, client builds, server log); delete the folder, with dev stopped, for a
// fresh world.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEV_PORT, openDevWorld } from './dev-world.mjs';
import { readStaging } from './pins-staging.ts';
import { shardfileValidationRevision } from './shardfile-validation-revision.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const { values } = parseArgs({ options: {
  shard: { type: 'string', default: 'brasscap-mesa' }, port: { type: 'string', default: String(DEV_PORT) }, dist: { type: 'string' },
  saves: { type: 'string', default: 'disk' }, 'no-watch': { type: 'boolean', default: false }, work: { type: 'string', default: 'tmp/dev-world' },
  staging: { type: 'boolean', default: false },
  'public-origin': { type: 'string' }, 'public-socket': { type: 'string' }, 'socket-port': { type: 'string', default: '0' },
} });
if (values.saves !== 'disk' && values.saves !== 'memory') throw new Error('--saves is disk or memory');
const work = resolve(ROOT, values.work), port = Number(values.port);
mkdirSync(work, { recursive: true });
// Ring 1 holds Brasscap (J434); any other shard installs every pin.
if (values.staging && process.env.WS_RELEASE === '1') throw new Error('The staging dev world is a local build');
const staging = values.staging ? readStaging() : undefined;
if (staging !== undefined && !staging.shards.some(({ slug }) => slug === values.shard)) throw new Error(`${values.shard} is absent from the staging snapshot`);
const ring = staging === undefined && values.shard === 'brasscap-mesa';
const catalogue = staging !== undefined ? join(work, 'catalogue.json') : resolve(ROOT, ring ? 'out/.ring-catalogue.json' : 'test/pins/catalogue.json');
if (staging !== undefined) writeFileSync(catalogue, JSON.stringify(staging.catalogue));

/** @param {string} command @param {string[]} args */
const step = (command, args) => {
  const done = spawnSync(command, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, WILDSHARD_CATALOGUE: catalogue, ...(staging === undefined ? {} : { WS_DEV_STAGING: '1' }) } });
  if (done.status !== 0) throw new Error(`pnpm dev: ${[command, ...args].join(' ')} stopped (${String(done.status)})`);
};
let generation = 0;
/** One devserver client build into its own folder; the two newest are kept. */
const buildClient = () => {
  const out = join(work, `client-${String(Date.now())}-${String(++generation)}`);
  step('python3', ['src/scripts/heavy-lane.py', 'build', '--', process.execPath, 'src/scripts/build-app.mjs', '--mode', 'devserver', '--outDir', out]);
  const old = readdirSync(work).filter(name => name.startsWith('client-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).slice(2);
  for (const name of old) rmSync(join(work, name), { recursive: true, force: true });
  return out;
};

// The products' validation receipts name the admission source they were checked with (shardfile-validation-revision.mjs);
// an edit there makes them stale, and installing the pins again checks them anew.
let validated = '';
const pins = () => {
  step(process.execPath, ['src/scripts/pins.ts', 'install', ...ring ? ['--ring', '1'] : staging === undefined ? [] : ['--staging']]);
  step(process.execPath, ['src/scripts/gen.mjs', '--inputs-only']);
  validated = shardfileValidationRevision(ROOT);
};
let dist = values.dist;
if (dist === undefined) { pins(); dist = buildClient(); }
const world = await openDevWorld({ dist: resolve(ROOT, dist), work, shard: values.shard, port, saves: values.saves,
  ...(staging === undefined ? {} : { staging: staging.shards }), publicOrigin: values['public-origin'], publicSocket: values['public-socket'], socketPort: Number(values['socket-port']) });
console.log(`engine dev on ${world.url} (${values.shard}, saves ${values.saves === 'disk' ? join(values.work, 'saves') : 'in memory'}, server log ${join(values.work, 'server.log')})`);

let closing = false;
const shut = async () => { if (closing) return; closing = true; await world.close(); process.exit(0); };
process.once('SIGINT', () => { void shut(); });
process.once('SIGTERM', () => { void shut(); });

if (!values['no-watch'] && values.dist === undefined) {
  /** What the next pass rebuilds: the client (and with it the server), or the server alone. */
  let client = false, server = false, busy = false, timer = /** @type {NodeJS.Timeout | undefined} */ (undefined);
  const pass = async () => {
    if (busy || closing) return;
    const both = client, alone = server && !client;
    client = false; server = false;
    if (!both && !alone) return;
    busy = true;
    const started = Date.now();
    try {
      if (both) { if (shardfileValidationRevision(ROOT) !== validated) pins(); await world.move(buildClient()); console.log(`pnpm dev: client rebuilt, the page reopens on ${world.build} (${String(Date.now() - started)} ms)`); }
      else { await world.restart(); console.log(`pnpm dev: server rebuilt and restarted (${String(Date.now() - started)} ms)`); }
    } catch (error) { console.error(`pnpm dev: rebuild failed; still serving ${world.build}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { busy = false; if (client || server) void pass(); }
  };
  watch(join(ROOT, 'src'), { recursive: true }, (_event, file) => {
    if (file === null || /(?:^|\/)(?:dist|tmp)\//u.test(file) || /\.test\.tsx?$/u.test(file)) return;
    if (file.startsWith('server/')) server = true;
    else if (file.startsWith('client/') || file.startsWith('shared/')) client = true;
    else return;
    clearTimeout(timer);
    timer = setTimeout(() => { void pass(); }, 300);
  });
}

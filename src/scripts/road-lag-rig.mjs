#!/usr/bin/env node
// ZONE-ENTRY ZE2f (J352): the home-to-road seat move online, on this Mac. Opens the local rig (online-rig.mjs) with WORLD_CELLS=grid on
// staging's two workers (Driftwood, Pine Hollow, Sunscar and Far Reach on one, Nalati on the other) and memory saves, then runs
// grid-road-lag.mjs --online against its page: Driftwood walked from the spawn to its east entryway by real input, out onto the road
// and back in, each crossing's frames and the road bar's stop read as on staging. The rig and its world stop when the run ends.
//   WS_RIG_PORTS=<first> src/scripts/browser-lane.sh node src/scripts/road-lag-rig.mjs <app dist stamped with http://127.0.0.1:<first + 3>/release.json>
//     <work dir> <key.json> --out=<dir> [any grid-road-lag.mjs flag: --reps=3 --engine=webkit --device='iPhone 17 Pro' --run]
// The dist is a serve-build.sh build made with WILDSHARD_RELEASE_URL and WILDSHARD_RELEASE_KEY set (app-build-pipeline.mjs E7.2d).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { openRig, WORLD_PORT } from './online-rig.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: road-lag-rig.mjs <stamped app dist> <work dir> <key.json> --out=<dir> [grid-road-lag flags]');
const passed = process.argv.slice(2).filter(value => value.startsWith('--'));
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: 'driftwood-isle', more: ['pine-hollow', 'far-reach', 'sunscar-dunes', 'nalati-grasslands'], cells: 'grid', workers: 2 });
let code = 1;
try {
  let open = null;
  for (let tries = 0; tries < 300 && open === null; tries++) { open = await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok ? found.json() : null).catch(() => null); if (open === null) await sleep(200); }
  if (open === null) throw new Error(`The world did not start: see ${join(work, 'server.log')}`);
  console.log(`rig ${rig.base}: the world is up (${JSON.stringify(open).slice(0, 200)})`);
  const lag = spawn(process.execPath, [join(import.meta.dirname, 'grid-road-lag.mjs'), `--base=${rig.base}`, '--online', ...passed], { stdio: 'inherit' });
  code = await new Promise(resolve => { lag.on('exit', status => { resolve(status ?? 1); }); });
} finally { await rig.close(); }
process.exit(code);

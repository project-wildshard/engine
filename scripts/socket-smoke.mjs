#!/usr/bin/env node
// E7.1: both socket ends and a real room, bundled for Node as E7.2's server target will be, and run with plain `node` on real time.
//   node scripts/socket-smoke.mjs [seconds]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'rolldown';

const ROOT = resolve(import.meta.dirname, '..'), OUT = join(ROOT, 'tmp/socket-smoke/smoke.mjs'), require = createRequire(join(ROOT, 'package.json'));
// As vite/rapier.ts: the package's wasm import is the game's to load.
/** @type {import('rolldown').Plugin} */
const rapier = {name:'rapier',resolveId:source=>{
  if(/^\.\/rapier_wasm3d(\.js)?$/.test(source))return join(ROOT,'src/server/engine/physics/rapierBindings.ts');
  if(source==='@dimforge/rapier3d-simd')return require.resolve('@dimforge/rapier3d-simd/rapier.js');
  return null;
}};
await build({input:join(ROOT,'test/fixtures/socketSmokeEntry.ts'),platform:'node',transform:{target:'node24'},plugins:[rapier],
  output:{file:OUT,format:'esm',codeSplitting:false,banner:'import { createRequire as bundleRequire } from \'node:module\'; const require = bundleRequire(import.meta.url);'}});
const run = spawnSync(process.execPath, [OUT, process.argv[2] ?? '4', join(ROOT, 'public/assets/physics/rapier.wasm')], { stdio: 'inherit', cwd: dirname(OUT) });
process.exit(run.status ?? 1);

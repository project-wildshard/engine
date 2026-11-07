#!/usr/bin/env node
// E7.1: both socket ends and a real room, bundled for Node as E7.2's server target will be, and run with plain `node` on real time.
//   node scripts/socket-smoke.mjs [seconds]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..'), OUT = join(ROOT, 'tmp/socket-smoke/smoke.mjs'), require = createRequire(join(ROOT, 'package.json'));
// As vite/rapier.ts: the package's wasm import is the game's to load.
/** @type {import('esbuild').Plugin} */
const rapier = { name: 'rapier', setup: bundle => {
  bundle.onResolve({ filter: /^\.\/rapier_wasm3d(\.js)?$/ }, () => ({ path: join(ROOT, 'src/server/engine/physics/rapierBindings.ts') }));
  bundle.onResolve({ filter: /^@dimforge\/rapier3d-simd$/ }, () => ({ path: require.resolve('@dimforge/rapier3d-simd/rapier.js') }));
} };
await build({ entryPoints: [join(ROOT, 'test/fixtures/socketSmokeEntry.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: OUT, logLevel: 'warning', plugins: [rapier],
  // `ws` is CommonJS: an ESM bundle has no `require` of its own, and E7.2's target needs this same line.
  banner: { js: 'import { createRequire as bundleRequire } from \'node:module\'; const require = bundleRequire(import.meta.url);' } });
const run = spawnSync(process.execPath, [OUT, process.argv[2] ?? '4', join(ROOT, 'public/assets/physics/rapier.wasm')], { stdio: 'inherit', cwd: dirname(OUT) });
process.exit(run.status ?? 1);

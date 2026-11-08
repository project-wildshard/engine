#!/usr/bin/env node
// E7.2 (J53): the dedicated server target: `dist/server/main.mjs` and `cellWorker.mjs`, with `rapier.wasm` and `migrations/` beside them.
//   node scripts/build-server.mjs [--build <id>] [--out <dir>] [--entry name=path ...] [--tar <file>]
// `--tar` also packs the folder and prints the file's name and SHA-256: the release file's `bundle` (E7.2c).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..'), require = createRequire(join(ROOT, 'package.json'));
const { values } = parseArgs({ options: { build: { type: 'string', default: 'dev' }, out: { type: 'string', default: 'dist/server' }, entry: { type: 'string', multiple: true, default: [] }, tar: { type: 'string' } } });
const OUT = resolve(ROOT, values.out), DEDICATED = join(ROOT, 'src/server/host/dedicated');

// As vite/rapier.ts: the package's wasm import is the game's to load.
/** @type {import('esbuild').Plugin} */
const rapier = { name: 'rapier', setup: bundle => {
  bundle.onResolve({ filter: /^\.\/rapier_wasm3d(\.js)?$/ }, () => ({ path: join(ROOT, 'src/server/engine/physics/rapierBindings.ts') }));
  bundle.onResolve({ filter: /^@dimforge\/rapier3d-simd$/ }, () => ({ path: require.resolve('@dimforge/rapier3d-simd/rapier.js') }));
} };
// `ws` and `pg` are CommonJS, and an ESM bundle has no `require` of its own.
const banner = { js: 'import { createRequire as bundleRequire } from \'node:module\'; const require = bundleRequire(import.meta.url);' };
const extra = Object.fromEntries(values.entry.map(row => { const [name, path] = row.split('='); return [name, resolve(ROOT, path)]; }));
await build({ entryPoints: { main: join(DEDICATED, 'main.ts'), cellWorker: join(DEDICATED, 'cellWorker.ts'), ...extra }, bundle: true, platform: 'node', format: 'esm', target: 'node24', outdir: OUT, outExtension: { '.js': '.mjs' },
  logLevel: 'warning', plugins: [rapier], banner, define: { __BUILD_ID__: JSON.stringify(values.build) }, external: ['pg-native'] });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'bundle.json'), JSON.stringify({ engineBuild: values.build }));
cpSync(require.resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm'), join(OUT, 'rapier.wasm'));
cpSync(join(DEDICATED, 'saves/migrations'), join(OUT, 'migrations'), { recursive: true });
console.log(`server target: ${OUT}`);
if (values.tar !== undefined) {
  const archive = resolve(ROOT, values.tar);
  // macOS's tar would otherwise add `._` files of its own.
  const packed = spawnSync('tar', ['-czf', archive, '-C', OUT, '.'], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (packed.status !== 0) process.exit(packed.status ?? 1);
  console.log(JSON.stringify({ name: basename(archive), sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') }));
}

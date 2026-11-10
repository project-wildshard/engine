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
import { build } from 'rolldown';

const ROOT = resolve(import.meta.dirname, '..'), require = createRequire(join(ROOT, 'package.json'));
// SENTRY-TRIAGE S8: the server's Sentry release is `wildshard@<version>`, as the client's (S5).
const VERSION = /** @type {{ version: string }} */ (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))).version;
const { values } = parseArgs({ options: { build: { type: 'string', default: 'dev' }, out: { type: 'string', default: 'dist/server' }, entry: { type: 'string', multiple: true, default: [] }, tar: { type: 'string' } } });
const OUT = resolve(ROOT, values.out), DEDICATED = join(ROOT, 'src/server/host/dedicated');

// As vite/rapier.ts: the package's wasm import is the game's to load.
/** @type {import('rolldown').Plugin} */
const rapier = { name: 'rapier', resolveId: source => {
  if (/^\.\/rapier_wasm3d(\.js)?$/.test(source)) return join(ROOT, 'src/server/engine/physics/rapierBindings.ts');
  if (source === '@dimforge/rapier3d-simd') return require.resolve('@dimforge/rapier3d-simd/rapier.js');
  return null;
} };
// Rolldown supplies the Node CommonJS require bridge for ws and pg.
const extra = Object.fromEntries(values.entry.map(row => { const [name, path] = row.split('='); return [name, resolve(ROOT, path)]; }));
// Separate self-contained entries preserve the dedicated archive contract.
for (const [name,input] of Object.entries({main:join(DEDICATED,'main.ts'),cellWorker:join(DEDICATED,'cellWorker.ts'),...extra})) {
  await build({input,platform:'node',transform:{target:'node24',define:{__BUILD_ID__:JSON.stringify(values.build),__ENGINE_VERSION__:JSON.stringify(VERSION)}},
    plugins:[rapier],external:['pg-native'],output:{file:join(OUT,`${name}.mjs`),format:'esm',codeSplitting:false}});
}
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

// Rebuild the SENTRY-TRIAGE S3 trap fixture with sharddev's v2 compiler (engine's suite has no AssemblyScript compiler, J42 lift):
//   node test/fixtures/group-trap/build.mjs <path to sharddev checkout>
// sharddev's sources are extensionless TypeScript, so its own esbuild bundles the compiler into its gitignored tmp/ first.
// IO_BYTES is `groupStepLayoutV2(rows.json).bytes`; `group-guest-trap.test.ts` asserts it, and the host admits the module against it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname, sharddev = process.argv[2], IO_BYTES = 1056;
if (sharddev === undefined) throw new Error('usage: build.mjs <sharddev checkout>');
const { build } = createRequire(join(sharddev, 'package.json'))('esbuild'), out = join(sharddev, 'tmp', 'group-trap-build');
mkdirSync(out, { recursive: true });
try {
  await build({ stdin: { resolveDir: sharddev, loader: 'ts', contents: "export { compileScriptV2 } from './src/sharddev/bake/compileScriptV2';\nexport { v2CoreSource } from './src/sharddev/as/wsV2';" },
    bundle: true, platform: 'node', format: 'esm', outfile: join(out, 'compiler.mjs'), external: ['assemblyscript', 'assemblyscript/*', 'binaryen'], logLevel: 'error' });
  const { compileScriptV2, v2CoreSource } = await import(join(out, 'compiler.mjs'));
  writeFileSync(join(here, 'group-trap.wasm'), await compileScriptV2(readFileSync(join(here, 'group-trap.as'), 'utf8'),
    { lane: 'project', ioBytes: IO_BYTES, sources: { 'sdk/as/wsV2.ts': v2CoreSource(0) } }));
} finally { rmSync(out, { recursive: true, force: true }); }

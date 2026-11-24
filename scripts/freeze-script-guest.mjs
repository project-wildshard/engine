#!/usr/bin/env node
// CC59h: pin one ABI-1 decision guest for the decision test harness (test/fixtures/decisionHarness.ts).
// Tests load no compiler: they read source-keyed snapshots in test/fixtures/sdk-built/script-guests. This tool
// compiles one source with sharddev's real compiler (AssemblyScript plus structural fuel metering) and writes
// the snapshot the harness reads, keyed exactly as scriptGuests.ts keys it.
//
//   WS_SHARDDEV=~/projects/games/wildshard/sharddev node scripts/freeze-script-guest.mjs < request.json
//
// request.json is the JSON `["compileScript", [source, options]]`. The harness writes it for you when a test
// runs with WS_FREEZE_GUESTS=1 and a pin is missing.
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// sharddev's compiler is TypeScript with extensionless relative imports; Node strips the types itself.
registerHooks({ resolve(spec, context, next) {
  try { return next(spec, context); } catch (error) {
    if ((spec.startsWith('.') || spec.startsWith('/')) && context.parentURL !== undefined) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(spec + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    throw error;
  }
} });

const sharddev = process.env.WS_SHARDDEV;
if (sharddev === undefined || !existsSync(resolve(sharddev, 'packages/sdk/src/sharddev/bake/compileScript.ts'))) {
  throw new Error('Set WS_SHARDDEV to a sharddev checkout');
}
const request = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(request) || request[0] !== 'compileScript' || !Array.isArray(request[1])) throw new Error('Expected ["compileScript", [source, options]]');
const [method, args] = request;
const { compileScript } = await import(pathToFileURL(resolve(sharddev, 'packages/sdk/src/sharddev/bake/compileScript.ts')).href);
const bytes = await compileScript(...args);
const key = createHash('sha256').update(JSON.stringify([method, args])).digest('hex');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const folder = resolve(fileURLToPath(new URL('../test/fixtures/sdk-built/script-guests', import.meta.url)));
const commit = execFileSync('git', ['-C', sharddev, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(resolve(folder, `${key}.wasm`), bytes);
writeFileSync(resolve(folder, `${key}.json`), `${JSON.stringify({ method, arguments: args, sourceRepository: 'project-wildshard/sharddev', sourceCommit: commit, file: `${key}.wasm`, sha256 })}\n`);
// The manifest names every pinned file; harness pins share one extension entry.
const manifestPath = resolve(folder, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let extension = manifest.extensions.find((/** @type {{ harness?: string }} */ row) => row.harness === 'test/fixtures/decisionHarness.ts');
if (extension === undefined) {
  extension = { harness: 'test/fixtures/decisionHarness.ts', sourceRepository: 'project-wildshard/sharddev', compiler: 'sharddev packages/sdk bake/compileScript.ts (AssemblyScript 0.28.20 plus structural fuel metering)',
    capture: 'WS_FREEZE_GUESTS=1 WS_SHARDDEV=<checkouts>/sharddev runs scripts/freeze-script-guest.mjs per missing guest', files: [] };
  manifest.extensions.push(extension);
}
if (!extension.files.includes(`${key}.json`)) extension.files.push(`${key}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${key}\n`);

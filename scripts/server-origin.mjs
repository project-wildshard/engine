#!/usr/bin/env node
// E7.3d: a folder laid out as `PACK_ORIGIN` is: this build's server book and its parts, from built products.
//   node scripts/server-origin.mjs <out> <build> <slug>=<product folder> ...
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..'), TOOL = 'tmp/server-origin';
const built = spawnSync(process.execPath, ['scripts/build-server.mjs', '--out', TOOL, '--entry', 'serverBook=test/fixtures/dedicated/serverBookEntry.ts'], { stdio: 'inherit', cwd: ROOT });
if (built.status !== 0) process.exit(built.status ?? 1);
process.exit(spawnSync(process.execPath, [resolve(ROOT, TOOL, 'serverBook.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: ROOT }).status ?? 1);

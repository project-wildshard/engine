#!/usr/bin/env node
// E7.3d: a folder laid out as `PACK_ORIGIN` is: this build's server book and its parts, from built products.
//   node scripts/server-origin.mjs <out> <build> <slug>=<product folder> ...
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// Keep build-only Node module identities intact: bundling a library CLI can
// turn its import.meta entry guard into the caller's entry guard.
process.exit(spawnSync(process.execPath, ['--import',resolve(ROOT,'scripts/bake-loader.mjs'),resolve(ROOT,'test/fixtures/dedicated/serverBookEntry.ts'),...process.argv.slice(2)],{stdio:'inherit',cwd:ROOT}).status??1);

#!/usr/bin/env node
// Rewrite lint/no-frame-alloc-debt.json from the tree (MEMORY-STRUCTURE STR21): per file in the rule's scope, the number
// of allocation sites left in its `@frame` functions. The allowance only shrinks: lint fails a file over its count, and
// src/scripts/no-binary-json.mjs refuses a commit that raises one. Run after a cut, or after tagging a function.
//   node src/scripts/memory/frame-alloc-debt.mjs [--check]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSync } from 'vite';
import { FRAME_ALLOC_POLICY, FRAME_ALLOC_SCOPE, frameAllocSites } from '../../../lint/no-frame-alloc.mjs';

const root = resolve(import.meta.dirname, '../../..');
/** @returns {Record<string, number>} */
export function countFrameAllocDebt() {
  const files = execFileSync('git', ['ls-files', '-z', 'src/client', 'src/shared'], { cwd: root }).toString().split('\0')
    .filter((f) => /\.tsx?$/u.test(f) && FRAME_ALLOC_SCOPE.test(f) && !f.endsWith('.d.ts'));
  /** @type {Record<string, number>} */ const out = {};
  for (const file of files.sort()) {
    const text = readFileSync(resolve(root, file), 'utf8');
    if (!text.includes('@frame')) continue;
    const count = frameAllocSites(parseSync(file, text).program, text).length;
    if (count > 0) out[file] = count;
  }
  return out;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const files = countFrameAllocDebt();
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--check')) {
    const committed = JSON.parse(readFileSync(FRAME_ALLOC_POLICY, 'utf8')).files;
    const over = Object.entries(files).filter(([f, n]) => n > (committed[f] ?? 0));
    for (const [f, n] of over) console.error(`NO-FRAME-ALLOC ${f}: ${n} sites, allowance ${committed[f] ?? 0}`);
    process.exitCode = over.length === 0 ? 0 : 1;
  } else {
    writeFileSync(FRAME_ALLOC_POLICY, `${JSON.stringify({ schema: 'no-frame-alloc/1', source, files }, null, 2)}\n`);
    console.log(`lint/no-frame-alloc-debt.json: ${total} sites in ${Object.keys(files).length} files`);
  }
}

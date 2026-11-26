#!/usr/bin/env node
// Rewrite lint/owned-buffer-debt.json from the tree (ENGINE-MEMORY EM6): per file in the rule's scope, the number of
// big-buffer sites outside src/shared/engine/core/ownedBuffer.ts. The allowance only shrinks: lint fails a file over its
// count, and src/scripts/no-binary-json.mjs refuses a commit that raises one. Run after moving a site to the helper.
//   node src/scripts/memory/owned-buffer-debt.mjs [--check]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSync } from 'vite';
import { OWNED_BUFFER_HELPER, OWNED_BUFFER_POLICY, OWNED_BUFFER_SCOPE, bufferSites } from '../../../lint/owned-buffer.mjs';

const root = resolve(import.meta.dirname, '../../..');
/** @returns {Record<string, number>} */
export function countBufferDebt() {
  const files = execFileSync('git', ['ls-files', '-z', 'src/client', 'src/shared'], { cwd: root }).toString().split('\0').filter((f) => /\.tsx?$/u.test(f) && OWNED_BUFFER_SCOPE.test(f) && f !== OWNED_BUFFER_HELPER && !f.endsWith('.d.ts'));
  /** @type {Record<string, number>} */ const out = {};
  for (const file of files.sort()) {
    const parsed = parseSync(file, readFileSync(resolve(root, file), 'utf8'));
    const count = bufferSites(parsed.program);
    if (count > 0) out[file] = count;
  }
  return out;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const files = countBufferDebt();
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--check')) {
    const committed = JSON.parse(readFileSync(OWNED_BUFFER_POLICY, 'utf8')).files;
    const over = Object.entries(files).filter(([f, n]) => n > (committed[f] ?? 0));
    for (const [f, n] of over) console.error(`OWNED-BUFFER ${f}: ${n} sites, allowance ${committed[f] ?? 0}`);
    process.exitCode = over.length === 0 ? 0 : 1;
  } else {
    writeFileSync(OWNED_BUFFER_POLICY, `${JSON.stringify({ schema: 'owned-buffer/1', source, files }, null, 2)}\n`);
    console.log(`lint/owned-buffer-debt.json: ${total} sites in ${Object.keys(files).length} files`);
  }
}

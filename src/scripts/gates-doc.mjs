#!/usr/bin/env node
// ONE-FORMAT OF10: write the gate ledger (src/shared/game/shardfile/gates.ts) as docs/GATES.md, and as shard-format's
// docs/GATES.md when its checkout is passed: `node src/scripts/gates-doc.mjs [--format=<shard-format checkout>]`.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderGates } from '../shared/game/shardfile/gates.ts';

const root = resolve(import.meta.dirname, '..', '..'), text = renderGates();
const format = process.argv.slice(2).find(arg => arg.startsWith('--format='))?.slice('--format='.length);
for (const file of [resolve(root, 'docs/GATES.md'), ...(format === undefined ? [] : [resolve(format, 'docs/GATES.md')])]) {
  writeFileSync(file, text);
  console.info(`gates-doc: wrote ${file}`);
}

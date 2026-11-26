// ONE-FORMAT OF10: every gate in engine src/ is in the ledger (src/shared/game/shardfile/gates.ts), each has a verdict, each
// dangerous gate names its harm and budget, and docs/GATES.md is current (`node src/scripts/gates-doc.mjs` regenerates it).
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { GATES, renderGates } from '../src/shared/game/shardfile/gates';

const ROOT = resolve(import.meta.dirname, '..');
/** OF1's `engine.access-gate-references` pattern (shard-format src/tools/one-way-counts.ts), over runtime src. */
const REFERENCE = /\bdangerousGrant\b/gu;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ['test', '__tests__', 'e2e'].includes(entry.name) ? [] : sources(path);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

test('every dangerousGrant reference in engine src belongs to a ledger gate, file by file', () => {
  const actual = new Map<string, number>();
  for (const file of sources(resolve(ROOT, 'src'))) {
    const count = readFileSync(file, 'utf8').match(REFERENCE)?.length ?? 0;
    if (count > 0) actual.set(relative(ROOT, file), count);
  }
  const ledger = new Map<string, number>();
  for (const gate of GATES) for (const [file, count] of Object.entries(gate.refs ?? {})) ledger.set(file, (ledger.get(file) ?? 0) + count);
  // a new gate (or a removed one) changes a file's count: add it to gates.ts with a verdict, or drop its line
  expect(Object.fromEntries([...actual].sort())).toEqual(Object.fromEntries([...ledger].sort()));
});

test('every gate with no dangerousGrant reference names a line that is still there', () => {
  for (const gate of GATES) for (const row of gate.snippets ?? []) {
    expect(readFileSync(resolve(ROOT, row.file), 'utf8'), `${gate.id}: ${row.file}`).toContain(row.text);
  }
});

test('every gate has a verdict; delete names its replacement; dangerous names its harm, budget and dangerousX name', () => {
  const ids = new Set<string>();
  for (const gate of GATES) {
    expect(ids.has(gate.id), gate.id).toBe(false); ids.add(gate.id);
    expect((gate.refs === undefined ? 0 : Object.keys(gate.refs).length) + (gate.snippets?.length ?? 0), gate.id).toBeGreaterThan(0);
    if (gate.verdict === 'delete') { expect(gate.replacedBy, gate.id).toBeTruthy(); continue; }
    expect(gate.verdict, gate.id).toBe('dangerous');
    expect(gate.harm, gate.id).toBeTruthy();
    expect(gate.budget, gate.id).toMatch(/OF10c/u);
    expect(gate.name, gate.id).toMatch(/^dangerous[A-Z]/u);
  }
});

test('docs/GATES.md is generated from the ledger', () => {
  expect(readFileSync(resolve(ROOT, 'docs/GATES.md'), 'utf8')).toBe(renderGates());
});

test('OF1 counts every remaining dangerous gate export in production source', () => {
  const exported = sources(resolve(ROOT, 'src')).flatMap(file =>
    [...readFileSync(file, 'utf8').matchAll(/\bexport function (dangerous[A-Z]\w*)/gu)].map(match => match[1]));
  const named = GATES.filter(gate => gate.verdict === 'dangerous').map(gate => gate.name);
  expect(exported.sort()).toEqual(named.sort());
});

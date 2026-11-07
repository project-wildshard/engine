// Per-shard runtime/ file ceilings (lint/runtime-files.mjs): a shard above its ceiling refuses, and a ceiling never rises
// without an explicit raises line.
// oxlint-disable-next-line import/no-nodejs-modules -- Writes stay inside an owned temporary checkout fixture.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture checkout lives in the OS temporary folder.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture and the repository's own runtime folders.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { compareRuntimeFiles, readRuntimeFiles, runtimeFilesShape, runtimeFileCeiling, RUNTIME_FILE_DEFAULT } from '../lint/runtime-files.mjs';
import { checkProjectRuntime } from '../src/sharddev/runtimePerformance';

const about = 'test policy';
const policy = (ceilings: Record<string, number>, raises: { slug: string; from: number; to: number; why: string }[] = []) => ({ about, ceilings, default: 128, raises });

test('a ceiling falls freely and rises only with a matching new raises line', () => {
  const seeded = policy({ 'pine-hollow': 152 }, [{ slug: 'pine-hollow', from: 128, to: 152, why: 'W2 seed' }]);
  expect(compareRuntimeFiles(undefined, seeded)).toEqual([]);
  expect(compareRuntimeFiles(seeded, policy({ 'pine-hollow': 140 }, seeded.raises))).toEqual([]);
  expect(compareRuntimeFiles(seeded, policy({}, seeded.raises))).toEqual([]);
  // A silent rise, a raise line that does not match, an edited or removed history line, a new slug above 128.
  expect(compareRuntimeFiles(seeded, policy({ 'pine-hollow': 153 }, seeded.raises))).not.toEqual([]);
  expect(compareRuntimeFiles(seeded, policy({ 'pine-hollow': 153 }, [...seeded.raises, { slug: 'pine-hollow', from: 150, to: 153, why: 'x' }]))).not.toEqual([]);
  expect(compareRuntimeFiles(seeded, policy({ 'pine-hollow': 153 }, [...seeded.raises, { slug: 'pine-hollow', from: 152, to: 153, why: 'one more' }]))).toEqual([]);
  expect(compareRuntimeFiles(seeded, policy({ 'pine-hollow': 152 }, []))).not.toEqual([]);
  expect(compareRuntimeFiles(undefined, policy({ 'pine-hollow': 152 }))).not.toEqual([]);
  expect(compareRuntimeFiles(seeded, policy({ ...seeded.ceilings, 'far-reach': 129 }, seeded.raises))).not.toEqual([]);
  expect(compareRuntimeFiles(seeded, { ...seeded, default: 200 })).not.toEqual([]);
  expect(runtimeFileCeiling(seeded, 'pine-hollow')).toBe(152);
  expect(runtimeFileCeiling(seeded, 'ink-cel-valley')).toBe(RUNTIME_FILE_DEFAULT);
});

test('the build refuses a shard above its ceiling; projects without first-party provenance keep 128', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-files-'));
  try {
    mkdirSync(join(root, 'lint'));
    writeFileSync(join(root, 'lint/runtime-performance.json'), JSON.stringify({ about, baselineAt: '', sites: {} }));
    writeFileSync(join(root, 'lint/runtime-files.json'), JSON.stringify(policy({ 'pine-hollow': 3 })));
    const project = join(root, 'src/shards/pine-hollow');
    mkdirSync(join(project, 'runtime'), { recursive: true });
    const add = (name: string) => { writeFileSync(join(project, 'runtime', name), 'export const value = 1;\n'); };
    for (const name of ['a.ts', 'b.ts', 'c.ts']) add(name);
    expect(() => { checkProjectRuntime(project, 'warn', root); }).not.toThrow();
    add('d.ts');
    expect(() => { checkProjectRuntime(project, 'warn', root); }).toThrow(/source file bound \(3;/u);
    expect(() => { checkProjectRuntime(project, 'refuse', root); }).not.toThrow();
    for (let index = 0; index < 125; index++) add(`more${index}.ts`);
    expect(() => { checkProjectRuntime(project, 'refuse', root); }).toThrow(/source file bound \(128;/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the checked-in ceilings are self-consistent and every first-party shard fits its own', () => {
  const repo = resolve(import.meta.dirname, '..'), checkedIn = readRuntimeFiles(repo);
  // The current policy may have shrunk since its historical raises;
  // predecessor transition tests and the gate enforce those changes.
  expect(runtimeFilesShape(checkedIn)).toEqual([]);
  const count = (folder: string): number => existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).reduce((total, entry) => total
    + (entry.isDirectory() ? count(join(folder, entry.name)) : /\.[cm]?[jt]sx?$/u.test(entry.name) && !entry.name.endsWith('.d.ts') ? 1 : 0), 0) : 0;
  for (const slug of ['pine-hollow', 'driftwood-isle']) {
    expect(count(join(repo, 'src/shards', slug, 'runtime')), slug).toBeLessThanOrEqual(runtimeFileCeiling(checkedIn, slug));
  }
});

#!/usr/bin/env node
// Pack the engine with the exact format bits used by its frozen build.
// A private copy keeps pnpm's store links out of the published tarball.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const destination = process.argv[2];
if (destination === undefined) throw new Error('Usage: node scripts/npm-artifact.mjs <output-dir>');
const root = process.cwd(), output = resolve(destination);
mkdirSync(output, { recursive: true });
const stage = mkdtempSync(join(output, '.engine-npm-'));
const pack = (cwd, target) => JSON.parse(execFileSync('npm', [
  'pack', '--ignore-scripts', '--json', '--pack-destination', target,
], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))[0];

try {
  const bare = pack(root, stage);
  execFileSync('tar', ['-xzf', join(stage, bare.filename), '-C', stage]);
  const unpacked = join(stage, 'package'), manifest = join(unpacked, 'package.json');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const format = join(root, 'node_modules/@wildshard/format');
  const deps = JSON.parse(readFileSync(join(format, 'package.json'), 'utf8')).dependencies;
  for (const name of ['@wildshard/format', ...Object.keys(deps)]) {
    cpSync(join(root, 'node_modules', name), join(unpacked, 'node_modules', name), { recursive: true, dereference: true });
  }
  pkg.bundleDependencies = ['@wildshard/format'];
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n');
  const archive = pack(unpacked, output);
  console.log(JSON.stringify({ ...archive, filename: join(output, archive.filename) }));
} finally {
  rmSync(stage, { recursive: true, force: true });
}

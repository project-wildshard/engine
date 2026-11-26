#!/usr/bin/env node
// Pack the engine with the exact format bits used by its frozen build.
// A private copy keeps pnpm's store links out of the published tarball.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOOT_STAMPS } from './boot-stamps.mjs';

const [destination, nextBuild] = process.argv.slice(2);
if (destination === undefined || (nextBuild !== undefined && !/^[a-f0-9]{40}$/u.test(nextBuild)))
  throw new Error('Usage: node src/scripts/npm-artifact.mjs <output-dir> [<exact-next-build>]');
const root = process.cwd(), output = resolve(destination);
mkdirSync(output, { recursive: true });
const stage = mkdtempSync(join(output, '.engine-npm-'));
/** @param {string} cwd @param {string} target */
const pack = (cwd, target) => JSON.parse(execFileSync('npm', [
  'pack', '--ignore-scripts', '--json', '--pack-destination', target,
], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))[0];

try {
  const bare = pack(root, stage);
  execFileSync('tar', ['-xzf', join(stage, bare.filename), '-C', stage]);
  const unpacked = join(stage, 'package'), manifest = join(unpacked, 'package.json');
  // LS1: the boot stamps are ignored build outputs; the archive carries the ones gen:inputs wrote from the pins.
  const unstamped = BOOT_STAMPS.filter(path => !existsSync(join(unpacked, path)));
  if (unstamped.length > 0) throw new Error(`The engine archive lacks its boot stamps (${unstamped.join(', ')}): run node src/scripts/pins.ts install && pnpm gen:inputs first`);
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (nextBuild !== undefined) {
    if (!/^\d+\.\d+\.\d+$/u.test(pkg.version)) throw new Error('An npm next archive needs a stamped release version');
    // SemVer forbids leading zeroes in an all-numeric identifier. Extend the prefix to include a letter when needed.
    const short = nextBuild.slice(0, 8);
    const suffix = /^0\d+$/u.test(short) ? nextBuild.slice(0, nextBuild.search(/[a-f]/u) + 1) : short;
    if (suffix === '') throw new Error('The build cannot be labelled with a valid SemVer SHA prefix');
    pkg.version = `${pkg.version}-next.${suffix}`;
    pkg.gitHead = nextBuild;
  }
  const format = join(root, 'node_modules/@wildshard/format');
  const deps = JSON.parse(readFileSync(join(format, 'package.json'), 'utf8')).dependencies;
  for (const name of ['@wildshard/format', ...Object.keys(deps)]) {
    cpSync(join(root, 'node_modules', name), join(unpacked, 'node_modules', name), { recursive: true, dereference: true });
  }
  pkg.bundleDependencies = ['@wildshard/format'];
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
  const archive = pack(unpacked, output);
  console.log(JSON.stringify({ ...archive, filename: join(output, archive.filename) }));
} finally {
  rmSync(stage, { recursive: true, force: true });
}

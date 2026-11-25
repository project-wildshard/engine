#!/usr/bin/env node
// Meta QA 11-25 row 42 (J505): every org package an engine install pulls admits every Node the workflows may run.
// CI's setup-node reads engine's `engines.node` (`node-version-file: package.json`) and takes the newest cached Node in it,
// and `.npmrc` has engine-strict, so `pnpm install` refuses a dependency whose own range leaves that Node out. Format 0.79.2
// said `>=24.18.0 <25` under engine's `<27`: server-release 45703635653 ran Node 26.13.1 and died at install
// (ERR_PNPM_UNSUPPORTED_ENGINE). A laptop on Node 24 never sees it, so this reads the ranges instead of the running Node.
//
//   node scripts/node-ranges.mjs        exit 1 naming each installed @wildshard package whose range misses part of engine's
//
// Ranges here are what the org writes: `>=A.B.C <N` (or `<N.M.P`, `>`, `<=`, `=`), space-joined, `||` alternatives. A
// package with no `engines.node` admits every Node, as pnpm reads it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @param {string} text @returns {[number, number, number]} */
const parse = text => { const [a = 0, b = 0, c = 0] = text.split('.').map(Number); return [a, b, c]; };
/** @param {number[]} x @param {number[]} y */
const compare = (x, y) => (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0) || (x[2] ?? 0) - (y[2] ?? 0);

/** Whether `version` (A.B.C) is in `range`. @param {string} range @param {string} version */
export function admits(range, version) {
  const v = parse(version);
  return range.split('||').some(set => set.trim().split(/\s+/u).filter(Boolean).every(part => {
    const m = /^(>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})$/u.exec(part);
    if (m === null) throw new Error(`node-ranges: unread range part "${part}" in "${range}"`);
    const c = compare(v, parse(m[2] ?? '0')), op = m[1] ?? '=';
    return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
  }));
}

/** The Node versions `range` admits that a workflow can pick: its lowest, the first of each later major, and the last of each
 *  major (as A.999.999) under its upper bound. @param {string} range */
export function probes(range) {
  const found = new Set();
  for (const set of range.split('||')) {
    const parts = set.trim().split(/\s+/u).filter(Boolean);
    const low = parts.find(part => part.startsWith('>='))?.slice(2) ?? '0.0.0';
    const highPart = parts.find(part => part.startsWith('<'));
    const high = highPart === undefined ? parse(low)[0] + 4 : parse(highPart.replace(/^<=?/u, ''))[0];
    const start = parse(low)[0];
    for (let major = start; major <= high; major++) for (const v of [major === start ? low : `${String(major)}.0.0`, `${String(major)}.999.999`]) if (admits(range, v)) found.add(v);
  }
  return [...found].map(parse).sort(compare).map(v => v.join('.'));
}

/** Each package whose `engines.node` misses a Node `own` admits. @param {string} own @param {{ name: string, version: string, range?: string }[]} packages */
export function rangeGaps(own, packages) {
  const nodes = probes(own);
  return packages.flatMap(pkg => {
    if (pkg.range === undefined) return [];
    const missed = nodes.filter(node => !admits(/** @type {string} */ (pkg.range), node));
    return missed.length === 0 ? [] : [{ name: pkg.name, version: pkg.version, range: pkg.range, missed }];
  });
}

/** Every installed @wildshard package: the direct links and pnpm's store copies. @param {string} root */
export function installedOrgPackages(root) {
  /** @type {Map<string, { name: string, version: string, range?: string }>} */
  const seen = new Map();
  /** @param {string} file */
  const read = file => {
    if (!existsSync(file)) return;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@wildshard/') || pkg.name === '@wildshard/engine') return;
    const range = pkg.engines?.node;
    seen.set(`${pkg.name}@${String(pkg.version)}`, { name: pkg.name, version: String(pkg.version), ...typeof range === 'string' ? { range } : {} });
  };
  const scope = join(root, 'node_modules/@wildshard');
  if (existsSync(scope)) for (const name of readdirSync(scope)) read(join(scope, name, 'package.json'));
  const store = join(root, 'node_modules/.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('@wildshard+')) continue;
      const inner = join(store, entry, 'node_modules/@wildshard');
      if (existsSync(inner)) for (const name of readdirSync(inner)) read(join(inner, name, 'package.json'));
    }
  }
  return [...seen.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd(), own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines?.node;
  if (typeof own !== 'string') { console.error('node-ranges: package.json has no engines.node'); process.exit(1); }
  const gaps = rangeGaps(own, installedOrgPackages(root));
  for (const gap of gaps) {
    console.error(`node-ranges: ${gap.name}@${gap.version} says engines.node "${gap.range}", which refuses Node ${gap.missed.join(', ')} that engine's "${own}" lets CI pick; publish it with a range that admits them (meta QA 11-25 row 42)`);
  }
  process.exit(gaps.length === 0 ? 0 : 1);
}

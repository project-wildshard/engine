#!/usr/bin/env node
// The push gate's test selection (Jake, 2026-10-15): the test files that import the changed sources (`vitest related`),
// capped so the test phase stays near 45 s; the full suite runs in CI on every push (the `behaviour` job), fix-forward.
//   node scripts/gate-related-tests.mjs <changed.json> [--budget=<seconds>]   prints a JSON array of test files
// Vitest walks every test file's import graph backwards from the changed files. A change that touches a widely
// imported module (or a forceRerunTrigger such as package.json, which relates every test) can relate most of the suite:
// then the files named after a changed source run first, and the rest go cheapest first (each file's last duration from
// Vitest's results cache, `node_modules/.vite/vitest`, plus its module load) while the estimated wall time (their sum over
// WS_VITEST_MAX_WORKERS, plus Vitest's startup) stays within `--budget` (45 s). What is left over is printed to stderr
// and runs in CI. A changed test file always runs. Today the whole suite (~115 files) estimates under the budget at the
// gate's 4 workers, so the cap only bites once the suite grows. Wasm scenarios have explicit source/row edges
// below because the test imports the built bytes; those required tests run even beyond the estimate.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { createVitest } from 'vitest/node';
import { liveTestSelection } from './push-inputs.mjs';
import { readWeights } from './test-timings.mjs';

// The tree under test is the working directory (the gate runs the checkout's copy of this script in the build mirror).
const ROOT = process.cwd();
// Vitest keys its results cache by sha1 of the project name; the root config has none (sha1 of '').
const RESULTS = resolve(ROOT, 'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json');
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
// vitest.config.ts `include`.
const INCLUDED = /^(?:(?:src\/|(?:admin\/|drafts\/)?test\/).+\.test\.ts|test\/.+\.test\.mjs)$/u;
// Measured in the gate mirror (2026-10-15): the 115-file suite's module loads add ~0.5 s a file to the cached test
// durations, and Vitest's startup with the import-graph walk takes ~5 s.
const LOAD_SECONDS = 0.5;
const STARTUP_SECONDS = 5;
// G498: these seconds-long lifecycle checks run on every push, even for
// unrelated source changes and a fully exhausted related-test budget.
export const QUICK_TESTS = ['test/grid-reentry.test.ts'];

/** Required push guards, including pushes without related sources.
 * @param {readonly string[]} changed @returns {string[]} */
export function pushGuards(changed) {
  return [
    ...(changed.some(file => /^src\/(?:format|sdk|sharddev)\//u.test(file)) ? ['test/schema-reference.test.ts'] : []),
    'test/host-callbacks.test.ts', 'test/shardfile-boundaries.test.ts',
    'test/manifest-declarations.test.ts',
  ];
}

/** Package export edits affect their importers, not every test in the repo.
 * @param {string} root @returns {string[]} */
export function forceRerunTriggers(root) {
  return ['package.json', '{vitest,vite}.config.*'].map(file => resolve(root, file));
}

/** Last known duration in seconds per test file (relative path), from Vitest's results cache.
 * @returns {Map<string, number>} */
function knownDurations() {
  /** @type {Map<string, number>} */
  const durations = new Map();
  // Main's last measured run (scripts/test-timings.mjs, LAND-SIMPLIFY LS2), then this checkout's own results.
  for (const [file, seconds] of Object.entries(readWeights('full'))) durations.set(file, seconds);
  if (!existsSync(RESULTS)) return durations;
  try {
    /** @type {{ results?: [string, { duration?: number }][] }} */
    const cache = JSON.parse(readFileSync(RESULTS, 'utf8'));
    // Keys are `<project>:<file>`; the root config's project has no name. A failed load records 0 (no estimate).
    for (const [key, result] of cache.results ?? []) {
      if (key.startsWith(':') && typeof result.duration === 'number' && result.duration > 0) durations.set(key.slice(1), result.duration / 1000);
    }
  } catch { /* an unreadable cache only loses the estimates */ }
  return durations;
}

/** The stem a test file or source is named by: `coverGrid.test.ts` and `coverGrid.ts` both give `covergrid`.
 * @param {string} path */
function stem(path) {
  return basename(path).replace(TEST_FILE, '').replace(/\.d?\.?[cm]?[jt]sx?$/u, '').replaceAll(/[-_.]/gu, '').toLowerCase();
}

/** Scenario imports reach the built Wasm, not its author source. Preserve that explicit gate edge.
 * Row declarations can be composed across author modules, so an author data/config change selects all
 * scenarios for its shard rather than guessing which row a TypeScript expression produces.
 * @param {string[]} changed repository-relative paths, including removed sources
 * @param {string[]} tests available repository-relative scenario test paths
 * @returns {string[]} */
export function scriptScenarioTests(changed, tests) {
  const selected = new Set();
  for (const file of changed) {
    const source = /^src\/shards\/([^/]+)\/behaviour\/(?:[^/]+\/)*([^/]+)\.as$/u.exec(file);
    if (source) {
      const target = `test/scripts/${source[1]}-${source[2]}.test.ts`;
      if (tests.includes(target)) selected.add(target);
    }
    const author = /^src\/shards\/([^/]+)\/(?:data\/|generators\/|shard\.config\.ts$|behaviour\/(?!.*\.as$))/u.exec(file);
    if (author) for (const test of tests) if (test.startsWith(`test/scripts/${author[1]}-`)) selected.add(test);
  }
  return [...selected].sort((a, b) => a.localeCompare(b));
}

/** Disk readers have no import edge to the author modules that publish their bytes.
 * @param {string[]} changed @param {Record<string, string[]>} registry @returns {string[]} */
export function productReaderTests(changed, registry) {
  const shared = changed.some(file => /^(?:src\/(?:sdk|sharddev|format)\/|scripts\/(?:build-shardfiles\.mjs|shardfile-cache\.mjs|test-products\.json)$)/u.test(file));
  return Object.entries(registry).filter(([, slugs]) => shared || changed.some(file => slugs.some(slug =>
    file.startsWith(`src/shards/${slug}/`) || file.startsWith(`public/assets/${slug}/`))))
    .map(([test]) => test).sort((a, b) => a.localeCompare(b));
}

/**
 * Pick the related test files to run within `seconds` of estimated wall time on `workers` workers.
 * @param {string[]} related every related test file (relative paths)
 * @param {string[]} changed the changed files (relative paths)
 * @param {Map<string, number>} durations last test seconds per file
 * @param {number} seconds wall-time budget
 * @param {number} workers
 * @param {string[]} required explicit gate edges that must run even beyond the estimate
 * @returns {{ run: string[], left: string[] }}
 */
export function capRelated(related, changed, durations, seconds, workers, required = []) {
  const known = [...durations.values()].sort((a, b) => a - b);
  const typical = known.length > 0 ? (known[Math.floor(known.length / 2)] ?? 1) : 1;
  const cost = (/** @type {string} */ file) => (durations.get(file) ?? typical) + LOAD_SECONDS;
  const budget = Math.max(0, seconds - STARTUP_SECONDS) * workers;
  const stems = new Set(changed.map(stem));
  const own = changed.filter((file) => INCLUDED.test(file) && !related.includes(file));
  const named = [...new Set([...required, ...own, ...related.filter((file) => changed.includes(file) || stems.has(stem(file)))])];
  const rest = related.filter((file) => !named.includes(file)).sort((a, b) => cost(a) - cost(b) || a.localeCompare(b));
  const run = [...named];
  let spent = named.reduce((sum, file) => sum + cost(file), 0);
  const left = [];
  for (const file of rest) {
    if (spent + cost(file) <= budget) { run.push(file); spent += cost(file); } else left.push(file);
  }
  return { run: run.sort((a, b) => a.localeCompare(b)), left };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const listFile = process.argv[2];
  if (!listFile) { console.error('usage: gate-related-tests.mjs <changed.json> [--budget=<seconds>]'); process.exit(2); }
  /** @type {string[]} */
  const changed = JSON.parse(readFileSync(listFile, 'utf8'));
  const budgetArg = process.argv.find((arg) => arg.startsWith('--budget='));
  const seconds = budgetArg === undefined ? 45 : Number(budgetArg.slice('--budget='.length));
  const workers = Number(process.env.WS_VITEST_MAX_WORKERS ?? '6') || 6;
  const started = performance.now();
  const sources = changed.filter((file) => existsSync(resolve(ROOT, file)));
  /** @type {string[]} */
  let related = [];
  const recentOnly=process.argv.includes('--recent-only');
  if (recentOnly) related=sources.filter(file => INCLUDED.test(file));
  else if (sources.length > 0) {
    const vitest = await createVitest({ root: ROOT, related: sources.map((file) => resolve(ROOT, file)), run: true, watch: false, forceRerunTriggers: forceRerunTriggers(ROOT) },
      { logLevel: 'silent' });
    try {
      const specs = await vitest.getRelevantTestSpecifications();
      related = [...new Set(specs.map((spec) => relative(ROOT, spec.moduleId)))];
    } finally { await vitest.close(); }
  }
  const scenarioDir = resolve(ROOT, 'test/scripts');
  const scenarios = existsSync(scenarioDir) ? readdirSync(scenarioDir).filter(file => file.endsWith('.test.ts')).map(file => `test/scripts/${file}`) : [];
  const registryPath = existsSync(resolve(ROOT, 'scripts/test-products.json')) ? resolve(ROOT, 'scripts/test-products.json') : resolve(import.meta.dirname, 'test-products.json');
  /** @type {Record<string, string[]>} */
  const products = JSON.parse(readFileSync(registryPath, 'utf8'));
  const live = process.argv.includes('--live');
  const required = live ? [] : [...new Set([...QUICK_TESTS, ...scriptScenarioTests(changed, scenarios), ...productReaderTests(changed, products).filter(test => existsSync(resolve(ROOT, test)))])];
  const selection = live ? liveTestSelection(ROOT, [...new Set([...related, ...sources.filter(file => INCLUDED.test(file))])], products, changed) : { run: related, deferred: [] };
  for (const row of selection.deferred) console.error(`gate-related-tests: CI only ${row.test} (${row.reason})`);
  const allowed = new Set(selection.run);
  const eligible = related.filter(file => allowed.has(file));
  const eligibleSources = live ? sources.filter(file => !INCLUDED.test(file) || allowed.has(file)) : sources;
  const { run, left } = capRelated(eligible, eligibleSources, knownDurations(), seconds, workers, required);
  const walk = ((performance.now() - started) / 1000).toFixed(1);
  const over = left.length > 0 ? `; ${left.length} over the ${seconds}s budget run in CI only: ${left.join(' ')}` : '';
  console.error(`gate-related-tests: ${related.length} related + ${required.length} required product test files for ${sources.length} changed sources (${walk}s)${over}`);
  const durations = knownDurations();
  if (live) run.sort((a, b) => (durations.get(a) ?? 1) - (durations.get(b) ?? 1) || a.localeCompare(b));
  // Keep machine output out of the merged diagnostics pipe (writes interleave).
  const payload = `${JSON.stringify(run)}\n`;
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  if (output !== undefined) writeFileSync(resolve(output), payload);
  else process.stdout.write(payload);
}

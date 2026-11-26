// FLOW-SIMPLE FS27 (meta; Jake ~21:05 Cancún 2026-11-19: "we are really like flipping that thing red a lot"): the push
// gate runs the cheap checks behind 11-19's main reds. Vitest's related selection follows imports only, and a test that
// reads a file by path, a pin or a digest has no import edge to it; a pin push is a harness change, so the split gate
// sends all but its native files to hosted CI. Each such reader is declared here and runs at push:
//   - every code push: check-css (CI static, ~1 s), agent-markers (~0.1 s) and the host-ruler and section-host tables (three Vitest files, ~1.2 s);
//   - a changed path in PATH_EDGES: the files that read it (a static check named by `static` already runs every push);
//   - a shard pin or Ring 1 digest change: ring-step.ts for the Ring 1 slugs it moves (~4 s each), not all seven (17 s).
// test/push-path-edges.test.ts holds a push for each row that would have gone red, and fails if the gate skips its run.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** CI static's sub-10-second checks the push gate lacked (src/scripts/ci-static.sh code). */
export const FS27_STATIC = Object.freeze([
  { name: 'check-css', commands: [[process.execPath, 'src/scripts/check-css.mjs']] },
  // Main red 45410583837: a new script fetched with no agent marker (METRICS MT2/MT3); ~0.1 s, so every code push runs it.
  { name: 'agent-markers', commands: [[process.execPath, 'src/scripts/.kit/agent-marker-check.mjs']] },
]);

/** The host-ruler and section-host tables (HOST-RULER HR1-HR4): cheap, and read by every built product. */
export const TABLE_TESTS = Object.freeze([
  'test/host-ruler-register.test.ts', 'test/host-ruler-roots.test.ts', 'test/host-ruler-server-roots.test.ts',
]);

/**
 * Readers with no import edge to what they read.
 * @type {readonly {why:string, pattern:RegExp, tests?:readonly string[], static?:string, ring?:boolean}[]}
 */
export const PATH_EDGES = Object.freeze([
  // A shard pin moves the built products these load, and Ring 1's server digests (ring-step.ts).
  { why: 'shard pin', pattern: /^test\/pins\/(?:shardfiles|ring-digests)\.json$/u, tests: ['test/pin-shard.test.ts', 'test/racked-prompt.test.ts'], ring: true },
  // The pinned format package's section index is what the section-host table must name, row for row.
  { why: 'format section', pattern: /^(?:package\.json|pnpm-lock\.yaml|src\/scripts\/host-ruler(?:\.mjs|\/))/u, tests: ['test/host-ruler-roots.test.ts'] },
  // check:saves runs every push (WIRE-STABILITY WR7).
  { why: 'save key', pattern: /^src\/shared\/engine\/saves\//u, static: 'check:saves' },
  // precompile-first-view runs the source of precompile.ts's private selection, read by path.
  { why: 'precompile', pattern: /^src\/client\/engine\/render\/precompile\.ts$/u, tests: ['src/client/engine/render/precompile-first-view.test.ts'] },
  // index.html inlines base.css and loading.css (DL21); check:inline-shell-css runs every push too.
  { why: 'loading card', pattern: /^(?:index\.html|src\/client\/engine\/ui\/(?:styles\/base\.css|loading\.css))$/u, tests: ['test/inline-shell-css.test.mjs'], static: 'check:inline-shell-css' },
  // Tooling tests whose script changed.
  { why: 'chrome-keychain', pattern: /^src\/scripts\/\.kit\/chromium-keychain[^/]*\.mjs$/u, tests: ['src/test/.kit/chrome-keychain.test.mjs'] },
  { why: 'gate-related-tests', pattern: /^src\/scripts\/gate-related-tests\.mjs$/u, tests: ['test/gate-related-tests.test.ts'] },
]);

/** Sim-state source: what a snapshot, and so Ring 1's step digest, is made of. FP53b (bd2db0ad9) changed it with no pin or
 *  digest moved, so no Ring 1 step ran before the push and main went red on ring1 step (run 45597738510). */
export const SIM_STATE = /^src\/(?:shared\/engine\/sim\/|server\/engine\/sim(?:\.ts$|\/)|server\/game\/(?:shardfile|plugin|population|riding|boss|shard)\/)(?!.*\.test\.)/u;

/** Every Ring 1 slug this platform's baseline names when a changed file is sim-state source, else none.
 * @param {readonly string[]} changed @param {any} digests ring-digests.json @param {string} platform @returns {string[]} */
export function simRingSlugs(changed, digests, platform) {
  if (!changed.some(file => SIM_STATE.test(file))) return [];
  return Object.keys(Object.assign({}, ...Object.values(digests?.[platform] ?? {}))).sort((a, b) => a.localeCompare(b));
}

/** The declared readers of the changed paths, sorted. @param {readonly string[]} changed @returns {string[]} */
export function edgeTests(changed) {
  const tests = new Set();
  for (const row of PATH_EDGES) if (changed.some(file => row.pattern.test(file))) for (const test of row.tests ?? []) tests.add(test);
  return [...tests].sort((a, b) => a.localeCompare(b));
}

/** A test that reads a file as `new URL('<path>', import.meta.url)`, the shape the finish.ts readers use. */
const URL_READ = /new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/gu;

/**
 * Main red 45746379191 (QA 11-25 row 72's 90714b4e3): finish.ts changed, and finish-background-idle.test.ts, which
 * runs finish.ts's source read by URL, was not selected, since a read has no import edge. Every test that reads a
 * changed file by `new URL(..., import.meta.url)` is found here, so no reader needs a hand row in PATH_EDGES.
 * @param {readonly string[]} changed repo-relative paths @param {string} [cwd] @returns {string[]}
 */
export function urlReaderTests(changed, cwd = process.cwd()) {
  if (changed.length === 0) return [];
  const want = new Set(changed.map(file => normalize(file)));
  let listed = '';
  try {
    listed = execFileSync('git', ['grep', '-lF', 'new URL(', '--', '*.test.ts', '*.test.mts', '*.test.mjs', '*.test.js', '*.test.tsx'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return []; } // git grep exits 1 when nothing matches
  const tests = new Set();
  for (const test of listed.split('\n').filter(Boolean)) {
    for (const match of readFileSync(join(cwd, test), 'utf8').matchAll(URL_READ)) {
      if (want.has(normalize(join(dirname(test), match[2] ?? '')))) { tests.add(test); break; }
    }
  }
  return [...tests].sort((a, b) => a.localeCompare(b));
}

/** @param {string} sha @param {string} file @param {string} cwd @returns {any} */
function readAt(sha, file, cwd) {
  try { return JSON.parse(execFileSync('git', ['show', `${sha}:${file}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return {}; }
}

/** @param {{shards?: Array<{slug:string}>}} pins */
const pinRows = pins => new Map(Object.values(pins?.shards ?? {}).map(row => [row.slug, JSON.stringify(row)]));

/**
 * The Ring 1 slugs a push moves: a changed pin row or a changed digest chain, among the slugs the pushed tree's Ring 1
 * baseline names for this platform.
 * @param {any} before @param {any} after shardfiles.json and ring-digests.json, `{pins, digests}`, at each end
 * @param {string} platform e.g. darwin-arm64
 * @returns {string[]}
 */
export function movedRingSlugs(before, after, platform) {
  /** @param {any} digests */
  const chains = digests => Object.assign({}, ...Object.values(digests?.[platform] ?? {}));
  const [was, now, oldChains, newChains] = [pinRows(before.pins), pinRows(after.pins), chains(before.digests), chains(after.digests)];
  return Object.keys(newChains).filter(slug => was.get(slug) !== now.get(slug)
    || JSON.stringify(oldChains[slug]) !== JSON.stringify(newChains[slug])).sort((a, b) => a.localeCompare(b));
}

/** Moved pin rows and Ring 1 digests over a pre-push ref list.
 * @param {string|undefined} refs @param {string} cwd @returns {{pins:string[],ring:string[]}} */
export function pinChanges(refs, cwd, platform = `${process.platform}-${process.arch}`) {
  const pins = new Set(), ring = new Set();
  for (const line of (refs ?? '').trim().split('\n')) {
    const [, local, , remote] = line.trim().split(/\s+/u);
    if (!/^[a-f0-9]{40}$/u.test(local ?? '') || !/^[a-f0-9]{40}$/u.test(remote ?? '') || /^0+$/u.test(local ?? '')) continue;
    const end = /** @param {string} sha */ sha => ({ pins: readAt(sha, 'test/pins/shardfiles.json', cwd), digests: readAt(sha, 'test/pins/ring-digests.json', cwd) });
    const before = /^0+$/u.test(remote ?? '') ? { pins: {} } : end(remote ?? '');
    const after = end(local ?? '');
    const was = pinRows(before.pins);
    for (const [slug, row] of pinRows(after.pins)) if (was.get(slug) !== row) pins.add(slug);
    for (const slug of movedRingSlugs(before, after, platform)) ring.add(slug);
  }
  return { pins: [...pins].sort((a, b) => a.localeCompare(b)), ring: [...ring].sort((a, b) => a.localeCompare(b)) };
}

/**
 * What FS27 adds to a code push: its static tasks, the Vitest files to run, and the Ring 1 step.
 * @param {{mode:'full'|'related'|'docs', files:string[]}} selection
 * @param {{split:boolean, slugs:readonly string[], cwd?:string}} options
 * @returns {{tasks:{name:string,commands:string[][]}[], tests:string[]}}
 */
export function fs27Plan(selection, options) {
  if (selection.mode === 'docs') return { tasks: [], tests: [] };
  // A non-split full gate runs the whole suite already.
  const tests = !options.split && selection.mode === 'full' ? [] : [...new Set([...TABLE_TESTS, ...edgeTests(selection.files), ...urlReaderTests(selection.files, options.cwd)])].sort((a, b) => a.localeCompare(b));
  const ring = options.slugs.length === 0 ? [] : [{ name: `ring1 digests (${options.slugs.join(', ')})`,
    commands: [
      [process.execPath, 'src/scripts/pins.ts', 'install', '--ring-slices', '1'],
      [process.execPath, '--no-warnings', 'src/scripts/ring-step.ts', '--only', options.slugs.join(',')],
    ] }];
  return { tasks: [...FS27_STATIC, ...ring], tests };
}

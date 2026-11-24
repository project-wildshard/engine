// oxlint-disable-next-line import/no-nodejs-modules -- The guard reads the workflow files themselves.
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// FLOW-SIMPLE FS30/FS30g, J505 (QA-FEEDBACK-2026-11-23-b; Jake, 2026-11-23 ~20:40 Cancún: "make it a permanent fix"):
// the nightly's Chromium heads restored only the Ring 1 spawn-part subset and re-encoded the rest until the 1800 s cap,
// while ci's memory-client-build restored its full-ledger cache and built the same 453 parts with 0 encodes in 67 s.
// Every job that builds the full game and restores spawn parts must try ci's full-ledger key before any other.

const DIR = '.github/workflows/';
const SPAWN_PARTS = 'path: ~/.cache/wildshard/gen/spawn-parts-br';
// FAST-RELEASE FR-A1: page-release.mjs runs build:game and devserver-client.mjs builds the full client; preview.yml and
// server-release.yml's devserver-client restored nothing, so neither rule above saw them and both re-encoded cold.
const FULL_BUILD = /pnpm build:game|scripts\/build-app\.mjs|scripts\/staging-qa\.mjs --local|scripts\/page-release\.mjs|scripts\/devserver-client\.mjs/u;
const LEDGER = /full-ledger-spawn-parts-br|steps\.ledger-(?:key|codec)\.outputs\.(?:key|prefix)/u;
/** A nightly's own save under this commit is a full build too, so it may come first. */
const SAME_COMMIT_FULL = 'nightly-encodes-${{ github.sha }}';

/** Each job's name and text, from a workflow file. */
function jobsOf(text: string): { name: string; body: string }[] {
  const at = text.indexOf('\njobs:\n');
  if (at < 0) return [];
  const rows: { name: string; body: string }[] = [];
  for (const chunk of text.slice(at + 7).split(/\n(?= {2}[a-z0-9_-]+:\n)/u)) {
    const name = /^ {2}([a-z0-9_-]+):/u.exec(chunk)?.[1];
    if (name !== undefined) rows.push({ name, body: chunk });
  }
  return rows;
}

/** The key and restore keys of every cache restore of the spawn parts in one job, in the order actions/cache tries them. */
function restores(body: string): string[][] {
  return body.split(/\n(?= {6}- )/u)
    .filter(step => step.includes('actions/cache/restore@') && step.includes(SPAWN_PARTS))
    .map(step => {
      const key = /\n {10}key: (.+)/u.exec(step)?.[1]?.trim() ?? '';
      const inline = /\n {10}restore-keys: (?!\|)(.+)/u.exec(step)?.[1]?.trim();
      const block = /\n {10}restore-keys: \|\n((?: {12}.+\n?)+)/u.exec(step)?.[1] ?? '';
      const rest = inline === undefined ? block.split('\n').map(line => line.trim()).filter(line => line !== '') : [inline];
      return [key, ...rest];
    });
}

test('FS30: every full-game build that restores spawn parts tries ci\'s full-ledger key first', () => {
  const offenders: string[] = [];
  let guarded = 0;
  for (const file of readdirSync(DIR).filter(name => name.endsWith('.yml'))) {
    for (const job of jobsOf(readFileSync(DIR + file, 'utf8'))) {
      if (!FULL_BUILD.test(job.body)) continue;
      for (const candidates of restores(job.body)) {
        guarded++;
        const first = candidates.find(candidate => candidate !== SAME_COMMIT_FULL) ?? '';
        if (!LEDGER.test(first)) offenders.push(`${file} ${job.name}: first tries ${first || '(nothing)'}`);
      }
    }
  }
  expect(offenders).toEqual([]);
  // nightly heads and head-diagnostic, release-preflight, hover-contract, engine-boundaries catalogue, ci memory-client-build
  expect(guarded).toBeGreaterThanOrEqual(6);
});

test('FS30: the full-ledger key action builds the key ci saves under', () => {
  const ci = readFileSync(`${DIR}ci.yml`, 'utf8');
  const action = readFileSync('.github/actions/full-ledger-key/action.yml', 'utf8');
  expect(ci).toContain('prefix="full-ledger-spawn-parts-br-v2-$RUNNER_OS-$RUNNER_ARCH-$codec-$CODEC_INPUTS-"');
  expect(ci).toContain(String.raw`printf 'prefix=%s\nkey=%s%s-parts-and-server\n' "$prefix" "$prefix" "$PART_INPUTS"`);
  expect(action).toContain('prefix="full-ledger-spawn-parts-br-v2-$runner-$codec-$CODEC_INPUTS-"');
  expect(action).toContain('runner="$RUNNER_OS-$RUNNER_ARCH"');
  expect(action).toContain('"$out" "$prefix" "$PART_INPUTS"');
  // memory-client-build runs on ubuntu-latest (X64); the action's linux key is that runner's.
  expect(ci).toMatch(/memory-client-build:[\s\S]*?runs-on: ubuntu-latest/u);
  for (const name of ['CODEC_INPUTS', 'PART_INPUTS']) {
    const hashes = (text: string): string | undefined => new RegExp(`${name}: (\\$\\{\\{ hashFiles\\(.+\\) \\}\\})`, 'u').exec(text)?.[1];
    expect(hashes(action), name).toBeDefined();
    expect(hashes(action), name).toBe(hashes(ci));
  }
});

// FAST-RELEASE FR-A1 (J505; Jake, 2026-11-24 ~18:20 Cancún: "Do the same audit & review ... of all the other release
// processes"): preview.yml's build:game re-encoded every spawn part cold and hit the 1800 s cap (4 reds in a row), and
// server-release's devserver client took 29 min (6 of 25 runs red), because neither job restored any spawn parts. The
// rule above only orders restores that exist; this one makes a job that builds the full game restore ci's ledger at all.
/** Jobs that build only a Ring 1 subset, or encode on purpose, and are allowed to start cold. */
const COLD_OK = new Set<string>([]);

test('FR-A1: every job that builds the full game restores ci\'s full-ledger spawn parts', () => {
  const missing: string[] = [];
  for (const file of readdirSync(DIR).filter(name => name.endsWith('.yml'))) {
    for (const job of jobsOf(readFileSync(DIR + file, 'utf8'))) {
      if (!FULL_BUILD.test(job.body) || COLD_OK.has(`${file} ${job.name}`)) continue;
      const tried = restores(job.body).flat();
      if (!tried.some(candidate => LEDGER.test(candidate))) missing.push(`${file} ${job.name}`);
    }
  }
  expect(missing).toEqual([]);
});

// Cheap staged-source guards; the caller owns the common wall deadline.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { compareCounts, hardRules, readLintConfig } from './guard-counts.mjs';
import { untypedLintConfig } from './push-lint-config.mjs';
import { ratchetApprovalFailures } from './ratchet-approval.mjs';
import { linkNodeModules } from './link-node-modules.mjs';

const lintThreads = `--threads=${Math.min(8, availableParallelism())}`;

/** Preserve syntax rules; type-aware rules stay in the separate typed gate.
 * @param {unknown} raw */
export function fastCommitLintConfig(raw) {
  return untypedLintConfig(raw);
}

/** @param {string[]} files @param {string} executable */
export function fastLint(files, executable) {
  const config = fastCommitLintConfig({ options: { typeAware: false }, ...readLintConfig('.oxlintrc.json') });
  const path = `.commit-fast-lint-${process.pid}.json`;
  writeFileSync(path, JSON.stringify(config));
  try {
    const result = spawnSync(executable, [lintThreads, '-c', path, ...files], { encoding: 'utf8', stdio: 'inherit' });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error('Fast staged lint refused');
  } finally { unlinkSync(path); }
}

/** @param {string[]} files @param {string} executable @param {string} [repository] */
export async function stagedRatchet(files, executable, repository) {
  const { comparePlatformList } = await import('./check-platform-ratchets.mjs');
  const root = process.cwd(), baseline = JSON.parse(readFileSync('.commit-baseline-ratchet.json', 'utf8'));
  /** @type {Record<string, Record<string, number>>} */
  const current = {};
  const hard = hardRules('.oxlintrc.json');
  const selected = files.filter(file => file.startsWith('src/'));
  /** @param {string} directory @param {string[]} paths */
  const measureCounts = (directory, paths) => {
    /** @type {Record<string, Record<string, number>>} */
    const counts = {};
    const counted = JSON.parse(readFileSync('.oxlintrc.ratchet.json', 'utf8'));
    counted.rules['wildshard/no-authored-html'] = 'off'; counted.rules['wildshard/no-shard-host-callback'] = 'off';
    writeFileSync(resolve(directory, '.commit-ratchet-lint.json'), JSON.stringify(counted));
    const result = spawnSync(executable, [lintThreads, '-c', '.commit-ratchet-lint.json', '-f', 'json', ...paths], {
      cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, WILDSHARD_RATCHET_FILE: resolve('.commit-baseline-ratchet.json'), WS_HTML_LINT_FILES: JSON.stringify(paths) },
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error(`Ratchet lint failed: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    if (!Array.isArray(output.diagnostics) || result.status === 1 && output.diagnostics.length === 0) throw new Error('Ratchet lint returned no diagnostics');
    for (const diagnostic of output.diagnostics) {
      const match = /^wildshard\(([^)]+)\)$/u.exec(diagnostic.code ?? '');
      if (match === null || typeof diagnostic.filename !== 'string') throw new Error(`Unexpected ratchet diagnostic: ${JSON.stringify(diagnostic)}`);
      const key = `wildshard/${match[1]}`, file = relative(directory, resolve(directory, diagnostic.filename));
      const rows = Object.hasOwn(counts, key) ? counts[key] : {};
      rows[file] = (Object.hasOwn(rows, file) ? rows[file] : 0) + 1; counts[key] = rows;
    }
    return counts;
  };
  if (selected.length > 0) Object.assign(current, measureCounts(root, selected));
  // Missing generated debt rows are measured against immutable HEAD source.
  // Explicit allowances (including zero) and hard rules never borrow debt.
  const policy = JSON.parse(readFileSync('lint/ratchet.json', 'utf8'));
  const missing = selected.filter(file => Object.entries(current).some(([rule, rows]) =>
    !hard.has(rule) && (rows[file] ?? 0) > 0 && !Object.hasOwn(policy[rule] ?? {}, file)));
  const effective = structuredClone(policy);
  for (const rule of hard) effective[rule] = baseline[rule] ?? {};
  if (missing.length > 0) {
    if (repository === undefined) throw new Error('Missing HEAD repository for staged ratchet comparison');
    const head = resolve('.commit-head');
    const prepared = spawnSync('python3', [resolve(import.meta.dirname, 'precommit-source.py'), repository, head,
      String(Date.now() / 1000 + 5), 'HEAD', JSON.stringify({ files: missing, guards: [], deleted: false })],
    { encoding: 'utf8', maxBuffer: 1 << 30 });
    if (prepared.error !== undefined) throw prepared.error;
    if (prepared.status !== 0) throw new Error(`HEAD ratchet source failed: ${prepared.stderr}`);
    linkNodeModules(repository, head);
    const existing = missing.filter(file => existsSync(resolve(head, file)));
    const previous = existing.length === 0 ? {} : measureCounts(head, existing);
    for (const [rule, rows] of Object.entries(current)) {
      if (hard.has(rule)) continue;
      for (const file of Object.keys(rows)) {
        if (Object.hasOwn(baseline[rule] ?? {}, file)) continue;
        effective[rule] ??= {};
        effective[rule][file] = previous[rule]?.[file] ?? 0;
      }
    }
  }
  const failures = compareCounts(effective, current, hard, files, false, true, true).failures;
  // The candidate's rise history is checked against HEAD's, so a recorded raise passes (G664).
  failures.push(...comparePlatformList('lint/ratchet.json', resolve('.commit-baseline-ratchet.json'), resolve('lint/ratchet.json')));
  failures.push(...ratchetApprovalFailures(baseline, policy, process.env.WS_COMMIT_MESSAGE ?? ''));
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

if (import.meta.main) {
  const mode = process.argv[2], files = JSON.parse(readFileSync('.commit-files.json', 'utf8'));
  try {
    if (mode === 'fast') fastLint(files, process.argv[3] ?? 'oxlint');
    else if (mode === 'ratchet') await stagedRatchet(files, process.argv[3] ?? 'oxlint', process.argv[4]);
    else if (mode === 'deleted') {
      const { deletedReferences } = await import('./push-checks.mjs');
      const errors = deletedReferences(process.cwd(), JSON.parse(readFileSync('.commit-deleted.json', 'utf8')));
      if (errors.length > 0) throw new Error(errors.join('\n'));
    } else throw new Error('Unknown pre-commit guard');
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

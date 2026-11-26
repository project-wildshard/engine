import { expect, test } from 'vitest';
import { createTempRepo, type TempRepo } from '../src/test/helpers/git.ts';
import { preparedReleaseFollows } from '../src/scripts/server-release/history.mjs';

const manifest = (version: string): string => JSON.stringify({ name: 'release-fixture', version, scripts: { build: 'build' } });

function prepare(repo: TempRepo, cut: string, version: string, extra: Readonly<Record<string, string>> = {}): string {
  repo.git(['switch', '--detach', cut]);
  const build = repo.commit({ 'package.json': manifest(version), 'CHANGELOG.md': `## v${version}\n`, ...extra }, `chore(release): v${version}`);
  repo.git(['update-ref', `refs/remotes/origin/release/v${version}`, build]);
  return build;
}

test('an abandoned prepared release advances only to a newer release from the same or a later main cut', () => {
  const repo = createTempRepo();
  try {
    const cut = repo.commit({ 'package.json': manifest('0.1.29'), 'runtime.ts': 'old source' }, 'Main before staging');
    const abandoned = prepare(repo, cut, '0.1.30');
    repo.git(['switch', 'main']);
    const fixed = repo.commit({ 'runtime.ts': 'fixed source' }, 'Fix the entry loop');
    repo.git(['update-ref', 'refs/remotes/origin/main', fixed]);
    const next = prepare(repo, fixed, '0.1.31');
    expect(preparedReleaseFollows(abandoned, next, repo.dir)).toBe(true);
    expect(preparedReleaseFollows(next, abandoned, repo.dir)).toBe(false);
    expect(preparedReleaseFollows(abandoned, abandoned, repo.dir)).toBe(false);
    expect(preparedReleaseFollows(abandoned, prepare(repo, cut, '0.1.32'), repo.dir)).toBe(true);
    expect(preparedReleaseFollows(next, prepare(repo, cut, '0.1.33'), repo.dir)).toBe(false);
    const orphan = repo.git(['commit-tree', `${fixed}^{tree}`, '-m', 'Unrelated source']);
    expect(preparedReleaseFollows(abandoned, prepare(repo, orphan, '0.1.34'), repo.dir)).toBe(false);
    repo.git(['update-ref', 'refs/remotes/origin/release/v0.1.31', fixed]);
    expect(preparedReleaseFollows(abandoned, next, repo.dir)).toBe(false);
    expect(repo.git(['rev-parse', 'refs/remotes/origin/release/v0.1.30'])).toBe(abandoned);
  } finally { repo.cleanup(); }
});

test('release-only code, dependency changes and unpublished cuts still require real ancestry', () => {
  const repo = createTempRepo();
  try {
    const cut = repo.commit({ 'package.json': manifest('0.1.29'), 'runtime.ts': 'old source' }, 'Main source');
    repo.git(['update-ref', 'refs/remotes/origin/main', cut]);
    const abandoned = prepare(repo, cut, '0.1.30');
    const code = prepare(repo, cut, '0.1.31', { 'runtime.ts': 'release-only fix' });
    const dependencies = prepare(repo, cut, '0.1.32', { 'package.json': JSON.stringify({ name: 'release-fixture', version: '0.1.32', dependencies: { changed: '1.0.0' } }) });
    const clean = prepare(repo, cut, '0.1.33');
    expect(preparedReleaseFollows(abandoned, code, repo.dir)).toBe(false);
    expect(preparedReleaseFollows(code, clean, repo.dir)).toBe(false);
    expect(preparedReleaseFollows(abandoned, dependencies, repo.dir)).toBe(false);
    expect(preparedReleaseFollows(dependencies, clean, repo.dir)).toBe(false);
    expect(preparedReleaseFollows(abandoned, clean, repo.dir)).toBe(true);
    repo.git(['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(preparedReleaseFollows(abandoned, clean, repo.dir)).toBe(false);
    expect(preparedReleaseFollows('not a commit', clean, repo.dir)).toBe(false);
  } finally { repo.cleanup(); }
});

test('a prepared release with a browser-test follow-up may supersede an untagged staging cut', () => {
  const repo = createTempRepo();
  try {
    const cut = repo.commit({ 'package.json': manifest('0.1.50'), 'runtime.ts': 'old source' }, 'Main source');
    const abandoned = prepare(repo, cut, '0.1.52');
    repo.git(['switch', 'main']);
    const nextCut = repo.commit({ 'runtime.ts': 'new source' }, 'Fix the entry loop');
    repo.git(['update-ref', 'refs/remotes/origin/main', nextCut]);
    const prepared = prepare(repo, nextCut, '0.1.53');
    const repaired = repo.commit({
      'src/e2e/t1/explore/explore.spec.ts': 'fixed proof',
      'project/journal/explore-proof.md': 'Describe the repair',
    }, 'chore(release): v0.1.53');
    repo.git(['update-ref', 'refs/remotes/origin/release/v0.1.53', repaired]);
    expect(preparedReleaseFollows(abandoned, repaired, repo.dir)).toBe(true);

    repo.git(['switch', '--detach', prepared]);
    const changed = repo.commit({
      'src/e2e/t1/explore/explore.spec.ts': 'fixed proof',
      'runtime.ts': 'release-only code',
    }, 'chore(release): v0.1.53');
    repo.git(['update-ref', 'refs/remotes/origin/release/v0.1.53', changed]);
    expect(preparedReleaseFollows(abandoned, changed, repo.dir)).toBe(false);
  } finally { repo.cleanup(); }
});

test('a stamp carrying a test-only fix may supersede, and be superseded by, an untagged staging cut', () => {
  const repo = createTempRepo();
  try {
    const cut = repo.commit({ 'package.json': manifest('0.1.81'), 'runtime.ts': 'old source' }, 'Main source');
    repo.git(['update-ref', 'refs/remotes/origin/main', cut]);
    const abandoned = prepare(repo, cut, '0.1.82');
    // v0.1.83 shape: the stamp applies main's test-only fixture fix and its journal note.
    const testFix = prepare(repo, cut, '0.1.83', { 'test/dedicated-saves.test.ts': 'accept ECONNRESET', 'project/journal/save-disconnect.md': 'why' });
    const clean = prepare(repo, cut, '0.1.84');
    expect(preparedReleaseFollows(abandoned, testFix, repo.dir)).toBe(true);
    expect(preparedReleaseFollows(testFix, clean, repo.dir)).toBe(true);
    const mixed = prepare(repo, cut, '0.1.85', { 'test/dedicated-saves.test.ts': 'accept ECONNRESET', 'src/server/saves.ts': 'release-only code' });
    expect(preparedReleaseFollows(abandoned, mixed, repo.dir)).toBe(false);
    const lookalike = prepare(repo, cut, '0.1.86', { 'src/test/engine/realGc.ts': 'helper code under a test-like name' });
    expect(preparedReleaseFollows(abandoned, lookalike, repo.dir)).toBe(false);
  } finally { repo.cleanup(); }
});

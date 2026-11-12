import { expect, test } from 'vitest';
import { formatLockFailures, formatTagFailures, isFormatLockInput } from '../scripts/format-lock.mjs';

const COMMIT = '711d608bcf30ddaa3a3f1a0cc695ceb35c3ad84a';
const OBJECT = '0eb7926711350ec0ef13d04c478c7e7a76e9ed1c';
const PIN = 'github:project-wildshard/shardfile#v0.3.4';
const REPO = 'git@github.com:project-wildshard/shardfile.git';
const dep = (commit: string): string => `git+ssh://git@github.com/project-wildshard/shardfile.git#${commit}`;
const importer = (key: string, specifier = PIN, commit = COMMIT): string => `  ${key}:
    dependencies:
      '@wildshard/format':
        specifier: ${specifier}
        version: ${dep(commit)}(typescript@7.0.2)
      valibot:
        specifier: ^1.5.0
        version: 1.5.0(typescript@7.0.2)
`;
const lock = (version: string | undefined, commit = COMMIT, importers = [importer('.'), importer('src/game')]): string => `lockfileVersion: '9.0'

importers:

${importers.join('\n')}
packages:

  '@wildshard/format@${dep(commit)}':
    resolution: {commit: ${commit}, repo: ${REPO}, type: git}
${version === undefined ? '' : `    version: ${version}\n`}    engines: {node: '>=24.18.0'}

snapshots:

  '@wildshard/format@${dep(commit)}(typescript@7.0.2)':
    dependencies:
      valibot: 1.5.0(typescript@7.0.2)
`;
const manifest = (pin = PIN, extra = {}): string => JSON.stringify({ ...extra, dependencies: { '@wildshard/format': pin } });
const tree = (files: Record<string, string>) => (path: string): string | undefined => files[path];
const healthy = { 'pnpm-lock.yaml': lock('0.3.4'), 'package.json': manifest(), 'src/game/package.json': manifest() };

test('the real shape passes', () => {
  expect(formatLockFailures(tree(healthy))).toEqual([]);
});

test('no lock, as in a small fixture tree, is nothing to check', () => {
  expect(formatLockFailures(tree({}))).toEqual([]);
  expect(formatTagFailures(tree({}), () => { throw new Error('unread'); })).toEqual([]);
});

test('e7b2341d61: the commit moved to v0.3.4 and the row kept 0.3.3', () => {
  const failures = formatLockFailures(tree({ ...healthy, 'pnpm-lock.yaml': lock('0.3.3') }));
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain('pnpm-lock.yaml: @wildshard/format row says version 0.3.3, the pin says v0.3.4');
});

test('a row with no version is refused rather than passed', () => {
  expect(formatLockFailures(tree({ ...healthy, 'pnpm-lock.yaml': lock(undefined) })).join('\n')).toContain('row says version (none)');
});

test('a manifest the bump missed is named', () => {
  const failures = formatLockFailures(tree({ ...healthy, 'src/game/package.json': manifest('github:project-wildshard/shardfile#v0.3.3') }));
  expect(failures.join('\n')).toContain('src/game/package.json: @wildshard/format pin github:project-wildshard/shardfile#v0.3.3 but pnpm-lock.yaml has');
  expect(failures.join('\n')).toContain('pins disagree');
});

test('an importer left at the old commit is named', () => {
  const stale = lock('0.3.4', COMMIT, [importer('.'), importer('src/game', PIN, OBJECT)]);
  expect(formatLockFailures(tree({ ...healthy, 'pnpm-lock.yaml': stale }))).toEqual(
    [`pnpm-lock.yaml: importer src/game locks ${OBJECT}, its package row ${COMMIT}`]);
});

test('a pin that is not a release tag is refused', () => {
  const pin = 'github:project-wildshard/shardfile#main';
  const failures = formatLockFailures(tree({
    'pnpm-lock.yaml': lock('0.3.4', COMMIT, [importer('.', pin)]), 'package.json': manifest(pin),
  }));
  expect(failures.join('\n')).toContain("isn't a shardfile release tag");
});

test('383f470d39: an old pnpm locked the annotated tag object, not its commit', () => {
  const facts = { commit: COMMIT, name: '@wildshard/format', version: '0.3.4' };
  const read = tree({ ...healthy, 'pnpm-lock.yaml': lock('0.3.4', OBJECT, [importer('.', PIN, OBJECT), importer('src/game', PIN, OBJECT)]) });
  expect(formatLockFailures(read)).toEqual([]);
  expect(formatTagFailures(read, () => facts)).toEqual([`pnpm-lock.yaml: @wildshard/format row locks ${OBJECT}, v0.3.4 is commit ${COMMIT}`]);
});

test("the tag's own package.json decides the version", () => {
  const read = tree(healthy);
  expect(formatTagFailures(read, () => ({ commit: COMMIT, name: '@wildshard/format', version: '0.3.4' }))).toEqual([]);
  expect(formatTagFailures(read, (repo, tag) => {
    expect([repo, tag]).toEqual([REPO, 'v0.3.4']);
    return { commit: COMMIT, name: '@wildshard/format', version: '0.3.3' };
  })).toEqual(["pnpm-lock.yaml: @wildshard/format row says version 0.3.4, v0.3.4's package.json says 0.3.3"]);
});

test('an unreachable tag goes to CI', () => {
  expect(formatTagFailures(tree(healthy), () => { throw new Error('no network'); })).toEqual([]);
});

test('a workflow pnpm that packageManager would make action-setup throw on is refused', () => {
  const files = { ...healthy, 'package.json': manifest(PIN, { packageManager: 'pnpm@10.34.9' }) };
  const steps = `      - uses: pnpm/action-setup@v4
        with: {version: 10.34.9}
      - uses: actions/setup-node@v4
        with: {node-version: 24}
      - uses: pnpm/action-setup@v4
        with:
          version: 10
`;
  expect(formatLockFailures(tree({ ...files, 'a.yml': steps }), ['a.yml'])).toEqual(
    ['package.json: packageManager says 10.34.9, a.yml sets up pnpm 10']);
  expect(formatLockFailures(tree({ ...files, 'a.yml': steps.replace('version: 10\n', 'version: 10.34.9\n') }), ['a.yml'])).toEqual([]);
});

test('only the files it reads make a push run it', () => {
  for (const path of ['pnpm-lock.yaml', 'package.json', 'src/game/package.json', '.github/workflows/ci.yml']) expect(isFormatLockInput(path)).toBe(true);
  for (const path of ['src/client/game/boot.ts', 'docs/package.json.md', '.github/actions/README.md']) expect(isFormatLockInput(path)).toBe(false);
});

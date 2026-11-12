// EV9 (TS14): a docs-only push skips the suite, but a Markdown file that code actually reads still gets its readers run.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { pushSelection } from '../scripts/push-selection.mjs';
import { createTempRepo, type TempRepo } from '../src/test/helpers/git';

// Inside a git hook GIT_DIR points at the outer repo; pushSelection's own git calls must read the fixture.
const saved: Record<string, string | undefined> = {};
let repo: TempRepo;
beforeAll(() => {
  for (const key of Object.keys(process.env).filter(name => name.startsWith('GIT_'))) { saved[key] = process.env[key]; delete process.env[key]; }
  repo = createTempRepo();
  repo.commit({
    'AGENTS.md': '# rules\n',
    'CHANGELOG.md': '## v0.1.0 (2026-11-12)\n\n- First\n',
    'docs/plans/note.md': '# note\n',
    'docs/HOST-BAR.md': 'contract\n',
    'docs/TEMPLATED.md': 'contract\n',
    // Prose mentions, the way AGENTS.md is named across engine: never a read.
    'scripts/e2e-paths.mjs': '// worktree tmp/e2e, never /tmp (AGENTS.md "Disk").\nexport const x=1;\n',
    'src/client/debugOptions.ts': '/** There are no URL switches (AGENTS.md "No URL switches, ever"). See docs/plans/note.md. */\nexport const y=1;\n',
    // Real readers: a test reads docs/rules.md; a static check (pnpm check:parity) reads AGENTS.md; changelog.mjs, which
    // vite.config.ts builds into the title screen, reads CHANGELOG.md.
    'docs/rules.md': 'rule\n',
    'test/rules.test.ts': "import {readFileSync} from 'node:fs';readFileSync('docs/rules.md','utf8');\n",
    'docs/RAW.md': 'raw\n',
    'src/raw.ts': "import raw from '../docs/RAW.md?raw';export default raw;\n",
    'scripts/changelog.mjs': "export const CHANGELOG_PATH = 'CHANGELOG.md';\n",
    'test/changelog.test.ts': "import {readFileSync} from 'node:fs';readFileSync('CHANGELOG.md','utf8');\n",
    'scripts/agent-parity.mjs': "import {join} from 'node:path';export const read=root=>join(root, 'AGENTS.md');\n",
    // A runtime module reads a doc: no test edge is proven, so the push runs full.
    'src/read-doc.mjs': "import {readFileSync} from 'node:fs';readFileSync('docs/HOST-BAR.md','utf8');\n",
    'src/read-templated.mjs': "import {readFileSync} from 'node:fs';export const read=root=>readFileSync(`${root}/docs/TEMPLATED.md`,'utf8');\n",
  }, 'base');
});
afterAll(() => { repo.cleanup(); Object.assign(process.env, saved); });

const push = (files: Record<string, string>) => {
  const before = repo.git(['rev-parse', 'HEAD']), after = repo.commit(files, 'docs');
  return pushSelection(`refs/heads/main ${after} refs/heads/main ${before}`, repo.dir);
};

test('a docs line in AGENTS.md or docs/** named only in prose skips the suite', () => {
  expect(push({ 'docs/plans/note.md': '# note\n\nmore\n' })).toMatchObject({ mode: 'docs', tests: [] });
  // AGENTS.md is read only by agent-parity, which the docs lane runs as check:parity.
  expect(push({ 'AGENTS.md': '# rules\n\n- docs-only pushes skip the shards\n' })).toMatchObject({ mode: 'docs', tests: [] });
});

test('a doc read only by tests runs those tests, not the suite', () => {
  expect(push({ 'docs/rules.md': 'rule 2\n' })).toMatchObject({ mode: 'docs', tests: ['test/rules.test.ts'] });
});

test('a changelog edit runs full: the build and title proof read it through changelog.mjs', () => {
  expect(push({ 'CHANGELOG.md': '## v0.1.0 (2026-11-12)\n\n- First, better\n' })).toMatchObject({ mode: 'full', reason: expect.stringMatching(/scripts\/changelog\.mjs/u) });
});

test('a doc read by code with no proven test edge still runs full', () => {
  expect(push({ 'docs/HOST-BAR.md': 'missing authority\n' })).toMatchObject({ mode: 'full', reason: expect.stringMatching(/src\/read-doc\.mjs/u) });
  expect(push({ 'docs/TEMPLATED.md': 'changed\n' })).toMatchObject({ mode: 'full', reason: expect.stringMatching(/src\/read-templated\.mjs/u) });
  expect(push({ 'docs/RAW.md': 'changed\n' })).toMatchObject({ mode: 'full', reason: expect.stringMatching(/src\/raw\.ts/u) });
});

test('code beside a doc still selects by code', () => {
  expect(push({ 'docs/plans/note.md': '# note 3\n', 'scripts/e2e-paths.mjs': 'export const x=2;\n' }).mode).toBe('related');
});

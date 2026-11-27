// DS22's native Git fixture owns its own file budget.
// oxlint-disable-next-line import/no-nodejs-modules -- Pin mount identities are SHA-256 digests.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Seed and materialize isolated asset checkouts.
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { PINS_LEDGER } from '../src/scripts/.kit/land.mjs';
import { MANIFEST, pinsKey, writeManifest } from '../src/scripts/pins-reuse.mjs';
import { shardfileValidationRevision } from '../src/scripts/shardfile-validation-revision.mjs';
import { cleanLandFixtures, fixture, prepushLines } from './fixtures/land-git';

afterEach(cleanLandFixtures);

const STAMP = 'src/client/game/boot/bytes.generated.ts';

test.each([
  'complete', 'sparse asset', 'missing mount', 'changed mount', 'missing manifest',
  'missing ledger', 'stale manifest', 'refresh leaves stale manifest',
])('DS22 validates boot asset inputs before generation (%s)', mode => {
  const f = fixture(), wt = f.worktree('ds22-assets');
  const rebased = mode === 'stale manifest' || mode === 'refresh leaves stale manifest';
  f.commit(wt, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n', 'test: fixture lockfile');
  f.commit(wt, 'package.json', '{"scripts":{"pins":"fixture"}}\n', 'chore: add pins');
  f.commit(wt, 'test/pins/shardfiles.json', '{"shards":[]}\n', 'test: shard pins');
  const tracked = 'public/assets/tracked.bin', mount = 'public/assets/pinned.bin';
  f.commit(wt, tracked, 'tracked', 'test: tracked asset');
  const original = 'export const bytes = { previous: 20 };\n';
  const gen = `import { existsSync, writeFileSync } from 'node:fs';
const rows = ${JSON.stringify([tracked, mount])}.filter(path => existsSync(path));
writeFileSync(${JSON.stringify(STAMP)}, 'export const bytes = ' + JSON.stringify(rows) + ';\\n');`;
  const tip = f.commit(wt, 'src/scripts/gen.mjs', gen, 'test: stamp available assets');
  writeFileSync(join(f.repo, '.git/info/exclude'), `out/\n${mount}\n/${STAMP}\n`);
  // LS1: the stamp is an ignored build output, never committed.
  mkdirSync(join(wt, 'src/client/game/boot'), { recursive: true });
  writeFileSync(join(wt, STAMP), original);
  mkdirSync(join(wt, 'out'), { recursive: true });
  if (mode !== 'missing ledger') writeFileSync(join(wt, PINS_LEDGER), JSON.stringify({ published: [mount] }));
  writeManifest(wt, pinsKey(wt, shardfileValidationRevision(wt)), {}, { [mount]: createHash('sha256').update('pinned').digest('hex') });
  if (mode !== 'missing mount') writeFileSync(join(wt, mount), mode === 'changed mount' ? 'edited' : 'pinned');
  if (mode === 'missing manifest') unlinkSync(join(wt, MANIFEST));
  if (mode === 'sparse asset') {
    f.git(wt, ['update-index', '--skip-worktree', '--', tracked]);
    unlinkSync(join(wt, tracked));
  }
  expect(f.git(wt, ['status', '--porcelain'])).toBe('');
  const calls = join(f.root, 'pins.calls');
  if (rebased) {
    // The peer changes the validator key while leaving every pin revision and its ledger alone.
    f.commit(f.peer, 'src/shared/game/shardfile/admission.ts', 'export const revision = 2;\n', 'test: change pin validator');
    f.git(f.peer, ['push', '--quiet', 'origin', 'HEAD:main']);
  }
  const publish = mode === 'stale manifest' ? `writeManifest(process.cwd(),
  pinsKey(process.cwd(), shardfileValidationRevision(process.cwd())), {}, {
    [${JSON.stringify(mount)}]: createHash('sha256').update('pinned').digest('hex'),
  });` : '';
  writeFileSync(join(f.root, 'bin/pnpm'), `#!/usr/bin/env node
if (process.argv.slice(2).join(' ') === '--silent pins') {
  import('../refresh.mjs');
}
`);
  writeFileSync(join(f.root, 'refresh.mjs'), `import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pinsKey, writeManifest } from ${JSON.stringify(resolve('src/scripts/pins-reuse.mjs'))};
import { shardfileValidationRevision } from ${JSON.stringify(resolve('src/scripts/shardfile-validation-revision.mjs'))};
appendFileSync(${JSON.stringify(calls)}, 'pins\\n');
${publish}
`);

  const before = f.remoteMain();
  const planCommits = f.git(wt, ['rev-list', '--count', 'origin/main..HEAD']);
  const result = f.land(wt);
  const install = rebased || mode === 'missing ledger' || mode === 'missing manifest';
  expect(f.read(calls), result.stdout).toBe(install ? 'pins\n' : '');
  if (mode === 'complete' || mode === 'stale manifest') {
    expect(result.status, result.stdout).toBe(0);
    expect(f.read(join(wt, STAMP))).toContain(JSON.stringify([tracked, mount]));
    expect(f.git(f.remote, ['ls-tree', '--name-only', '-r', 'main'])).not.toContain(STAMP);
    expect(prepushLines(f)).toHaveLength(1);
  } else {
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('cannot regenerate boot stamps');
    expect(result.stdout).toContain(mode === 'sparse asset' ? tracked : install ? 'no current full pin publication' : mount);
    expect(f.read(join(wt, STAMP))).toBe(original);
    if (rebased) {
      expect(f.git(wt, ['merge-base', 'HEAD', before])).toBe(before);
      expect(f.git(wt, ['rev-list', '--count', before + '..HEAD'])).toBe(planCommits);
      expect(f.git(wt, ['log', '-1', '--format=%s'])).toBe('test: stamp available assets');
    } else expect(f.git(wt, ['rev-parse', 'HEAD'])).toBe(tip);
    expect(f.remoteMain()).toBe(before);
    expect(prepushLines(f)).toHaveLength(0);
  }
}, 60_000);

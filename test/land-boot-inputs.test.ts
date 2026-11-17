// DS22's native Git fixture owns its own file budget.
// oxlint-disable-next-line import/no-nodejs-modules -- Pin mount identities are SHA-256 digests.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Seed and materialize isolated asset checkouts.
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { PINS_LEDGER } from '../scripts/land.mjs';
import { MANIFEST, pinsKey, writeManifest } from '../scripts/pins-reuse.mjs';
import { shardfileValidationRevision } from '../scripts/shardfile-validation-revision.mjs';
import { cleanLandFixtures, fixture, prepushLines } from './fixtures/land-git';

afterEach(cleanLandFixtures);

const STAMP = 'src/client/game/boot/bytes.generated.ts';

test.each(['complete', 'sparse asset', 'missing mount', 'changed mount', 'missing manifest'])('DS22 validates boot asset inputs before generation (%s)', mode => {
  const f = fixture(), wt = f.worktree('ds22-assets');
  f.commit(wt, 'package.json', '{"scripts":{"pins":"fixture"}}\n', 'chore: add pins');
  f.commit(wt, 'test/pins/shardfiles.json', '{"shards":[]}\n', 'test: shard pins');
  f.commit(wt, 'test/pins/assets.json', '{"assets":[]}\n', 'test: public pins');
  const tracked = 'public/assets/tracked.bin', mount = 'public/assets/pinned.bin';
  f.commit(wt, tracked, 'tracked', 'test: tracked asset');
  const original = 'export const bytes = { previous: 20 };\n';
  f.commit(wt, STAMP, original, 'chore: useful stamp');
  const gen = `import { existsSync, writeFileSync } from 'node:fs';
const rows = ${JSON.stringify([tracked, mount])}.filter(path => existsSync(path));
writeFileSync(${JSON.stringify(STAMP)}, 'export const bytes = ' + JSON.stringify(rows) + ';\\n');`;
  const tip = f.commit(wt, 'scripts/gen.mjs', gen, 'test: stamp available assets');
  writeFileSync(join(f.repo, '.git/info/exclude'), `out/\n${mount}\n`);
  mkdirSync(join(wt, 'out'), { recursive: true });
  writeFileSync(join(wt, PINS_LEDGER), JSON.stringify({ published: [mount] }));
  writeManifest(wt, pinsKey(wt, shardfileValidationRevision(wt)), {}, { [mount]: createHash('sha256').update('pinned').digest('hex') });
  if (mode !== 'missing mount') writeFileSync(join(wt, mount), mode === 'changed mount' ? 'edited' : 'pinned');
  if (mode === 'missing manifest') unlinkSync(join(wt, MANIFEST));
  if (mode === 'sparse asset') {
    f.git(wt, ['update-index', '--skip-worktree', '--', tracked]);
    unlinkSync(join(wt, tracked));
  }
  expect(f.git(wt, ['status', '--porcelain'])).toBe('');
  const before = f.remoteMain(), result = f.land(wt);
  if (mode === 'complete') {
    expect(result.status, result.stdout).toBe(0);
    expect(f.git(f.remote, ['show', `main:${STAMP}`])).toContain(JSON.stringify([tracked, mount]));
    expect(prepushLines(f)).toHaveLength(2);
  } else {
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('cannot regenerate boot stamps');
    expect(result.stdout).toContain(mode === 'sparse asset' ? tracked : mode === 'missing manifest' ? 'no current full pin publication' : mount);
    expect(f.read(join(wt, STAMP))).toBe(original);
    expect(f.git(wt, ['rev-parse', 'HEAD'])).toBe(tip);
    expect(f.remoteMain()).toBe(before);
    expect(prepushLines(f)).toHaveLength(0);
  }
}, 60_000);

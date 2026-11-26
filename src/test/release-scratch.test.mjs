import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { keepReleaseProof, openReleaseRun } from '../scripts/release-run.mjs';
import { reapTmp } from '../scripts/tmp-reap.mjs';

const old = new Date('2026-11-19T00:00:00Z');
const now = Date.parse('2026-11-21T00:00:00Z');

test('release runs remove the clone and keep only a named proof after a failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-scratch-'));
  try {
    const scratch = openReleaseRun(root, 'qa');
    const proof = join(root, 'proof');
    expect(scratch.work.startsWith(join(root, 'tmp') + '/')).toBe(true);
    expect(() => {
      try {
        writeFileSync(join(scratch.work, 'verdict.json'), '{"hold":true}');
        mkdirSync(join(scratch.work, 'clone', '.git'), { recursive: true });
        throw new Error('Check held the release');
      } finally {
        try { keepReleaseProof(scratch.work, proof, ['verdict.json']); }
        finally { scratch.close(); }
      }
    }).toThrow('Check held the release');
    expect(existsSync(scratch.work)).toBe(false);
    expect(readFileSync(join(proof, 'verdict.json'), 'utf8')).toBe('{"hold":true}');
    expect(existsSync(join(proof, 'clone'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reap keeps open files, fresh descendants, Git metadata and a redirected path', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-reap-'));
  try {
    const tmp = join(root, 'tmp');
    mkdirSync(tmp);
    for (const name of ['old', 'open', 'fresh', 'clone', 'lane/protected', 'lane/abandoned', 'opened-late']) {
      const dir = join(tmp, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'result'), name);
      if (name === 'clone') writeFileSync(join(dir, '.git'), 'gitdir: /somewhere');
      if (name !== 'fresh') utimesSync(join(dir, 'result'), old, old);
      utimesSync(dir, old, old);
    }
    writeFileSync(join(tmp, 'keep'), 'lane/protected\n');
    symlinkSync(join(tmp, 'open'), join(tmp, 'symlink'), 'dir');
    const file = name => realpathSync(join(tmp, name, 'result'));
    const open = [file('open')];
    const notes = [];
    reapTmp(root, { dryRun: true }, line => notes.push(line), { now, openPaths: () => open });
    expect(notes).toContain('would reap tmp/old: idle 24h, no git or open files');
    expect(existsSync(join(tmp, 'old'))).toBe(true);
    let listing = 0;
    reapTmp(root, { dryRun: false }, () => {}, { now, openPaths: () => listing++ === 0 ? open : [...open, file('opened-late')] });
    expect(existsSync(join(tmp, 'old'))).toBe(false);
    expect(existsSync(join(tmp, 'lane/abandoned'))).toBe(false);
    for (const name of ['open', 'fresh', 'clone', 'lane/protected', 'symlink', 'opened-late']) {
      expect(existsSync(join(tmp, name))).toBe(true);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

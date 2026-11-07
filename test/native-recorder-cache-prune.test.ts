// oxlint-disable-next-line import/no-nodejs-modules -- Builds a throwaway cache directory to prune.
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture cache lives in the temp dir.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneRecorderCache } from '../scripts/native-recorder-cache.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A fake cache entry of `kib` KiB last used `hoursAgo` hours ago. */
function entry(root: string, job: string, n: number, hoursAgo: number, kib = 4): string {
  const key = n.toString(16).padStart(64, '0'), dir = join(root, job, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'out.bin'), new Uint8Array(kib * 1024).fill(1));
  const at = new Date(Date.now() - hoursAgo * 3_600_000);
  utimesSync(dir, at, at);
  return dir;
}
function freshCache(): string { mkdirSync('tmp', {recursive:true});const root = mkdtempSync(resolve('tmp/generation-prune-')); roots.push(root); return root; }

describe('generation cache prune (G430)', () => {
  it('drops idle entries and spares locked, protected and staging dirs', () => {
    const root = freshCache();
    const dirs = [0, 1, 2, 25, 26, 27].map((hours, n) => entry(root, 'job-a', n + 1, hours));
    mkdirSync(`${dirs[4]}.lock`);
    mkdirSync(join(root, 'job-a', 'generating-abc123'));
    const protectedDir = dirs[5];
    if (protectedDir === undefined) throw new Error('fixture');
    const dry = pruneRecorderCache(root, { protect: [protectedDir], dryRun: true });
    expect(dry.deleted.map(row => row.reason)).toEqual(['age']);
    expect(dirs.every(dir => existsSync(dir))).toBe(true);
    const report = pruneRecorderCache(root, { protect: [protectedDir] });
    expect(report.deleted).toHaveLength(1);
    expect(dirs.map(dir => existsSync(dir))).toEqual([true, true, true, false, true, true]);
    expect(existsSync(join(root, 'job-a', 'generating-abc123'))).toBe(true);
  });

  it('caps least recently used entries across jobs without a per-job reservation', () => {
    const root = freshCache();
    const a = [entry(root, 'job-a', 1, 1, 64), entry(root, 'job-a', 2, 5, 64)];
    const b = [entry(root, 'job-b', 3, 2, 64), entry(root, 'job-b', 4, 9, 64)];
    const report = pruneRecorderCache(root, { capBytes: 150 * 1024 });
    expect(report.deleted.every(row => row.reason === 'cap')).toBe(true);
    expect([...a, ...b].map(dir => existsSync(dir))).toEqual([true, false, true, false]);
    expect(report.keptEntries).toBe(2);
    const empty = pruneRecorderCache(root, { capBytes: 0 });
    expect(empty.keptEntries).toBe(0);
    expect(empty.deleted).toHaveLength(2);
  });

  it('reclaims only proven dead producer locks before applying retention', () => {
    const root = freshCache(), old = entry(root, 'old-job', 1, 30);
    mkdirSync(`${old}.lock`);
    writeFileSync(join(`${old}.lock`, 'owner.json'), JSON.stringify({ pid: 1073741823 }));
    expect(pruneRecorderCache(root, { dryRun: true }).locked).toBe(1);
    expect(existsSync(old)).toBe(true);
    expect(pruneRecorderCache(root).deleted).toHaveLength(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(`${old}.lock`)).toBe(false);
  });
});

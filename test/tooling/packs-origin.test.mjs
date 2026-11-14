// PACKS-CDN PC3 (meta docs/plans/PACKS-CDN-PLAN.md): packs come from https://packs.wildshard.io, R2 behind Cloudflare's CDN.
// The old `wildshard-packs` Worker is being retired (PC4), so no code, script or test may name its workers.dev host; only the
// journal's history does. e7-voice-staging-proof.mjs was the last one (buddy-engine, 2026-11-13).
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {expect, test} from 'vitest';

test('nothing but the journal names the retired packs Worker', () => {
  const root = resolve(import.meta.dirname, '../..');
  const worker = ['wildshard-packs', 'wildshard', 'workers', 'dev'].join('.');
  let found = '';
  try { found = execFileSync('git', ['grep', '-l', '-F', worker, '--', '.', ':!project/journal'], {cwd: root, encoding: 'utf8'}); }
  catch (error) { if (error.status !== 1) throw error; } // git grep: 1 is "no match"
  expect(found.trim().split('\n').filter(Boolean)).toEqual([]);
});

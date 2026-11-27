// Run explicitly through src/scripts/browser-lane.sh; never a commit or push hook (it needs a built checkout and real browsers).
//   WS_METER_ROOT=<built checkout> src/scripts/browser-lane.sh --max 20 node --test test/shard-wire-meter-zones.proof.mjs
// QA 11-26 row 30: the wire meter's deck flow reached only the deck's first card (Driftwood), so a sweep over every zone
// measured one. Its default flow now enters each zone by its name. This sweeps two zones, the deck's first and a later
// one (WS_METER_ZONES overrides them), on the phone tier, and fails unless both enter and read their own zone files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.env['WS_METER_ROOT'] ?? '.');
const ZONES = (process.env['WS_METER_ZONES'] ?? 'driftwood-isle,pine-hollow').split(',').filter(Boolean);

/** Whether a metered URL is one of `zone`'s own files: its shardfiles, program, spawn parts or cooked parts. */
export function zoneRead(url, zone) {
  const path = new URL(url, 'http://meter.invalid').pathname;
  return path.startsWith(`/shardfiles/${zone}/`) || path === `/programs/${zone}.json` || path.startsWith(`/assets/spawn/${zone}-`)
    || path.includes(`/shards/${zone}/`);
}

test('the zone flow reads only its own zone, never another', () => {
  assert.equal(zoneRead('/shardfiles/pine-hollow/shard.json?v=1', 'pine-hollow'), true);
  assert.equal(zoneRead('/assets/spawn/pine-hollow-grid-phone-65bd.json', 'pine-hollow'), true);
  assert.equal(zoneRead('https://cooked.wildshard.io/shards/pine-hollow/0.5.22/cooks/1.12.0/a/index.json', 'pine-hollow'), true);
  assert.equal(zoneRead('/shardfiles/driftwood-isle/shard.json', 'pine-hollow'), false);
  assert.equal(zoneRead('/assets/title/pine-hollow-portrait.jpg', 'pine-hollow'), false);
});

test(`a sweep over ${ZONES.join(' and ')} enters every zone`, { timeout: ZONES.length * 300_000 }, () => {
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  const out = mkdtempSync(join(ROOT, 'tmp/meter-zones-'));
  try {
    for (const zone of ZONES) {
      const file = join(out, `${zone}.json`);
      const run = spawnSync(process.execPath, [join(ROOT, 'src/scripts/shard-wire-meter.mjs'), '--root', ROOT, '--shard', zone, '--tier', 'phone',
        '--settle', '12000', '--timeout', '240000', '--out', file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
      assert.equal(run.status, 0, `${zone}: meter exited ${run.status}: ${run.stderr.slice(-400)}`);
      const result = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(result.stoppedOn, 'network idle', `${zone}: ${result.stoppedOn}`);
      assert.deepEqual(result.card, { zone });
      const own = result.rows.filter(row => row.c >= 200 && row.c < 300 && zoneRead(row.u, zone));
      assert.ok(own.length > 0, `${zone}: entered without reading any of its own files`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

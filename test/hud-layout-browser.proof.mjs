// Run explicitly through scripts/browser-lane.sh; never a commit or push hook (it needs a served build and real browsers).
// A14 (Jake, 2026-11-10: "the screen is chaotic"): the worst-case HUD, every element any shard can show on at once, in headless
// Chromium and WebKit at 402×874, 402×654, 874×402 and 1440×900, Developer mode off and on. It fails when a Developer surface
// (the dock's fps pill and memory card, BOOST, an alert) overlaps the quest chip, PAUSE, the minimap, the crosshair, the chat
// or a touch control, when the chat overlaps a touch control, when the point at the mic's centre is not the mic, and when the
// chat row and the mic stay up over the open BAG or fail to come back (QA row 15).
//   scripts/serve-build.sh    # prints the URL
//   WS_HUD_BASE=http://127.0.0.1:4401/ scripts/browser-lane.sh --max 60 node --test test/hud-layout-browser.proof.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const base = process.env['WS_HUD_BASE'];
if (base === undefined) throw new Error('Set WS_HUD_BASE to a served build (scripts/serve-build.sh prints one)');

test('no Developer panel covers the play HUD, and the mic can be tapped, at every size', { timeout: 3_000_000 }, () => {
  const run = spawnSync(process.execPath, ['scripts/hud-worst.mjs', `--base=${base}`, '--check', '--menu', '--label=layout', `--out=${resolve('tmp/hud-layout')}`],
    { encoding: 'utf8', timeout: 3_000_000 });
  const said = `${run.stdout}\n${run.stderr}`;
  console.info(said);
  assert.doesNotMatch(said, /^FAIL /mu);
  assert.match(said, /^PASS /mu);
  assert.equal(run.status, 0);
});

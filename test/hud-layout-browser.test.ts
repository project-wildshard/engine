// oxlint-disable-next-line import/no-nodejs-modules -- It runs the worst-case HUD script against a served build.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

// A14 (Jake, 2026-11-10: "the screen is chaotic"): the worst-case HUD, every element any shard can show on at once, in headless
// Chromium and WebKit at 402×874, 402×654, 874×402 and 1440×900, Developer mode off and on. It fails when a Developer surface
// (the dock's fps pill and memory card, BOOST, an alert) overlaps the quest chip, PAUSE, the minimap, the crosshair, the chat row
// or a touch control, when the chat row overlaps a touch control, when the point at the mic's centre is not the mic, and when
// the chat row and the mic stay up over the open BAG or fail to come back (QA row 15). It needs a built page and browsers, so it
// runs only by name, in the browser lane:
//   scripts/serve-build.sh    # prints the URL
//   WS_HUD_BASE=http://127.0.0.1:4401/ scripts/browser-lane.sh --max 60 pnpm exec vitest run test/hud-layout-browser.test.ts
const BASE = process.env['WS_HUD_BASE'];

test.skipIf(BASE === undefined)('no Developer panel covers the play HUD, and the mic can be tapped, at every size', () => {
  if (BASE === undefined) return;
  const run = spawnSync(process.execPath, ['scripts/hud-worst.mjs', `--base=${BASE}`, '--check', '--menu', '--label=layout', `--out=${resolve('tmp/hud-layout')}`],
    { encoding: 'utf8', timeout: 3_000_000 });
  const said = `${run.stdout}\n${run.stderr}`;
  console.info(said);
  expect(said).not.toMatch(/^FAIL /mu);
  expect(said).toMatch(/^PASS /mu);
  expect(run.status).toBe(0);
}, 3_100_000);

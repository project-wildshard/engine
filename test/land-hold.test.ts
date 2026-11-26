// Meta QA 11-25 row 37 (J505): opus-fe13 landed during the coordinator's 12:56 UTC engine HOLD because its wait
// matched LAND PUSHED lines, not HOLD lines. land.mjs and main-push.mjs now read the receipts and refuse to push while
// an engine land HOLD is open, except for the lander it names; a later LIFT or main-watch green ends it, and
// ALLOW_LAND_DURING_HOLD=1 named in the commit body overrides it (J381).
// oxlint-disable-next-line import/no-nodejs-modules -- main-push runs as a CLI in a real repository.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The receipts log the fixture land reads.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { holdRefusal, namedPaths, openHold, touching } from '../src/scripts/land-hold.mjs';
import { cleanLandFixtures, fixture } from './fixtures/land-git';

afterEach(cleanLandFixtures);

// The 11-25 lines as the coordinator wrote them, then the settled format.
const LEGACY_HOLD = '12:56 UTC saga-builder NOTE HOLD engine lands: main RED run 45614729199 (fp47b-shell-look, mossgate r25 pin 70c50dce5); opus-fp54b fixes forward first, others hold until its LAND PUSHED and a main-watch green';
const ALL_LANES = '11:05 UTC saga-builder NOTE HOLD all lanes: until prod rooms are back (five 200s), only opus-rel86 lands on engine; others build and commit locally';
const LEGACY_LIFT = '11:46 UTC saga-builder NOTE rooms back: rooms.wildshard.io and rooms-staging /up 200 five in a row; engine land HOLD lifted, queue resumes';
const HOLD = '13:20 UTC coordinator NOTE HOLD engine: main red run 1; lander opus-a, opus-b';
const LIFT = '13:40 UTC coordinator NOTE LIFT engine: main green again';
const GREEN = '13:35 UTC main-watch main green 75982117d9 (run 2; a..b; landed by opus-a)';
const NOISE = [
  '12:36 UTC opus-rel86 HOLD v0.1.89 train. See the board.',
  '13:06 UTC opus-fe13 NOTE LAND saga-builder: I missed the 12:56 HOLD and landed during it',
  '12:58 UTC opus-fp54b CLAIM LAND engine 1e820a688',
  '13:02 UTC opus-fp54b LAND PUSHED engine 1e820a688',
];
const log = (...lines: string[]) => `${lines.join('\n')}\n`;

describe('the engine land HOLD (QA 11-25 row 37)', () => {
  test('an open hold refuses every lane but the one it names, in both formats', () => {
    for (const [hold, lander] of [[LEGACY_HOLD, 'opus-fp54b'], [ALL_LANES, 'opus-rel86'], [HOLD, 'opus-b']] as const) {
      const receipts = log(GREEN, hold, ...NOISE);
      expect(openHold(receipts)?.line).toBe(hold);
      expect(holdRefusal({ lane: 'opus-fe13', env: {}, bodies: 'feat: row', receipts })).toMatch(/^engine land HOLD open \(only .*; lane opus-fe13 waits\)/u);
      expect(holdRefusal({ lane: lander, env: {}, bodies: 'fix: forward', receipts })).toBeNull();
    }
    expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: '', receipts: log('13:20 UTC coordinator NOTE HOLD engine: nobody lands until the red is named') })).toContain('nobody lands');
  });

  test('a later LIFT, a later main-watch green or the 11-25 "HOLD lifted" NOTE ends it; an earlier one does not', () => {
    for (const lift of [LIFT, GREEN, LEGACY_LIFT]) {
      expect(openHold(log(HOLD, ...NOISE, lift))).toBeNull();
      expect(openHold(log(lift, HOLD))).not.toBeNull();
    }
    // A release lane's HOLD holds its release, never lands; no hold at all lets everyone push.
    expect(openHold(log(...NOISE))).toBeNull();
    expect(holdRefusal({ lane: 'opus-fe13', env: {}, bodies: '', receipts: '' })).toBeNull();
  });

  // Row 98: on 11-26 05:23 UTC opus-lean91's land stopped on this note about a hold, read as a hold naming no lander.
  const NOTE_ABOUT_HOLD = '05:19 UTC opus-fr13 NOTE HOLD-engine coordinator opus-lean91: two small engine commits wait on the HOLD: QA-11-25-93 (pins mend a stale out/ product; v0.1.94\'s path) and my part of RED 45757742821 (layer-hunt-senses: the felt blow follows a telegraphed fight only). Neither touches a lean-move path. Default in 10 minutes unless told otherwise: land them with ALLOW_LAND_DURING_HOLD=1 named in the bodies, as two separate pushes';

  test('row 98: only `NOTE HOLD engine: ...; lander <lane>` holds; a NOTE whose topic names a hold does not', () => {
    for (const note of [
      NOTE_ABOUT_HOLD,
      '03:44 UTC opus-fr13 NOTE HOLD-scoped red 45746379191: fixing forward alone',
      '21:43 UTC opus-rel86 NOTE HOLD v0.1.92 staging opus-nalati: staging can\'t sign on engine 279b5ed0d',
      '05:30 UTC opus-x NOTE engine: waiting on the HOLD engine: lander opus-y to lift',
    ]) {
      expect(openHold(log(GREEN, note)), note).toBeNull();
      expect(holdRefusal({ lane: 'opus-lean91', env: {}, bodies: 'fix: red', receipts: log(GREEN, note) })).toBeNull();
    }
    // The note does not hide a real hold before it: the real one still binds, and its lander still lands.
    const held = log(GREEN, HOLD, NOTE_ABOUT_HOLD);
    expect(openHold(held)?.line).toBe(HOLD);
    expect(holdRefusal({ lane: 'opus-b', env: {}, bodies: '', receipts: held })).toBeNull();
    // A real hold that names no lander refuses everyone and quotes the receipt line.
    const bare = '05:20 UTC saga-builder NOTE HOLD engine: MAIN RED 45757742821 (the lean move), fix being named';
    const refusal = holdRefusal({ lane: 'opus-lean91', env: {}, bodies: '', receipts: log(GREEN, bare) });
    expect(refusal).toContain('nobody lands: the hold names no `; lander <lane>`');
    expect(refusal).toContain(bare);
    // A lift is `NOTE LIFT engine:`; a NOTE that lifts some other hold leaves the engine hold open.
    expect(openHold(log(HOLD, '21:11 UTC opus-rel86 NOTE LIFT v0.1.92 staging go-live HOLD (21:11) was transient'))?.line).toBe(HOLD);
    expect(openHold(log(HOLD, '05:40 UTC opus-x NOTE row 9: I land once the HOLD lifted'))?.line).toBe(HOLD);
  });

  test('ALLOW_LAND_DURING_HOLD=1 passes only when a commit body names it (J381)', () => {
    const receipts = log(HOLD);
    const named = 'fix: urgent\n\nALLOW_LAND_DURING_HOLD=1 (J381): the red is this fix';
    expect(holdRefusal({ lane: 'opus-x', env: { ALLOW_LAND_DURING_HOLD: '1' }, bodies: named, receipts })).toBeNull();
    expect(holdRefusal({ lane: 'opus-x', env: { ALLOW_LAND_DURING_HOLD: '1' }, bodies: 'fix: urgent', receipts })).toContain('no outgoing commit body names it');
    expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: named, receipts })).toContain('Override (J381)');
  });

  test('land.mjs refuses to push main under the hold and pushes once a green lifts it', () => {
    const f = fixture();
    const wt = f.worktree('held');
    const tip = f.commit(wt, 'src/held.ts', 'export const held = 1;', 'feat: held row');
    const before = f.remoteMain();
    appendFileSync(f.files.receipts, log(HOLD));
    const refused = f.land(wt, []);
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stdout).toContain('engine land HOLD open');
    expect(f.remoteMain()).toBe(before);
    expect(f.read(f.files.receipts)).toMatch(/fixture-lane land plan\/held STOP engine land HOLD open/u);
    appendFileSync(f.files.receipts, log(GREEN));
    const landed = f.land(wt, []);
    expect(landed.status, landed.stdout + landed.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
  }, 60_000);

  test('the lander the hold names lands through it', () => {
    const f = fixture();
    const wt = f.worktree('lander');
    const tip = f.commit(wt, 'src/fix.ts', 'export const fix = 1;', 'fix: forward');
    appendFileSync(f.files.receipts, log('13:20 UTC coordinator NOTE HOLD engine: main red run 1; lander fixture-lane'));
    const result = f.land(wt, []);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
  }, 60_000);

  test('main-push.mjs refuses before committing under the hold, so no other push carries the commit along', () => {
    mkdirSync(resolve('tmp/vitest'), { recursive: true });
    const root = mkdtempSync(join(resolve('tmp/vitest'), 'land-hold-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main'); writeFileSync(join(root, 'a.txt'), 'a\n'); git('add', 'a.txt'); git('commit', '-qm', 'base');
      const before = git('rev-parse', 'HEAD');
      const receipts = join(root, 'receipts.log');
      writeFileSync(receipts, log(HOLD));
      writeFileSync(join(root, 'a.txt'), 'b\n');
      const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), CI: '', WS_LANE_RECEIPTS: receipts, WS_LANE_NAME: 'opus-x', WS_MAIN_PUSH_PREGATE: '0' };
      const result = spawnSync(process.execPath, [resolve('src/scripts/.kit/main-push.mjs'), '-m', 'fix: a', 'a.txt'], { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stderr).toContain('main-push STOP engine land HOLD open');
      expect(git('rev-parse', 'HEAD')).toBe(before);
      expect(readFileSync(receipts, 'utf8')).toMatch(/opus-x main-push STOP engine land HOLD open/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // Row 67 (J505, no freezes): the 11-25 18:57 hold named the red's files; lands elsewhere waited an hour for nothing.
  const PATH_HOLD = '18:57 UTC saga-builder NOTE HOLD engine: main red run 45676829545 tests (7) src/test/push-known-red.test.mjs expects a gate line; lander opus-guard';
  const RED_NOTE = '18:57 UTC main-watch NOTE RED opus-guard: run 45676829545 a..b tests (7) (src/test/push-known-red.test.mjs, src/scripts/land/gate.mjs)';

  test('row 67: a hold binds only pushes touching the paths it and the span\'s red lines name', () => {
    const receipts = log(GREEN, RED_NOTE, PATH_HOLD);
    expect(openHold(receipts)?.paths).toEqual(['src/test/push-known-red.test.mjs', 'src/scripts/land/gate.mjs']);
    const said: string[] = [];
    expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: 'feat: row', receipts, files: ['src/zone/a.ts', 'test/zone.test.ts'], say: line => { said.push(line); } })).toBeNull();
    expect(said).toEqual(['HOLD open but this push is disjoint from src/test/push-known-red.test.mjs, src/scripts/land/gate.mjs; landing (J505)']);
    // The same file, a sibling of a named source file, or a directory pathspec above a named path is held.
    for (const files of [['src/test/push-known-red.test.mjs'], ['src/scripts/land/other.mjs'], ['src/scripts/'], ['src/a.ts', 'src/scripts/land/gate.mjs']])
      expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: '', receipts, files }), files.join(',')).toMatch(/^engine land HOLD open/u);
    // A sibling of a named test is not held: tests sit together in one folder.
    expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: '', receipts, files: ['src/test/other.test.mjs'] })).toBeNull();
    // Unknown files, a hold naming no path, an all-lanes hold, and red lines from before a green all bind as before.
    expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: '', receipts })).toMatch(/^engine land HOLD open/u);
    for (const held of [log(HOLD), log(RED_NOTE, ALL_LANES), log(RED_NOTE, GREEN, HOLD)])
      expect(holdRefusal({ lane: 'opus-x', env: {}, bodies: '', receipts: held, files: ['src/zone/a.ts'] })).toMatch(/^engine land HOLD open/u);
  });

  test('row 67: paths are repo paths, never URLs, line numbers or bare names', () => {
    expect(namedPaths('see https://github.com/project-wildshard/engine/actions/runs/1 and src/scripts/trailer/capture.mjs:31, ./test/a/b.test.ts; cook.ts')).toEqual(['src/scripts/trailer/capture.mjs', 'test/a/b.test.ts']);
    expect(touching(['src/scripts/trailer/party.mjs', 'src/scripts/other.mjs'], ['src/scripts/trailer/capture.mjs'])).toEqual(['src/scripts/trailer/party.mjs']);
  });

  test('row 67: land.mjs lands a push disjoint from the red\'s files through the hold and says so', () => {
    const f = fixture();
    const wt = f.worktree('disjoint');
    const tip = f.commit(wt, 'src/held.ts', 'export const held = 1;', 'feat: disjoint row');
    appendFileSync(f.files.receipts, log(PATH_HOLD));
    const landed = f.land(wt, []);
    expect(landed.status, landed.stdout + landed.stderr).toBe(0);
    expect(f.remoteMain()).toBe(tip);
    expect(f.read(f.files.receipts)).toContain('HOLD open but this push is disjoint from src/test/push-known-red.test.mjs; landing (J505)');
  }, 60_000);
});

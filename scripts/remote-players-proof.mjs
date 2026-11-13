#!/usr/bin/env node
// REMOTE-PLAYERS RP13 (Jake, 2026-11-12 17:43: "other people in multiplayer need character model ... walking animation ... a
// sword ... the attack animation ... the full hoverboard ... just everything"): every row's own check, run one after another in
// ONE Driftwood room on the rig of `online-rig.mjs`, Jake's and Jimmy's phones (402×874, headless, on the GPU). Each check is the
// row's exported `prove…` from its `remote-*-proof.mjs`; between checks both walk back to where they spawned and face the way
// they spawned, as each check expects. RP3 starts with Jake alone and ends with Jimmy's page closed, so it runs first and Jimmy
// comes back for the rest; RP2 brings Ana in for its check and sends her off. The checks that need no creature run next, before
// any creature is struck: a struck bear hunts whoever struck it for the rest of the run, and a bite or its knock spoils a check
// that reads a still or a walking body. Then the three that fight one, RP11 first on a fresh bear, then RP1 and RP10. RP6 (the wire
// fields) is its own test, `test/net-remote-actions.test.ts`, run here; RP7's tap and heavy and RP9's air read those fields in
// the room. The captures land on one labelled board (`--board=`, default
// ~/.cache/wildshard/plan-artifacts/remote-players/board.png). PASS only if every check passes.
//   WS_RIG_PORTS=18890 scripts/browser-lane.sh --max 45 node scripts/remote-players-proof.mjs <app dist stamped with http://127.0.0.1:18893/release.json> <work dir> <key.json> [--board=<png>]
// (`--from-log=<its log>` redraws the board of a finished run from that log and the work dir's shots.)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { proveAir } from './remote-air-proof.mjs';
import { proveBar } from './remote-bar-proof.mjs';
import { proveBoard } from './remote-board-proof.mjs';
import { proveBody } from './remote-body-proof.mjs';
import { proveDeath } from './remote-death-proof.mjs';
import { proveGait } from './remote-gait-proof.mjs';
import { proveHeld } from './remote-held-proof.mjs';
import { proveHurt } from './remote-hurt-proof.mjs';
import { proveMap } from './remote-map-proof.mjs';
import { proveName } from './remote-name-proof.mjs';
import { proveStrike } from './remote-strike-proof.mjs';
import { openRoom, recorder } from './remote-room.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-players-proof.mjs <app dist> <work dir> <key.json> [--board=<png>]');
const boardFile = process.argv.find(value => value.startsWith('--board='))?.slice('--board='.length) ?? join(homedir(), '.cache/wildshard/plan-artifacts/remote-players/board.png');
const ROOT = join(import.meta.dirname, '..'), shotsRoot = join(work, 'shots-remote-players');
const { steps, note } = recorder();

/** @typedef {import('./remote-room.mjs').Entered} Entered */
/** @typedef {{ row: string, title: string, ok: boolean, shots: string[], why: string }} Result */
const results = /** @type {Result[]} */ ([]);

/** @typedef {{ x: number, y: number, z: number, yaw: number }} Spot */
/** @param {import('playwright').Page} page @returns {Promise<Spot>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** The spawn stands on the pier's deck, which runs +z to the beach: a page off the deck (below it, or out to one side) goes
 *  round by the sand at the deck's landward end first, or it walks under the deck. */
const BEACH = 42;
/** Back to where the page spawned, on the deck, off any board, facing the way it spawned; whether it got there.
 *  @param {Entered} entered @param {Spot} spot */
const home = async (entered, spot) => {
  const { page } = entered;
  await page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; if (player.hover === true) player.setHover(false); player.touchJump = false; });
  const from = await where(page);
  if (from.y < spot.y - 0.5 || Math.abs(from.x - spot.x) > 1.5) await walkTo(page, { x: spot.x, z: spot.z + BEACH });
  await walkTo(page, spot);
  await page.evaluate(yaw => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = 0; player.touchMove.x = 0; player.touchSprint = false; player.yaw = yaw; player.pitch = 0; }, spot.yaw);
  const at = await where(page);
  return Math.hypot(at.x - spot.x, at.z - spot.z) < 0.6 && Math.abs(at.y - spot.y) < 0.5;
};
/** The live creatures within 40 m of a page's player: kind, metres, state. @param {import('playwright').Page} page */
const near = page => page.evaluate(() => {
  const { world } = /** @type {any} */ (window).__wildshard, { player } = world;
  return /** @type {any[]} */ (world.animals?.animals ?? []).filter(body => body.alive && body.rowDriven && !body.hidden)
    .map(body => ({ kind: String(body.kind), m: Math.round(Math.hypot(body.position.x - player.position.x, body.position.z - player.position.z)), state: String(body.state) }))
    .filter(body => body.m < 40).sort((a, b) => a.m - b.m);
});
/** Walk a page to a spot on the ground. @param {import('playwright').Page} page @param {{ x: number, z: number }} spot */
async function walkTo(page, spot) {
  let last = await where(page), stuck = 0;
  for (let i = 0; i < 900; i++) {
    const at = await where(page), gap = Math.hypot(at.x - spot.x, at.z - spot.z);
    if (gap < 0.4) break;
    await page.evaluate(([x, z, away]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = 0; player.touchMove.x = 0; player.touchMove.y = away < 1.5 ? 0.4 : 1; player.touchSprint = away > 8; }, [spot.x, spot.z, gap]);
    stuck = Math.hypot(at.x - last.x, at.z - last.z) < 0.03 ? stuck + 1 : 0; last = at;
    if (stuck === 8) { await page.keyboard.press('Space'); stuck = 0; }
    await page.waitForTimeout(80);
  }
}

/**
 * One row's check in the room: its own shots folder, its steps, and whether all of them held. A check that throws is a fail.
 * @param {string} row @param {string} title @param {(shots: string) => Promise<string[]>} check
 */
const run = async (row, title, check) => {
  const shots = join(shotsRoot, row.toLowerCase()), from = steps.length;
  mkdirSync(shots, { recursive: true });
  console.log(`\n== ${row}: ${title}`);
  let taken = /** @type {string[]} */ ([]), why = '';
  try { taken = await check(shots); } catch (error) { why = String(error).slice(0, 300); note(`${row} stopped`, false, why); }
  const mine = steps.slice(from), ok = why === '' && mine.length > 0 && mine.every(step => step.ok);
  if (!ok && why === '') why = mine.find(step => !step.ok)?.step ?? 'no step';
  results.push({ row, title, ok, why, shots: taken.map(shot => join(shots, shot)).filter(file => existsSync(file)) });
  console.log(`== ${row} ${ok ? 'PASS' : 'FAIL'}${ok ? '' : `: ${why}`}`);
};

/** The board: a labelled grid of each row's chosen captures (or a text card for a row with none), green for a pass. */
async function board() {
  const PICK = /** @type {Record<string, string[]>} */ ({
    RP1: ['2-jake-sees-jimmys-hit'], RP2: ['1-jake-sees-jimmy-4m', '2-jimmy-side-on'], RP3: ['1-jimmy-north-east.png'], RP4: ['2-walk', '3-run'],
    RP5: ['rp5-'], RP7: ['1-tap', '2-heavy'], RP8: ['2-carving-toward', '3-carving-away'], RP9: ['3-sand-jump', '4-sand-fall'],
    RP10: ['1-jake-sees', '2-jake-sees-jimmy-hurt'], RP11: ['1-fallen', '3-rise'], RP12: ['3m.png', '15m.png', '40m.png'],
  });
  const W = 300, H = 652, BAND = 64, COLS = 6, GAP = 8;
  /** @param {string} text */
  const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const tiles = /** @type {{ input: Buffer, label: string, ok: boolean }[]} */ ([]);
  for (const result of results) {
    const picks = PICK[result.row] ?? [], files = result.shots.filter(file => picks.some(pick => (file.split('/').at(-1)?.startsWith(pick) ?? false) || file.endsWith(pick))).slice(0, 3);
    if (files.length === 0) {
      const words = [...result.title.split(' '), '\n', ...(result.ok ? ['its', 'own', 'test,', 'run', 'in', 'this', 'proof:', 'passed'] : ['FAILED:', ...result.why.split(' ')])], lines = [''];
      for (const word of words) { if (word === '\n') lines.push('', ''); else if (`${lines.at(-1) ?? ''} ${word}`.length > 24) lines.push(word); else lines[lines.length - 1] = `${lines.at(-1) ?? ''} ${word}`.trim(); }
      const card = `<svg width="${String(W)}" height="${String(H)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#1d2228"/>${lines.slice(0, 14).map((line, at) => `<text x="16" y="${String(200 + at * 30)}" font-family="Helvetica" font-size="20" fill="#e8eef4">${esc(line)}</text>`).join('')}</svg>`;
      tiles.push({ input: await sharp(Buffer.from(card)).png().toBuffer(), label: `${result.row} ${result.title}`, ok: result.ok });
    }
    for (const file of files) tiles.push({ input: await sharp(file).resize(W, H, { fit: 'cover', position: 'top' }).png().toBuffer(), label: `${result.row} ${result.title}`, ok: result.ok });
  }
  const rows = Math.ceil(tiles.length / COLS), width = COLS * (W + GAP) + GAP, height = 90 + rows * (H + BAND + GAP) + GAP;
  const passed = results.filter(result => result.ok).length;
  const head = `<svg width="${String(width)}" height="90" xmlns="http://www.w3.org/2000/svg"><text x="${String(GAP)}" y="40" font-family="Helvetica" font-weight="bold" font-size="30" fill="#ffffff">Remote players: every row in one Driftwood room, seen from Jake's phone</text><text x="${String(GAP)}" y="74" font-family="Helvetica" font-size="22" fill="${passed === results.length ? '#7ee08a' : '#ff8a80'}">${String(passed)} of ${String(results.length)} checks pass · ${esc(new Date().toLocaleString('sv-SE', { timeZone: 'America/Cancun' }).slice(0, 16))} Cancún · REMOTE-PLAYERS RP13</text></svg>`;
  const layers = /** @type {{ input: Buffer, left: number, top: number }[]} */ ([{ input: Buffer.from(head), left: 0, top: 0 }]);
  for (const [at, tile] of tiles.entries()) {
    const left = GAP + (at % COLS) * (W + GAP), top = 90 + Math.floor(at / COLS) * (H + BAND + GAP);
    const band = `<svg width="${String(W)}" height="${String(BAND)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${tile.ok ? '#1f4d2b' : '#5c1f1f'}"/><text x="10" y="27" font-family="Helvetica" font-weight="bold" font-size="20" fill="#ffffff">${esc(tile.label.split(' ')[0] ?? '')} ${tile.ok ? 'PASS' : 'FAIL'}</text><text x="10" y="52" font-family="Helvetica" font-size="17" fill="#e8eef4">${esc(tile.label.split(' ').slice(1).join(' ').slice(0, 30))}</text></svg>`;
    layers.push({ input: Buffer.from(band), left, top }, { input: tile.input, left, top: top + BAND });
  }
  mkdirSync(dirname(boardFile), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#0e1114' } }).composite(layers).png().toFile(boardFile);
  console.log(`board: ${boardFile} (${String(tiles.length)} tiles)`);
}

/** A row's own test file, run with Vitest: noted pass or fail with its count. @param {string} file @param {string} step */
const vitest = (file, step) => {
  const test = spawnSync('pnpm', ['exec', 'vitest', 'run', file], { cwd: ROOT, encoding: 'utf8' });
  note(step, test.status === 0, `${test.stdout}${test.stderr}`.split('\n').filter(line => /Tests\s+\d/u.test(line)).join(' ').trim());
};

// `--from-log=<this proof's log>` only redraws the board of a finished run, from its log and its shots.
const fromLog = process.argv.find(value => value.startsWith('--from-log='))?.slice('--from-log='.length) ?? '';
if (fromLog !== '') {
  const titles = new Map();
  for (const line of readFileSync(fromLog, 'utf8').split('\n')) {
    const start = /^== (RP\d+): (.+)$/u.exec(line), end = /^== (RP\d+) (PASS|FAIL)(?:: (.*))?$/u.exec(line);
    if (start !== null) titles.set(start[1], start[2]);
    if (end === null) continue;
    const row = end[1] ?? '', shots = join(shotsRoot, row.toLowerCase());
    results.push({ row, title: titles.get(row) ?? row, ok: end[2] === 'PASS', why: end[3] ?? '', shots: existsSync(shots) ? readdirSync(shots).sort().map(file => join(shots, file)) : [] });
  }
  results.sort((a, b) => Number(a.row.slice(2)) - Number(b.row.slice(2)));
  await board();
  process.exit(results.length > 0 && results.every(result => result.ok) ? 0 : 1);
}

// RP6 first: no browser, its own dedicated room in the test.
await run('RP6', 'wire fields: swing, heavy, air', () => {
  vitest('test/net-remote-actions.test.ts', 'RP6: test/net-remote-actions.test.ts passes (B taps, heavies, jumps, is stunned; A reads swing, heavy, air)');
  return Promise.resolve([]);
});

process.env.HOLD_MS ??= '1000'; // RP3: a closed page's body goes in a second (the rig's server inherits it)
const room = await openRoom({ dist, work, keyFile });
let code = 1;
try {
  let jake = await room.enter('Jake');
  const spawn = await where(jake.page);
  await run('RP3', 'minimap marker', shots => proveMap({ jake, jimmy: null, note, shots, enter: room.enter }));
  let jimmy = await room.enter('Jimmy');
  /** Home, or (should the walk fail) a fresh page under the same name, which spawns there. @param {Entered} entered @param {string} name */
  const reset = async (entered, name) => {
    if (await home(entered, spawn)) return entered;
    console.log(`${name} could not walk back to the spawn: a fresh page for ${name}`);
    await entered.context.close();
    const fresh = await room.enter(name);
    await home(fresh, spawn);
    return fresh;
  };
  /** @param {string} row @param {string} title @param {(room: import('./remote-room.mjs').Room) => Promise<string[]>} prove */
  const check = async (row, title, prove) => {
    [jake, jimmy] = await Promise.all([reset(jake, 'Jake'), reset(jimmy, 'Jimmy')]);
    await jake.page.waitForTimeout(1000);
    console.log(`creatures within 40 m of Jimmy before ${row}: ${JSON.stringify(await near(jimmy.page))}`);
    const inRoom = { jake, jimmy, note, enter: room.enter };
    await run(row, title, shots => prove({ ...inRoom, shots }));
  };
  await check('RP2', 'castaway body', proveBody);
  // A fresh Jimmy doesn't own Driftwood's iron sword (the wreck's quest gives it), so the room's switch is skipped as the row's
  // proof skips it; HS8's own test earns the sword and swaps it, and back.
  await check('RP5', 'held sword, and a switch', async inRoom => {
    const taken = await proveHeld(inRoom);
    vitest('test/net-remote-held-swap.test.ts', 'RP5/HS8: test/net-remote-held-swap.test.ts passes (B earns the iron sword, switches, A sees it, and back)');
    return taken;
  });
  await check('RP7', 'tap and heavy attacks', proveStrike);
  await check('RP9', 'jump, fall and land', proveAir);
  await check('RP4', 'walk and run', proveGait);
  await check('RP8', 'hoverboard bank', proveBoard);
  await check('RP12', 'Name at 3, 15, 40 m', proveName);
  // The creature checks last. RP11 first, on a bear nobody has struck: a bear RP1 and RP10 wore down never bit Jimmy to death.
  await check('RP11', 'death and respawn', proveDeath);
  await check('RP1', 'bear bar for everyone', proveBar);
  await check('RP10', 'hit number, hurt flash', proveHurt);
  const faults = room.faults();
  note('no page error in the whole run', faults.length === 0, faults.slice(0, 6));
  code = steps.every(step => step.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  await room.close();
}
results.sort((a, b) => Number(a.row.slice(2)) - Number(b.row.slice(2)));
await board();
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.row} ${result.title}${result.ok ? '' : `: ${result.why}`}`);
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);

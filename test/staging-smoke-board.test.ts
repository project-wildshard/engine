// Meta STAGING-SMOKE SM7: a board only on change. A clean fixture verdict prints the receipt line and writes no board; one P2
// writes <out>/board.html with that finding first.
// oxlint-disable-next-line import/no-nodejs-modules -- It reads the board it wrote.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { isClean, receiptLine, writeBoard } from '../src/scripts/staging-smoke/board.mjs';
import { runSmoke } from '../src/scripts/staging-smoke.mjs';

const OUT = resolve('tmp/staging-smoke-board-test');
afterAll(() => { rmSync(OUT, { recursive: true, force: true }); });

const scenario = (id: string, title: string) => ({ id, title, status: 'ran', seconds: 30, timeToPlay: 9000, frames: {} });
const clean = {
  release: 'v0.1.35', build: 'c'.repeat(40), url: 'https://staging.wildshard.io', seconds: 312.4, hold: false, last: 'v0.1.34',
  scenarios: [scenario('K1', 'old cache (Chromium)'), scenario('K2', 'old cache (WebKit)'), scenario('K3', 'Driftwood chain (WebKit)'), scenario('K4', 'deep link (WebKit)'), scenario('K5', 'Infinite Wildshard (WebKit)')],
  findings: [], vision: ['K1', 'K2', 'K3', 'K4', 'K5'].map(id => ({ scenario: id, verdict: 'same', line: 'no visible change' })),
};

test('a clean run is one receipt line and no board', () => {
  expect(isClean(clean)).toBe(true);
  expect(receiptLine(clean, new Date('2026-11-17T12:34:00.000Z'))).toBe('12:34 UTC staging-smoke DONE v0.1.35 cccccccc 5/5 clean, vision same, 312 s');
  expect(isClean({ ...clean, vision: [{ scenario: 'K3', verdict: 'changed', line: 'new title', bullet: 'New main menu.' }] })).toBe(false);
});

test('one P2 writes board.html with that finding first', () => {
  const out = join(OUT, 'p2');
  mkdirSync(out, { recursive: true });
  const verdict = { ...clean, findings: [{ scenario: 'K4', key: 'strip', severity: 'P2' as const, text: 'a RECONNECTING strip 12 s into play (SB31)', source: 'check' as const }], bugbash: { added: ['SB41'], seenAgain: [], rowOf: { 'K4/strip': 'SB41' } } };
  expect(isClean(verdict)).toBe(false);
  const file = writeBoard(verdict, { out });
  expect(file).toBe(join(out, 'board.html'));
  const html = readFileSync(file, 'utf8');
  expect(html.startsWith('<title>Staging Smoke v0.1.35</title>')).toBe(true);
  const first = html.indexOf('<article class="finding');
  expect(html.slice(first, first + 600)).toContain('a RECONNECTING strip 12 s into play (SB31)');
  expect(html).toContain('SB41');
  expect(html).toContain('<b>Clean:</b> K1 old cache (Chromium)');
  expect(html).toContain('PROD MAY GO');
});

test('the runner writes a board only when something changed', async () => {
  // a run with no scenario (--only none) is clean: a receipt line, no board
  const lines: string[] = [];
  const out = join(OUT, 'run');
  await runSmoke({ url: 'http://127.0.0.1:9', release: 'v0.0.0-empty', out, only: [], log: line => { lines.push(line); } });
  expect(lines.some(line => / UTC staging-smoke DONE v0\.0\.0-empty {2}0\/0 clean, vision none, \d+ s$/u.test(line))).toBe(true);
  expect(existsSync(join(out, 'board.html'))).toBe(false);
});

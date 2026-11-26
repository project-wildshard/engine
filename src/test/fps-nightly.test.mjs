import { expect, test } from 'vitest';
import { checkedReceipt, reviewNight, summary } from '../scripts/fps/nightly.mjs';
import { fpsVerdict } from '../scripts/fps/verdict.mjs';

const build = 'exact-engine-build';
const route = [{ name: 'Dock', seconds: 1 }];
const specs = [
  ['phone-low', 60, 1], ['phone-lpm-low', 30, 1], ['phone-high', 30, 1],
  ['desktop-medium', 120, 2], ['desktop-native', 120, 4],
];

function makeTable({ extraUpdateMs = 0, gpu = 'ANGLE Metal Renderer: Apple M4', calibrated = true } = {}) {
  const runs = specs.flatMap(([name, floor, variants]) => Array.from({ length: variants * 3 }, (_, idx) => {
    const rep = idx % 3 + 1;
    const ms = 1000 / floor + (name === 'phone-low' ? extraUpdateMs : 0);
    const samples = [{ seconds: ms * floor / 1000, frames: floor, frameMs: Array(floor).fill(ms) }];
    const capture = { ...fpsVerdict([{ name: 'Dock', samples }], route, floor), version: { build }, witness: { build, gpu } };
    return { name, rep, profile: { floor, calibrated, width: 402 + Math.floor(idx / 3), cpu: 1.5 }, cold: capture,
      warm: rep === 3 ? capture : null };
  }));
  return { zone: 'driftwood-isle', scope: 'route', host: 'Mac16,10', runs };
}

test('a 10 ms per-frame update regression misses phone-low first', () => {
  const clean = reviewNight(makeTable(), build);
  expect(clean.qualifies).toBe(true);
  const slow = reviewNight(makeTable({ extraUpdateMs: 10 }), build, clean);
  expect(slow.qualifies).toBe(false);
  expect(slow.rows.find(row => row.misses.length)).toMatchObject({ name: 'phone-low', misses: ['floor', 'p95 +60.0%'] });
});

test('a different build, software renderer, uncalibrated or incomplete matrix cannot qualify', () => {
  expect(reviewNight(makeTable(), 'different-build').exact).toBe(false);
  expect(reviewNight(makeTable({ gpu: 'ANGLE Metal SwiftShader' }), build).hardware).toBe(false);
  expect(reviewNight(makeTable({ calibrated: false }), build).qualifies).toBe(false);
  const broken = makeTable();
  broken.runs.pop();
  expect(reviewNight(broken, build).qualifies).toBe(false);
});

test('p95 is compared only to the same GPU and calibration', () => {
  const clean = reviewNight(makeTable({ gpu: 'ANGLE Metal Renderer: Apple M3' }), build);
  const candidate = reviewNight(makeTable({ extraUpdateMs: 10 }), build, clean);
  expect(candidate.rows[0].misses).toEqual(['floor']);
});

test('repeating a cold sample or omitting a variant cannot qualify the nightly', () => {
  const duplicate = makeTable();
  duplicate.runs[0] = duplicate.runs[1];
  const sameVariant = makeTable();
  const desktop = sameVariant.runs.filter(run => run.name === 'desktop-medium');
  for (const run of desktop.slice(3)) run.profile.width = desktop[0].profile.width;
  for (const table of [duplicate, sameVariant]) {
    const report = reviewNight(table, build);
    expect(report.qualifies).toBe(false);
    expect(report.rows.flatMap(row => row.misses)).toEqual(['incomplete or uncalibrated']);
  }
});

test('a quick development table cannot qualify even when its synthetic frames pass every floor', () => {
  const table = {...makeTable(),scope:'quick',mode:'quick'};
  expect(reviewNight(table,build)).toMatchObject({exact:false,qualifies:false});
});


test('an explicitly reduced qualification table never qualifies nightly', () => {
  expect(reviewNight({...makeTable(),scope:'subset',mode:'qualify'},build)).toMatchObject({exact:false,qualifies:false});
});

test('the hosted job prints only a well-formed night from the mini, with the last green build', () => {
  const night = { ...reviewNight(makeTable(), 'abcdef1234'), since: '0123456789' };
  const round = checkedReceipt(JSON.parse(JSON.stringify(night)));
  expect(summary(round, false)).toContain('since the last green night 0123456789');
  expect(summary(round, false)).toContain('| phone-low | 60 |');
  expect(() => checkedReceipt({ ...night, build: '$(rm -rf /)' })).toThrow('not a DF7 night');
  expect(() => checkedReceipt({ ...night, rows: [{ name: 'phone-low', fps: '60' }] })).toThrow('not a DF7 night');
});

test('DF15: a profile left out of the gate still prints, marked report only, and cannot stop the night qualifying', () => {
  const four = ['phone-low', 'phone-high', 'desktop-medium', 'desktop-native'];
  const lpmMissing = makeTable();
  lpmMissing.runs = lpmMissing.runs.filter(run => run.name !== 'phone-lpm-low');
  expect(reviewNight(lpmMissing, build).qualifies).toBe(false);
  expect(reviewNight(lpmMissing, build, null, four)).toMatchObject({ qualifies: true, missing: [] });
  const uncalibratedLpm = makeTable();
  for (const run of uncalibratedLpm.runs) if (run.name === 'phone-lpm-low') run.profile.calibrated = false;
  const night = reviewNight(uncalibratedLpm, build, null, four);
  expect(night.qualifies).toBe(true);
  expect(night.rows.find(row => row.name === 'phone-lpm-low')).toMatchObject({ gated: false, misses: ['incomplete or uncalibrated'] });
  expect(summary(night, true)).toContain('incomplete or uncalibrated (report only)');
  const slow = reviewNight(makeTable({ extraUpdateMs: 10 }), build, night, four);
  expect(slow.qualifies).toBe(false);
  expect(slow.rows.find(row => row.name === 'phone-low')?.misses).toContain('p95 +60.0%');
});

test('DF15: a night from before the gated set reads as every profile gated', () => {
  const old = reviewNight(makeTable(), 'abcdef1234');
  const stripped = { ...old, rows: old.rows.map(({ gated: _gated, ...row }) => row) };
  expect(checkedReceipt(JSON.parse(JSON.stringify(stripped))).rows.every(row => row.gated)).toBe(true);
});

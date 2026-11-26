// ENGINE-MEMORY EM12: the harness in CI, report-only (J400: in ci-reports, never holding ci's verdict). (a) Template's
// ledger [L] at control and at its peak on ubuntu, (b) native WebKit footprints [K] for Template and Nine on macOS.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ledgerPeak, ledgerPeakLines, summaryMarkdown } from '../src/scripts/memory/measure.mjs';

const MB = 1e6;
const reports = readFileSync(new URL('../.github/workflows/ci-reports.yml', import.meta.url), 'utf8');
const jobs = new Map([...reports.slice(reports.indexOf('\njobs:')).matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gmu)].map(([, name, body]) => [name, body ?? '']));

test('the ledger peak and the ledger at control, from a boot\'s checkpoints', () => {
  const peak = ledgerPeak([{ step: 'page', ledger: null }, { step: 'props', ledger: { ram: { 'array-buffer': 80 * MB }, gpu: { texture: 30 * MB } } },
    { step: 'control', ledger: { ram: { 'array-buffer': 40 * MB }, workers: { 'w/wasm': 5 * MB }, gpu: { texture: 30 * MB } } }]);
  expect(peak).toMatchObject({ peak: { step: 'props', ram: 80 * MB, gpu: 30 * MB }, control: { step: 'control', ram: 45 * MB, gpu: 30 * MB } });
  expect(ledgerPeakLines('brasscap-mesa', peak!)).toEqual(['LEDGER brasscap-mesa: control ram    45 + gpu    30 =    75 MB [L] at control; peak ram    80 + gpu    30 =   110 MB [L] at props']);
  expect(ledgerPeak([{ step: 'page', ledger: null }])).toBeNull();
});

test('the step summary carries each run, the spread and the phone chain', () => {
  const run = { build: 'abcdef123', refused: null, settled: { webcontent: 530 * MB, gpu: 355 * MB }, counters: { ram: { a: 47 * MB }, gpu: { t: 36 * MB } },
    checkpoints: [{ step: 'props', peak: { webcontent: 680 * MB, gpu: 400 * MB } }, { step: 'control', peak: { webcontent: 600 * MB, gpu: 360 * MB } }] };
  const stats = { n: 3, median: 530 * MB, min: 520 * MB, max: 540 * MB, spreadPct: 3.8 };
  const text = summaryMarkdown('brasscap-mesa', [run], { settledWebContent: stats, settledGpu: { ...stats, median: 355 * MB, spreadPct: 0.5 } }, null);
  expect(text).toContain('### Memory: brasscap-mesa');
  expect(text).toMatch(/\| 1 \| abcdef12 \| 530 \| 355 \| 680 \| 47 \/ 36 \| \d\.\d\d GB \(\d\.\d\d-\d\.\d\d\) \| \d\.\d\d GB/u);
  expect(text).toContain('Settled WebContent median 530 MB, spread 3.8% (n 3)');
});

test('(b) the macOS job reads Template and Nine in native WebKit, report-only', () => {
  const street = jobs.get('nine-street') ?? '';
  expect(street).toContain('runs-on: macos-15');
  expect(street).toContain('bash src/scripts/ci-playwright-install.sh webkit');
  expect(street).toContain('node src/scripts/nine-ring1.mjs measure');
  expect(street).toContain('continue-on-error: true');
  const ring = readFileSync(new URL('../src/scripts/nine-ring1.mjs', import.meta.url), 'utf8');
  expect(ring).toContain("for (const chunk of ['brasscap-mesa','nine-dragon-stack'])");
  expect(ring).toContain("'--runs=3'");
});

test('(a) the ubuntu job reads Template\'s ledger from the exact client ci built, outside ci', () => {
  const ledger = jobs.get('memory-ledger') ?? '';
  expect(ledger).toContain('runs-on: ubuntu-latest');
  expect(ledger).toContain('continue-on-error: true');
  expect(ledger).toContain('name: nine-ring1-client');
  expect(ledger).toContain('node src/scripts/nine-ring1.mjs ledger');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  expect(ci).not.toContain('nine-ring1.mjs ledger');
});

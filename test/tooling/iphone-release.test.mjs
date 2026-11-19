import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { memoryChange, releaseReading, releaseSuite, releaseTable } from '../../scripts/memory/iphone/release.mjs';
import recorded from '../fixtures/iphone-memory/recorded-boots.json';

/** @param {number} peak @param {string} [build] @param {number} [seconds] */
function trial(peak, build = 'recorded-build', seconds = 30) {
  return {
    measurements: {
      'com.apple.WebKit.WebContent': { peakBytes: peak, settledBytes: 400_000_000 },
      'com.apple.WebKit.GPU': { peakBytes: 250_000_000, settledBytes: 220_000_000 },
    },
    zone: { boot: { outcome: 'control', startedAt: 1000, controlAt: 45_000, state: { build } },
      frames: { samples: [{ seconds }], summary: { fps: 60 } } },
  };
}

/** @param {(path: string) => void | Promise<void>} verify */
async function withRecording(verify) {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(resolve('tmp/iphone-release-'));
  try {
    for (const key of ['brasscap', 'nine', 'walk']) mkdirSync(join(directory, key));
    await verify(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** @param {string} directory @param {string} task @param {unknown[]} attempts */
const write = (directory, task, attempts) => {
  writeFileSync(join(directory, task, 'report.json'), JSON.stringify(attempts));
};

const info = /** @type {const} */ ({ source: 'recorded', date: '2026-11-19T08:00:00.000Z', base: 'https://staging.wildshard.io/' });

test('uses all three cold readings and the full walk for the release row', async () => {
  await withRecording(path => {
    write(path, 'nine', [trial(520_000_000), trial(500_000_000), trial(510_000_000)]);
    write(path, 'brasscap', [trial(500_000_000), trial(520_000_000)]);
    write(path, 'walk', [trial(780_000_000, 'recorded-build', 60)]);
    const reading = releaseReading(path, info);
    expect(reading.build).toBe('recorded-build');
    expect(reading.stages.nine.metrics).toMatchObject({ webPeak: 510_000_000, controlMs: 44_000 });
    expect(reading.stages.brasscap).toMatchObject({ status: 'incomplete', attempts: 2, metrics: { webPeak: null } });
    expect(reading.stages.walk.metrics.fps).toBe(60);
    write(path, 'walk', [trial(780_000_000, 'recorded-build', 59)]);
    expect(releaseReading(path, info).stages.walk.metrics.fps).toBeNull();
  });
});

test('keeps a deploy during the suite out of the comparisons', async () => {
  await withRecording(path => {
    write(path, 'nine', [trial(500_000_000), trial(500_000_000), trial(500_000_000, 'next-build')]);
    const reading = releaseReading(path, info);
    expect(reading.build).toBeNull();
    expect(reading.stages.nine.metrics.webPeak).toBeNull();
    expect(releaseTable(reading, null)).toContain('Several page builds were observed');
  });
});

test('a reload-qualified control attempt stays in the log and outside the cold median', async () => {
  await withRecording(path => {
    const normal = trial(500_000_000), reload = trial(900_000_000);
    write(path, 'nine', [normal, normal, {
      ...reload, zone: { ...reload.zone, boot: { ...reload.zone.boot, reloaded: true } },
    }]);
    const reading = releaseReading(path, info);
    expect(reading.stages.nine).toMatchObject({ status: 'incomplete', control: 2, metrics: { webPeak: null } });
    expect(releaseTable(reading, null)).toContain('excluded (boot reloaded during capture)');
  });
});

test('bench release replay retains the recorded Nine control and Pine tab loss without inventing medians', async () => {
  await withRecording(path => {
    const { nine, pine } = recorded;
    write(path, 'nine', [{ zoneSlug: nine.slug, zone: { boot: {
      outcome: 'control', state: { build: nine.build }, startedAt: 0, controlAt: nine.controlS * 1000,
    } } }]);
    // Pine came from the deck survey. A stray report filed under the control
    // folder must not turn it into a Brasscap sample or poison Nine's build.
    write(path, 'brasscap', [{ zoneSlug: pine.slug, zone: {
      last: { build: pine.build, phases: { su: { fact: pine.stage, pct: pine.progress } } },
      error: { code: pine.driverError, message: pine.driverError },
    } }]);
    const history = join(path, 'replay-history.jsonl');
    const replay = ['scripts/memory/iphone/bench.mjs', '--suite', 'release', '--recorded', path, '--history', history];
    execFileSync(process.execPath, replay, { encoding: 'utf8' });
    const report = execFileSync(process.execPath, replay, { encoding: 'utf8' });
    expect(report).toContain(`Previous build ${nine.build}`);
    expect(report).toContain('control in 16.80 s');
    expect(report).toContain('pine-hollow');
    expect(report).toContain('no such window · 60.6% · Spawn detail · excluded (expected brasscap-mesa)');
    const lines = readFileSync(history, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ source: 'recorded', build: nine.build, builds: [nine.build], stages: {
      nine: { status: 'incomplete', control: 1, metrics: { controlMs: null, webPeak: null } },
      brasscap: { status: 'incomplete', control: 0 },
    } });
  });
});

test('reports both sides of the J431 noise margin', () => {
  expect(memoryChange(100_000_000, 105_000_000)).toBe('within noise');
  expect(memoryChange(1_000_000_000, 1_020_000_000)).toBe('within noise');
  expect(memoryChange(1_000_000_000, 1_021_000_000)).toBe('higher');
  expect(memoryChange(500_000_000, 489_000_000)).toBe('lower');
  expect(memoryChange(null, 500_000_000)).toBe('unavailable');
});

test('compares the second replay and keeps a dry replay out of history', async () => {
  await withRecording(async path => {
    write(path, 'nine', [trial(500_000_000), trial(500_000_000), trial(500_000_000)]);
    const history = join(path, 'history.jsonl');
    const args = ['--recorded', path, '--history', history];
    const print = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(await releaseSuite(args)).toBe(0);
      expect(await releaseSuite(args)).toBe(0);
      expect(await releaseSuite([...args, '--dry-run'])).toBe(0);
      expect(readFileSync(history, 'utf8').trim().split('\n')).toHaveLength(2);
      expect(print.mock.calls.at(-1)?.[0]).toContain('within noise');
      expect(print.mock.calls.at(-1)?.[0]).toContain('Previous build recorded-build');
    } finally { print.mockRestore(); }
  });
});

test('a live capture never reuses an earlier capture directory', async () => {
  await withRecording(async path => {
    write(path, 'nine', [trial(500_000_000)]);
    const lock = vi.fn(() => Promise.resolve(0));
    await expect(releaseSuite(['--out', path, '--with-locks'], { script: 'unused.mjs', lock }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(lock).not.toHaveBeenCalled();
  });
});

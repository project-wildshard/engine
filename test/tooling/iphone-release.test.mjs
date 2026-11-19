import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { memoryChange, releaseReading, releaseSuite, releaseTable } from '../../scripts/memory/iphone/release.mjs';

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
    for (const key of ['template', 'nine', 'walk']) mkdirSync(join(directory, key));
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
    write(path, 'template', [trial(500_000_000), trial(520_000_000)]);
    write(path, 'walk', [trial(780_000_000, 'recorded-build', 60)]);
    const reading = releaseReading(path, info);
    expect(reading.build).toBe('recorded-build');
    expect(reading.stages.nine.metrics).toMatchObject({ webPeak: 510_000_000, controlMs: 44_000 });
    expect(reading.stages.template).toMatchObject({ status: 'incomplete', attempts: 2, metrics: { webPeak: null } });
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

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { memoryChange, releaseReading, releaseSuite, releaseTable } from '../scripts/memory/iphone/release.mjs';
import driftwood from '../../test/fixtures/iphone-memory/driftwood-route.json';
import recorded from '../../test/fixtures/iphone-memory/recorded-boots.json';

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

/** @param {string} directory @param {typeof driftwood} trials */
function writeDriftwood(directory, trials) {
  mkdirSync(join(directory, 'driftwood'), { recursive: true });
  writeFileSync(join(directory, 'driftwood/route.json'), JSON.stringify(trials));
}

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
    const replay = ['src/scripts/memory/iphone/bench.mjs', '--suite', 'release', '--recorded', path, '--history', history];
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

test('the DW1 replay reports measured spreads and an FPS drop without failing', async () => {
  await withRecording(async path => {
    writeDriftwood(path, driftwood);
    const history = join(path, 'history.jsonl');
    const args = ['--recorded', path, '--history', history];
    const print = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(await releaseSuite(args)).toBe(0);
      const first = print.mock.calls.at(-1)?.[0];
      expect(first).toContain('Driftwood Isle route (report only). Build 30eab98a8.');
      expect(first).toContain('| 30 | dock spawn | 2 | 25.20 (24.50–25.90) | 102.5 (90.0–115.0) |');
      expect(first).toContain('| 60 | boar fight | 2 |');

      const next = structuredClone(driftwood);
      for (const trial of next) {
        trial.boot.build = 'next-build';
        if (trial.cap !== 30) continue;
        for (const leg of trial.legs) {
          if (leg.name === 'castaway camp (NPC)') leg.summary.fps = 26.9;
          if (leg.name === 'dock spawn') leg.summary.fps = 22.68;
        }
      }
      writeDriftwood(path, next);
      expect(await releaseSuite(args)).toBe(0);
      const second = print.mock.calls.at(-1)?.[0];
      expect(second).toContain('| -10.33% | FLAG: FPS down more than 10% |');
      expect(second).toMatch(/\| 30 \| dock spawn \| .* \| -10\.00% \| reported \|/u);
      expect(second).toMatch(/\| 60 \| castaway camp \(NPC\) \| .* \| 0\.00% \| reported \|/u);
      const lines = readFileSync(history, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(lines.map(line => line.driftwood.build)).toEqual(['30eab98a8', 'next-build']);
      expect(lines[1].driftwood.segments).toHaveLength(22);
    } finally { print.mockRestore(); }
  });
});

test('a partial route is excluded and a different release build makes Driftwood unavailable', async () => {
  await withRecording(path => {
    const partial = structuredClone(driftwood);
    partial[0].legs.pop();
    writeDriftwood(path, partial);
    const reading = releaseReading(path, info);
    expect(reading.driftwood.segments[0]).toMatchObject({ cap: 30, name: 'dock spawn', runs: 1 });
    write(path, 'nine', [trial(500_000_000, 'other-build')]);
    expect(releaseTable(releaseReading(path, info), reading)).toContain('Route build differs from the release suite');
  });
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

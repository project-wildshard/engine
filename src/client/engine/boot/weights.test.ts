import {describe, expect, it} from 'vitest';
import {combinedLoadingFraction, loadingFraction} from './weights';
import { TimeLeftClock, timeLeftSeconds, timeLeftText, type TimeLeftRow } from './timeLeft';

it('combines the same two tracks without hiding unfinished work', () => {
  expect(combinedLoadingFraction(1, 0.2)).toBe(0.6);
  expect(combinedLoadingFraction(0.2, 1)).toBe(0.6);
  expect(combinedLoadingFraction(1, 1)).toBe(1);
});
it('credits completed stages and explicit units, never time passing', () => {
  const rows = [{state: 'ok', ms: 9000}, {state: 'on', ms: 1000}] as const;
  expect(loadingFraction(rows)).toBe(0.5);
  const stalled = [{state: 'on', ms: 1_000_000}] as const;
  expect(loadingFraction(stalled)).toBe(0);
  expect(loadingFraction([{state: 'on', fraction: 0.25}])).toBe(0.25);
  expect(loadingFraction([{state: 'on', fraction: Number.NaN}])).toBe(0);
  expect(loadingFraction([{state: 'ok'}])).toBeLessThan(1);
  expect(loadingFraction(rows, true)).toBe(1);
});


/** Four Load rows measured on both profiles: phone seconds (weight) and desktop seconds (fastWeight). */
const PATH: readonly Pick<TimeLeftRow, 'key' | 'weight' | 'fastWeight'>[] = [
  { key: 'modules', weight: 0.6, fastWeight: 0.35 }, { key: 'gameplay', weight: 0.7, fastWeight: 0.05 },
  { key: 'home', weight: 4.7, fastWeight: 1.2 }, { key: 'firstFrame', weight: 1.1, fastWeight: 0.75 },
  { key: 'server', weight: 2.0, fastWeight: 0.2 }, { key: 'finish', weight: 0.37, fastWeight: 0.3 },
];
/** The path with the first `done` work rows finished at `place` between the profiles (0 desktop, 1 phone). */
const boot = (done: number, place: number, running?: { ms: number }): TimeLeftRow[] => PATH.map((row, index) => {
  const ms = 1000 * ((row.fastWeight ?? 0) + place * ((row.weight ?? 1) - (row.fastWeight ?? 0)));
  if (row.key === 'modules') return { ...row, state: 'ok', ms: 15_000 };
  if (row.key === 'finish') return { ...row, state: 'on', ms: 300 };
  if (index <= done) return { ...row, state: 'ok', ms };
  if (index === done + 1 && running !== undefined) return { ...row, state: 'on', ms: running.ms };
  return { ...row, state: 'todo', ms: 0 };
});
const remaining = (done: number, place: number): number => PATH.slice(done + 1).filter(row => row.key !== 'finish')
  .reduce((sum, row) => sum + (row.fastWeight ?? 0) + place * ((row.weight ?? 1) - (row.fastWeight ?? 0)), 0);

describe('LS5 time left (J188: real numbers only)', () => {
  it('is hidden on a path not measured on two profiles, and before a second of finished phone-profile work', () => {
    expect(timeLeftSeconds(boot(2, 1).map(({ fastWeight: _fast, ...row }) => row))).toBeNull();
    expect(timeLeftSeconds(boot(2, 1).map(({ weight: _weight, fastWeight: _fast, ...row }) => row))).toBeNull();
    // gameplay alone is 0.7 phone seconds: no reading yet; with Home region it is one
    expect(timeLeftSeconds(boot(1, 0.5))).toBeNull();
    expect(timeLeftSeconds(boot(2, 0.5))).not.toBeNull();
  });

  it('reads where the device sits between the two profiles from finished rows, and costs every row still to run there', () => {
    for (const place of [0, 0.3, 1, 1.4]) expect(timeLeftSeconds(boot(2, place))).toBeCloseTo(remaining(2, place), 6);
    // Start's 15 s in modules' row and the open finish parent are not Load readings
    expect(timeLeftSeconds(boot(2, 0.3))).toBeCloseTo(remaining(2, 0.3), 6);
  });

  it('counts a running row down by its elapsed time, and goes up rather than lies when it overruns', () => {
    const fresh = timeLeftSeconds(boot(2, 0.3, { ms: 0 })) ?? Number.NaN;
    const firstFrame = 0.75 + 0.3 * (1.1 - 0.75);
    expect(timeLeftSeconds(boot(2, 0.3, { ms: 500 }))).toBeCloseTo(fresh - 0.5, 6);
    // first frame has run 3 s, far past its cost at 0.3: the place rises, so the rows after it cost more too
    const overrun = timeLeftSeconds(boot(2, 0.3, { ms: 3000 })) ?? Number.NaN;
    expect(overrun).toBeGreaterThan(fresh - firstFrame);
    expect(overrun).toBeGreaterThan(0.2 + 0.3 * 1.8);
  });

  it('never rests at zero while a row runs past its cost: half its overrun stays, so a stuck row raises the number', () => {
    const rows = (ms: number): TimeLeftRow[] => boot(3, 0.3, { ms });
    const due = 0.2 + 0.3 * 1.8;
    expect(timeLeftSeconds(rows(due * 1000))).toBeCloseTo(0, 6);
    const late = timeLeftSeconds(rows(due * 1000 + 2000)) ?? 0, stuck = timeLeftSeconds(rows(due * 1000 + 10_000)) ?? 0;
    expect(late).toBeGreaterThan(0.5);
    expect(stuck).toBeGreaterThan(late);
  });
});

describe('LS5 shown time left: whole seconds that count down, rise only for real, never flicker', () => {
  it('counts down with the clock between equal readings of the finish', () => {
    const clock = new TimeLeftClock(), shown: number[] = [];
    for (let t = 0; t <= 6000; t += 200) shown.push(clock.read(t, (10_000 - t) / 1000)?.seconds ?? Number.NaN);
    expect(shown[0]).toBe(10);
    expect(shown.at(-1)).toBe(4);
    for (let index = 1; index < shown.length; index++) expect(shown[index]).toBeLessThanOrEqual(shown[index - 1] ?? 0);
  });

  it('follows a later finish smoothly upward, and a reading jittering around a half second never flickers', () => {
    const clock = new TimeLeftClock();
    clock.read(0, 5);
    const after = clock.read(200, 9);
    expect(after?.ms).toBeGreaterThan(4800);
    expect(after?.ms).toBeLessThan(9000);
    const jitter = new TimeLeftClock(), seconds: number[] = [];
    // the same finish at 6.5 s, each reading 0.3 s early or late
    for (let t = 0, index = 0; t < 3000; t += 100, index++) seconds.push(jitter.read(t, 6.5 - t / 1000 + (index % 2 === 0 ? 0.3 : -0.3))?.seconds ?? 0);
    const rises = seconds.filter((value, index) => index > 0 && value > (seconds[index - 1] ?? 0));
    expect(rises).toEqual([]);
  });

  it('holds a risen number a second, so a reading that rises and falls back cannot flicker it', () => {
    const clock = new TimeLeftClock(), shown: number[] = [];
    // readings at 200 ms: 5 s left, then 7 s for four paints, then 3 s (the Codex review's case)
    for (const [index, reading] of [5, 7, 7, 7, 7, 3, 3, 3, 3, 3, 3, 3].entries()) shown.push(clock.read(index * 200, reading)?.seconds ?? -1);
    const rise = shown.findIndex((value, index) => index > 0 && value > (shown[index - 1] ?? 0));
    expect(rise).toBeGreaterThan(0);
    for (let index = rise; index < shown.length && index * 200 < rise * 200 + 1000; index++) expect(shown[index]).toBeGreaterThanOrEqual(shown[rise] ?? 0);
  });

  it('hides on a null reading and starts afresh', () => {
    const clock = new TimeLeftClock();
    expect(clock.read(0, 30)?.seconds).toBe(30);
    expect(clock.read(100, null)).toBeNull();
    expect(clock.read(200, 3)?.seconds).toBe(3);
  });

  it('writes seconds, then minutes and seconds', () => {
    expect(timeLeftText(0.2)).toBe('under 1 s');
    expect(timeLeftText(0.6)).toBe('about 1 s');
    expect(timeLeftText(42.4)).toBe('about 42 s');
    expect(timeLeftText(65)).toBe('about 1 min 5 s');
  });
});

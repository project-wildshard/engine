// QA 11-24 row 60: `?time=` was read only by a painted sky; a keyed day clock (Pine's sky, Driftwood's faceted day, a toon
// sky) ignored it, and Settings did not count it as the URL's pick, so a public page's saved Time of day won.
import { describe, expect, it } from 'vitest';
import { settingParams } from '@wildshard/engine/ui/Settings';
import { urlTimePhase } from './daySky';

const D = 0.75;
const day = { style: { phases: { dawnMist: 0.02 }, fixed: { midday: 0.375, golden: 0.6, sunset: 0.7, night: 0.85 } }, spec: { dayFraction: D } } as unknown as Parameters<typeof urlTimePhase>[0];
// sim/dayClock's clockHour for a phase clock, written out (the test reads the law, not the import)
const hourOf = (phase: number | undefined): number => { const p = phase ?? Number.NaN; return (p < D ? 6 + 12 * p / D : 18 + 12 * (p - D) / (1 - D)) % 24; };

describe('?time= on a keyed day clock', () => {
  it('maps an hour through the clock\'s own law', () => {
    for (const hour of [0, 3, 6, 9.5, 12, 17.25, 18, 21, 23.9]) expect(hourOf(urlTimePhase(day, String(hour)))).toBeCloseTo(hour, 6);
    expect(urlTimePhase(day, '12')).toBeCloseTo(0.375);
    expect(urlTimePhase(day, '30')).toBeCloseTo(urlTimePhase(day, '6') ?? Number.NaN);
  });

  it('reads the painted sky\'s day parts, the row\'s phases and the Time of day picks', () => {
    expect(hourOf(urlTimePhase(day, 'noon'))).toBeCloseTo(12);
    expect(hourOf(urlTimePhase(day, 'dusk'))).toBeCloseTo(18.15);
    expect(urlTimePhase(day, 'dawnMist')).toBe(0.02);
    expect(urlTimePhase(day, 'golden')).toBe(0.6);
  });

  it('leaves the row\'s start when absent or unreadable', () => {
    expect(urlTimePhase(day, null)).toBeUndefined();
    expect(urlTimePhase(day, '')).toBeUndefined();
    expect(urlTimePhase(day, 'teatime')).toBeUndefined();
  });

  it('counts as the URL\'s Time of day pick, so a saved pick does not freeze it', () => {
    expect(settingParams('time')).toContain('time');
  });
});

import * as v from 'valibot';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { expect, test } from 'vitest';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { Rng } from '../src/shared/engine/core/rng';
import { NALATI_NIGHT as nightInput } from './fixtures/nalati-night';
import {weatherWitness as weather,withWeatherWitness} from './fixtures/weatherInlineWitness';

const night=withWeatherWitness(nightInput);

// Cold native fixture preparation precedes the catalogue's timed assertions.
const [{ originalNalatiScriptSections }, { originalHeldMetadata }, { NALATI_KOKPAR }, { NALATI_RIDING_PROGRAMS }, { NALATI_TITAN_PROGRAMS },
  { NALATI_WEATHER }, { NALATI_ADMISSION }, { NALATI_CHARGE }] = await Promise.all([import('./fixtures/nalati-script-inventory'),
  import('./fixtures/nalati-held-original'), import('./fixtures/nalati-kokpar'), import('./fixtures/nalati-riding'), import('./fixtures/nalati-titan'),
  import('./fixtures/nalati-weather'), import('./fixtures/nalati-admission'), import('./fixtures/nalati-charge')]);
const originalHeld = originalHeldMetadata();

const author = (): { project: ReturnProgram['project'] } => {
  const module = ReturnProgram.page(night.program);
  return { project(signal, fields, random) { return module.project(signal, { ...night.parameters, ...fields }, random); } };
};

test('ridge slots wrap and the night line engages and retreats with hysteresis', () => {
  const script = author(), random = new Rng(503);
  const start = script.project('lineStart', { at: -1, px: 0, pz: 24 }, random);
  expect(Number.isFinite(start['s'])).toBe(true); expect(Math.abs(start['dir'] ?? 0)).toBe(1);
  const point = script.project('lineSlot', { s: 0, slot: 0 });
  const wrapped = script.project('lineSlot', { s: night.parameters.d4 * 4, slot: 0 });
  expect(wrapped['x']).toBeCloseTo(point['x'] ?? 0); expect(wrapped['z']).toBeCloseTo(point['z'] ?? 0);
  for (const s of [-100, -1, 40, 220, 440, 660, 10000]) {
    const slot = script.project('lineSlot', { s, slot: 2 });
    expect(Object.values(slot).every(Number.isFinite)).toBe(true);
  }
  const base = { dt: .1, px: 0, py: 30, pz: 24, ax: 30, az: 24, mode: 0, s: 0, theta: 0, dir: 1, t: 0 };
  const engaged = script.project('line', base); expect(engaged['mode']).toBe(1);
  expect(script.project('line', { ...base, ...engaged, ax: 100 })['mode']).toBe(1);
  const retreat = script.project('line', { ...base, ...engaged, py: 10 }); expect(retreat['mode']).toBe(0);
  for (const state of [engaged, retreat]) {
    const target = script.project('target', { ...base, ...state, slot: 2 });
    expect(Object.values(target).every(Number.isFinite)).toBe(true); expect(target['speed']).toBeGreaterThan(0);
  }
});

test('roster holds, rider death and warrior retirement publish once', () => {
  const script = author();
  expect(script.project('roster', { dt: .1, respawn: .05, hold: 1, night: 1 })).toEqual({ respawn: .05, spawn: 0 });
  expect(script.project('roster', { dt: .1, respawn: .05, hold: 0, night: 1 })['spawn']).toBe(1);
  expect(script.project('roster', { dt: .1, respawn: .05, hold: 0, night: 0 })['spawn']).toBe(0);
  const dying = script.project('rider', { dt: .1, alive: 0, dead: 0, dying: 0, fade: 1, fadeTarget: 1 });
  expect(dying).toMatchObject({ killed: 1, dead: 1, fadeTarget: 0, retire: 0 });
  expect(script.project('rider', { ...dying, dt: 1.3, alive: 0 }) ).toMatchObject({ killed: 0, retire: 1 });
  expect(script.project('warrior', { dt: .1, t: 0, alive: 0, gone: 0 })).toMatchObject({ broken: 1, retire: 0 });
  expect(script.project('warrior', { dt: .1, t: 3.2, alive: 0, gone: 0 })).toMatchObject({ broken: 0, retire: 1 });
  expect(script.project('warrior', { dt: .1, t: 0, alive: 1, gone: 1 })).toMatchObject({ statue: 1, retire: 1 });
});

test('dusk selection handles empty rings and rotates the crown', () => {
  const script = author();
  expect(script.project('tonight', { count: 0, night: 0, slot: 0 })).toEqual({});
  const indices = Array.from({ length: 5 }, (_, slot) => script.project('tonight', { count: 12, night: 2, slot })['index']);
  expect(indices).toEqual([4, 6, 8, 2, 11]);
});

test('firing policy rejects quiet and distant riders and admits a finite ballistic aim', () => {
  const script = author(), fields = { dt: .1, fireT: 0, quiet: 0, distance: 34, engaged: 1 };
  expect(script.project('fire', fields)['shoot']).toBe(1);
  expect(script.project('fire', { ...fields, quiet: 1 })['shoot']).toBe(0);
  expect(script.project('fire', { ...fields, distance: 70 })['shoot']).toBe(0);
  const aim = script.project('aim', { x: 0, y: 3, z: 0, px: 0, py: 0, pz: 34, vx: 1, vz: 0 }, new Rng(503));
  expect(Object.values(aim).every(Number.isFinite)).toBe(true);
  expect(Math.hypot(aim['dx'] ?? 0, aim['dy'] ?? 0, aim['dz'] ?? 0)).toBeCloseTo(34);
  expect(script.project('retry', { first: 0 }, new Rng(503))['fireT']).toBeGreaterThanOrEqual(3);
  const first = script.project('retry', { first: 1 }, new Rng(503))['fireT'];
  expect(first).toBeGreaterThanOrEqual(2); expect(first).toBeLessThan(4.5);
});

test('weather policy holds the titan storm and restores calm after its wind ends', () => {
  const script = ReturnProgram.page({ script: weather.script, bytes: weather.bytes }), fields = { titanHeld: 1, storm: 1, gust: 0, building: 0, after: 0,
    phaseT: 90, phaseLen: 100, asked: 18, calmSpeed: 4, calmDir: 2, calmGust: .3, windSpeed: 18, windGustiness: .8 };
  expect(script.project('wind', fields)).toEqual({ phaseT: 70, asked: 18, speed: 18, dir: Math.PI / 4, gustiness: .8, seconds: 10 });
  expect(script.project('wind', { ...fields, titanHeld: 0, windSpeed: -1 })).toEqual({ phaseT: 90, asked: -1, speed: 4, dir: 2, gustiness: .3, seconds: 30 });
  expect(script.project('wind', { ...fields, titanHeld: 0, windSpeed: -1, asked: -1 })).toEqual({ phaseT: 90, asked: -1 });
});

test('the actual return-script catalogue admits the shared weather/night module once', () => {
  // the catalogue section exactly as fixtures/nalati-output-original publishes it (that fixture swaps in these rows), built
  // from its script inventory alone rather than from the whole Nalati output
  const sections = originalNalatiScriptSections(originalHeld.held.program.v2, NALATI_KOKPAR, NALATI_RIDING_PROGRAMS, NALATI_TITAN_PROGRAMS,
    NALATI_WEATHER.rows, NALATI_ADMISSION, NALATI_CHARGE.rows);
  const rows = v.parse(ReturnModulesSchema, JSON.parse(encodeCanonicalJson(sections.get('actors/return-scripts'))));
  expect(night.program.script.module).toBe(weather.script.module);
  expect(rows.filter(row => row.module === weather.script.module)).toHaveLength(1);
  expect(rows.find(row => row.module === weather.script.module)?.abi).toBe('1.0');
  expect(new Set(rows.map(row => row.module)).size).toBeLessThanOrEqual(8);
});

// Meta QA-FEEDBACK-2026-11-17 row 21: the zone sweep's pass rule (scripts/zone-sweep.mjs).
import {expect, test} from 'vitest';
import {wrongZone, zoneVerdict} from '../scripts/zone-sweep.mjs';

test('a zone passes only in the world within the budget, with no fault, error card or driver throw', () => {
  const ok = {enterMs: 12_000, errors: [], modal: false, thrown: ''};
  expect(zoneVerdict(ok, 60_000)).toBe(true);
  expect(zoneVerdict({...ok, enterMs: null}, 60_000)).toBe(false);
  expect(zoneVerdict({...ok, enterMs: 61_000}, 60_000)).toBe(false);
  expect(zoneVerdict({...ok, errors: ['the error card showed: boot']}, 60_000)).toBe(false);
  expect(zoneVerdict({...ok, modal: true}, 60_000)).toBe(false);
  expect(zoneVerdict({...ok, thrown: 'No Shard Select card for Glowfen after 10 s'}, 60_000)).toBe(false);
});

test('a card whose loading card names another zone fails (Sky Reach loading Signal Dunes, staging v0.1.36)', () => {
  const row = {enterMs: 10_399, errors: [], modal: false, thrown: '', name: 'Sky Reach', zones: ['Signal Dunes']};
  expect(wrongZone(row)).toBe('Signal Dunes');
  expect(zoneVerdict(row, 60_000)).toBe(false);
  expect(wrongZone({...row, zones: ['SKY REACH', '']})).toBeUndefined();
  expect(zoneVerdict({...row, zones: ['Sky Reach']}, 60_000)).toBe(true);
});

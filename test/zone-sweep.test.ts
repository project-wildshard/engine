// Meta QA-FEEDBACK-2026-11-17 row 21: the zone sweep's pass rule (scripts/zone-sweep.mjs).
import {expect, test} from 'vitest';
import {chunkLink, sweepTargets, wrongZone, zoneVerdict} from '../scripts/zone-sweep.mjs';

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

// STAGING-BUGBASH SB45 / ONE-FORMAT OF8b: the upload-boot bug passed the sweep because it only tapped cards in the loaded page.
test('--chunk opens a zone by its cold ?chunk= link, past the title (QA row 16)', () => {
  expect(chunkLink('https://staging.wildshard.io', 'mirror-salt')).toBe('https://staging.wildshard.io/?chunk=mirror-salt&skipintro=1');
  expect(chunkLink('https://staging.wildshard.io/', 'a b')).toBe('https://staging.wildshard.io/?chunk=a%20b&skipintro=1');
});

test('--only keeps the cards it names, and names a slug with no card as missing rather than a failure (SA48)', () => {
  const cards = [{ name: 'Driftwood Isle' }, { name: 'Mossgate' }, { name: 'Glowfen' }];
  const slugs = { 'Driftwood Isle': 'driftwood-isle', Mossgate: 'mossgate' };
  expect(sweepTargets(cards, slugs, undefined)).toEqual({
    targets: [{ slug: 'driftwood-isle', name: 'Driftwood Isle' }, { slug: 'mossgate', name: 'Mossgate' }, { slug: 'Glowfen', name: 'Glowfen' }], missing: [] });
  expect(sweepTargets(cards, slugs, ['mossgate', 'no-cook-upload'])).toEqual({ targets: [{ slug: 'mossgate', name: 'Mossgate' }], missing: ['no-cook-upload'] });
});

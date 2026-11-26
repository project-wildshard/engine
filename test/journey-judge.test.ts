// STAGING-BUGBASH SB5: the journey judge (src/scripts/journey-proof.mjs) fails a blank over half a second; the grid's sky-down
// arrival under its ARRIVING caption is a screen of its own, not a blank.
import { expect, test } from 'vitest';
import { judge, label, titleCardIndex } from '../src/scripts/journey-proof.mjs';

const screen = (over: Record<string, boolean>) => ({ doc: 1, path: '/w', shell: false, title: false, select: false, loading: false, bar: false, hud: false, modal: false, ...over });

test('the arrival flight is not blank; 600 ms of nothing is blank', () => {
  expect(label(screen({ reveal: true }))).toBe('arrival');
  const run = (middle: Record<string, boolean>) => [0, 120, 240, 360, 480, 600, 720, 840].map((t, i) => ({ t, s: screen(i === 0 ? { loading: true } : i === 7 ? { hud: true } : middle) }));
  expect(judge(run({ reveal: true }))).toEqual([]);
  expect(judge(run({})).map((p) => p.text)).toEqual(['a blank screen for over 500 ms']);
});

// MAIN-SCREEN MS5 (J399, Jake: "it has to always be the detailed loading card bro"): a full-screen card without its START,
// DOWNLOAD and LOAD tracks fails; ENTER THE MMO starts on the main menu, which may show before the tap and never after.
test('MS5: a plain loading card fails, and the main menu is allowed only before the tap', () => {
  const path = (rows: readonly Record<string, boolean>[]) => rows.map((over, i) => ({ t: i * 120, s: screen(over) }));
  expect(judge(path([{ title: true }, { loading: true, detailed: true }, { hud: true }]))).toEqual([]);
  expect(judge(path([{ title: true }, { loading: true, detailed: false }, { hud: true }])).map((p) => p.text)).toEqual(['the loading card is not the detailed one (J399)']);
  expect(judge(path([{ title: true }, { loading: true, detailed: true }, { title: true }, { hud: true }])).map((p) => p.text)).toEqual(['the main menu came back after Enter World']);
  // ENTER THE MMO's card paints over the main menu, still laid out beneath it: a bar there is a bar, and the menu alone after it
  // has come back
  expect(judge(path([{ title: true }, { title: true, bar: true }, { hud: true }])).map((p) => p.text)).toEqual(['the loading card is shrunk to a bar']);
  expect(judge(path([{ title: true }, { title: true, loading: true, detailed: true }, { title: true }, { hud: true }])).map((p) => p.text)).toEqual(['the main menu came back after Enter World']);
});

// QA 11-23 row 8 (Jake: an update boot's splash "frozen"): from the tap to the world's card the screen moves at least once a second
test('row 8: a still screen over a second before the loading card fails; motion, a new screen or the card itself does not', () => {
  const path = (rows: readonly Record<string, boolean>[]) => rows.map((over, i) => ({ t: i * 250, s: screen(over) }));
  const still = { title: true, moving: false }, swept = { title: true, moving: true };
  const card = { loading: true, detailed: true, moving: false };
  expect(judge(path([still, still, still, still, still, still, card, { hud: true }])).map((p) => p.text))
    .toEqual(['nothing moved on screen for over 1000 ms before the loading card']);
  expect(judge(path([still, swept, swept, swept, swept, swept, card, { hud: true }]))).toEqual([]);
  // the card itself is judged by its clock and tracks, not here; samples with no word on motion are not judged
  expect(judge(path([still, card, card, card, card, card, card, { hud: true }]))).toEqual([]);
  expect(judge(path([{ title: true }, { title: true }, { title: true }, { title: true }, { title: true }, { title: true }, card, { hud: true }]))).toEqual([]);
});

// meta SHARD-SOURCE SS-JP1 (F17): a shard the API placed after the build has no row in `#ws-title-rows`; its Shard Select card is
// carded from the catalogue (SA46), so the journey takes it by the slug as words.
test('SS-JP1: the card is found by its title row, else by the slug, else by the slug as words', () => {
  const rows = [{ slug: 'driftwood-isle', name: 'Driftwood Isle' }, { slug: 'nalati', name: 'Nalati Highlands' }];
  const names = ['Driftwood Isle', 'Nalati Highlands', 'Glowfen', 'Mirror Salt'];
  expect(titleCardIndex(rows, names, 'nalati')).toBe(1);
  expect(titleCardIndex(rows, names, 'Driftwood Isle')).toBe(0);
  expect(titleCardIndex(rows, names, 'glowfen')).toBe(2);
  expect(titleCardIndex(rows, names, 'mirror-salt')).toBe(3);
  expect(titleCardIndex('junk', names, 'mirror-salt')).toBe(3);
  expect(titleCardIndex(rows, names, 'cinder-springs')).toBe(-1);
});

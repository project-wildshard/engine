import { expect, test } from 'vitest';
import { BAND_CLEAR_FROM, BAND_CLEAR_TO, BAND_OUTSET, bandMaterial, bandNearShare } from './hazeBand';

/** The road's centre line off a cell edge (half the 62.5 m gap): where a traveller stands at a turn-in. */
const ROAD_CENTRE = 31.25;

test('ZE7: a turn-in looks through the haze band at the cell, the band ahead along the road still reads', () => {
  const turnIn = ROAD_CENTRE - BAND_OUTSET;
  expect(bandNearShare(turnIn)).toBe(0);
  expect(bandNearShare(turnIn + 10)).toBeLessThan(0.15);
  expect(bandNearShare(120)).toBe(1);
  expect(bandNearShare((BAND_CLEAR_FROM + BAND_CLEAR_TO) / 2)).toBeCloseTo(0.5, 5);
});

test('ZE7: the band shader clears over the same range as bandNearShare', () => {
  const material = bandMaterial({ colour: [0.72, 0.68, 0.78], height: 38, opacity: 0.8, own: 0.8 });
  expect(material.fragmentShader).toContain(`smoothstep(${BAND_CLEAR_FROM.toFixed(1)}, ${BAND_CLEAR_TO.toFixed(1)},`);
  material.dispose();
});

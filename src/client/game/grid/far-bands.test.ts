import { expect, test } from 'vitest';
import { FAR_BANDS, farBandShare } from './farImpostorView';

// G539: the far tier's bands: the proxy hands over to the impostor across the fade, never at a hard line.
test('the band hands the proxy to the impostor across its fade', () => {
  expect(farBandShare(0)).toBe(0);
  expect(farBandShare(FAR_BANDS.from)).toBeCloseTo(0.5);
  expect(farBandShare(FAR_BANDS.from + FAR_BANDS.fade)).toBe(1);
});

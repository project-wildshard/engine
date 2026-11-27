import { expect, test } from 'vitest';
import { phoneUrl } from '../src/client/engine/boot/bytes';
import { registerGpuFiles } from '../src/client/engine/boot/gpuFiles';
import { initializeTier, TIER_CONFIG } from '../src/client/engine/core/tier';
import { installAssetTables } from '../src/shared/engine/boot/tables';

// SF7c: a cooked page holds no copy of the zone, so the page's byte table never names a shard's hand-made phone copy. Nine's
// product layers asked `paint/concrete.jpg` on the phone, which its prepared phone set (recorded on a page that held
// `concrete.phone.webp`) leaves out: a 404. The cooked KTX2 table keys the phone copy, and that counts as served.
const JPG = '/assets/sf7c-fixture/paint/concrete.jpg';
const COPY = '/assets/sf7c-fixture/paint/concrete.phone.webp';
const OTHER = '/assets/sf7c-fixture/paint/stone.jpg';

test('a phone reads the copy the tier table keys, and the original where nothing names a copy', () => {
  initializeTier('phone');
  expect(TIER_CONFIG.maxTexture).toBeLessThanOrEqual(1024);
  installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} });
  expect(phoneUrl(JPG)).toBe(JPG);
  registerGpuFiles({ phone: { [COPY]: '/assets/sf7c-fixture/paint/concrete.t512-0123abcd.ktx2' }, desktop: {} });
  expect(phoneUrl(JPG)).toBe(COPY);
  expect(phoneUrl(OTHER)).toBe(OTHER);
  installAssetTables({ bytes: { [OTHER.replace('.jpg', '.phone.webp')]: 4 }, versions: {}, music: {}, sfx: {}, packs: {} });
  expect(phoneUrl(OTHER)).toBe(OTHER.replace('.jpg', '.phone.webp'));
});

test('a desktop keeps the original whatever the table keys', () => {
  initializeTier('desktop');
  expect(phoneUrl(JPG)).toBe(JPG);
});

import { expect, test } from 'vitest';
import { phoneUrl } from '../src/client/engine/boot/bytes';
import { initializeTier, TIER_CONFIG } from '../src/client/engine/core/tier';
import { installAssetTables } from '../src/shared/engine/boot/tables';
import { useZoneDownloadListing } from '../src/shared/engine/boot/zoneAssets';

// SF7c: a cooked page holds no copy of the zone, so the page's byte table never names a shard's hand-made phone copy. Nine's
// product layers asked `paint/concrete.jpg` on the phone, which its prepared phone set (recorded on a page that held
// `concrete.phone.webp`) leaves out: a 404. The zone's cooked download lists the phone copy, and that counts as served.
const JPG = '/assets/sf7c-fixture/paint/concrete.jpg';
const COPY = '/assets/sf7c-fixture/paint/concrete.phone.webp';
const OTHER = '/assets/sf7c-fixture/paint/stone.jpg';
const OTHER_COPY = '/assets/sf7c-fixture/paint/stone.phone.webp';

test('a phone reads the copy its zone download lists, and the original where nothing lists a copy', () => {
  initializeTier('phone');
  expect(TIER_CONFIG.maxTexture).toBeLessThanOrEqual(1024);
  installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} });
  useZoneDownloadListing(() => false);
  expect(phoneUrl(JPG)).toBe(JPG);
  useZoneDownloadListing(url => url === COPY);
  expect(phoneUrl(JPG)).toBe(COPY);
  expect(phoneUrl(OTHER)).toBe(OTHER);
  installAssetTables({ bytes: { [OTHER_COPY]: 4 }, versions: {}, music: {}, sfx: {}, packs: {} });
  expect(phoneUrl(OTHER)).toBe(OTHER_COPY);
});

test('a desktop keeps the original whatever the download lists', () => {
  initializeTier('desktop');
  useZoneDownloadListing(url => url === COPY);
  expect(phoneUrl(JPG)).toBe(JPG);
});

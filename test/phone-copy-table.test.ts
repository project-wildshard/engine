import { expect, test } from 'vitest';
import { declareTotals, phoneCopyOriginals, phoneUrl, sizeDeclaredFiles, type ChunkFiles } from '../src/client/engine/boot/bytes';
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

// Meta QA 11-26 row 86: Nalati's ground material names its own phone copy (`texture.phoneUrl`), which the cook never ships (SF7j:
// a phone samples the original's KTX2; the desktop's part holds the original). A phone in images mode on a one-shard page (a
// one-cell world's word, an Explore page) declared it, nothing sized it, and the boot stopped on "declares … but public/assets has
// no such file". It is now declared and read as its original; a copy the cook does size stays itself.
test('a phone copy nothing sizes is declared and read as the original its cook sizes', async () => {
  initializeTier('phone');
  installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} });
  useZoneDownloadListing(() => false);
  const copy = '/assets/nalati-fixture/tex/meadow.phone.webp', original = '/assets/nalati-fixture/tex/meadow.webp';
  const kept = '/assets/nalati-fixture/tex/grass.phone.webp', missing = '/assets/nalati-fixture/tex/gone.phone.webp';
  expect(phoneCopyOriginals(copy)).toEqual([original, '/assets/nalati-fixture/tex/meadow.png', '/assets/nalati-fixture/tex/meadow.jpg']);
  expect(phoneCopyOriginals('/assets/x/m.phone.glb')).toEqual(['/assets/x/m.glb']);
  expect(phoneCopyOriginals(original)).toEqual([]);
  const cook = new Map([[original, 812], [kept, 64]]), asked: string[] = [];
  const blank = { sky: [], baked: [], terrain: [], trees: [], cabins: [], physics: [], art: [], music: [], sfx: [] };
  const files: ChunkFiles = { ...blank, props: [copy, kept, original] };
  const audio = new WeakMap([[files, 'held']]);
  await sizeDeclaredFiles(files, async url => { asked.push(url); return cook.get(url); });
  expect(files.props, 'the original once, the sized copy kept').toEqual([original, kept]);
  expect(audio.get(files), 'rewritten in place: what keys on the files stays keyed').toBe('held');
  expect(declareTotals(files).props).toEqual({ bytes: 876, files: 2 });
  expect(phoneUrl(copy), 'the material and the loaders read the original').toBe(original);
  expect(phoneUrl(original)).toBe(original);
  expect(asked).toEqual([copy, original, kept]);
  // a copy whose original nothing sizes either is still refused by the total, naming the copy
  const lost: ChunkFiles = { ...blank, props: [missing] };
  await sizeDeclaredFiles(lost, async url => cook.get(url));
  expect(() => declareTotals(lost)).toThrow(missing);
});

// AUDIO AU1 (J299): the cook lists in a shard's spawn manifests exactly the recordings its LOAD reads (the client's own
// selection, through shared/engine/audio/bootAudio.ts), plus the audio its recorded fence names.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned Driftwood product when this checkout has it.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import { createCatalogueAudio } from '../src/client/engine/audio/levelAudio';
import { bootFiles } from '../src/client/engine/boot/extras';
import * as settings from '../src/client/engine/ui/Settings';
import { shardBootAudio } from '../src/cook/game/entryTotals';
import { openShardfile, shardHalf } from '../src/cook/game/shardCook';
import { productTarball } from '../src/cook/game/productTarball';
import { DEFAULT_MUSIC_STYLE, MUSIC_STYLES, defaultBootAudio } from '../src/shared/engine/audio/bootAudio';
import { installAssetTables, type AssetTables } from '../src/shared/engine/boot/tables';
import { PUBLIC_BYTES } from '../src/client/game/boot/bytes.generated';
import { ASSET_VERSIONS } from '../src/client/game/boot/versions.generated';
import { MUSIC_MANIFESTS, SFX_MANIFESTS } from '../src/client/game/boot/audio.generated';

const blank = { sky: [], baked: [], terrain: [], trees: [], cabins: [], props: [], physics: [], art: [], music: [], sfx: [] };
const level = { slug: 'fixture', card: { thumb: 'data:,', portrait: 'data:,', landscape: 'data:,' }, boot: { files: [], sources: () => blank } } as never;
/** What the page's LOAD reads for `data` under a new player's settings (session/data.ts → extras `bootFiles`). */
async function pageBootAudio(data: AudioData): Promise<string[]> {
  settings.setMusicStyle(DEFAULT_MUSIC_STYLE);
  const files = bootFiles(level, 'img', await createCatalogueAudio(data), false);
  return [...files.music, ...files.sfx];
}
const tables: AssetTables = { bytes: PUBLIC_BYTES, versions: ASSET_VERSIONS, music: MUSIC_MANIFESTS, sfx: SFX_MANIFESTS, packs: {} };
installAssetTables(tables);
// A Driftwood-shaped catalogue: the title and one theme slot, an island bed, sample overlay.
const catalogue = { music: { bootSlots: ['title', 'island'], controlTension: 'late' },
  samples: { bed: 'island', set: 'fixture-isle', loopGains: { island: 0.5 },
    catalogue: { inventoryOmitSlots: [], loopOrder: [], overlaySamples: true, ownMusic: false, priorityOwn: false } } } as unknown as AudioData;

test('the cook lists the boot recordings the page reads, plus the fence audio, and nothing unshipped', async () => {
  const page = await pageBootAudio(catalogue);
  expect(page.length).toBeGreaterThan(10);
  expect(page.some(url => url.startsWith('/assets/music/piano/'))).toBe(true);
  expect(page.some(url => url.startsWith('/assets/sfx/best/'))).toBe(true);
  const shippedSfx = Object.keys(PUBLIC_BYTES).find(url => url.startsWith('/assets/sfx/best/') && !page.includes(url));
  const fence = [...(shippedSfx === undefined ? [] : [`${shippedSfx}?v=12345678`]), '/assets/sfx/fixture-isle/gone-00000000.m4a', '/assets/gpu/rock.ktx2'];
  const listed = shardBootAudio(new Map([['audio/audio', { audio: catalogue }]]), tables, fence);
  expect(listed).toEqual([...page, ...(shippedSfx === undefined ? [] : [shippedSfx])]);
  // A level with no music or sample rows lists only its fence audio.
  expect(shardBootAudio(new Map(), tables, fence)).toEqual(shippedSfx === undefined ? [] : [shippedSfx]);
});

test('a player who keeps the default style reads only what the download listed, on every style the cook does not', async () => {
  const set = vi.spyOn(settings, 'getSfxSet').mockReturnValue('best');
  try {
    const listed = new Set(defaultBootAudio(catalogue));
    for (const style of MUSIC_STYLES) {
      settings.setMusicStyle(style);
      const files = bootFiles(level, 'img', await createCatalogueAudio(catalogue), false), reads = [...files.music, ...files.sfx];
      // The default style is all listed; another style's music downloads when the player picks it (AU3).
      if (style === DEFAULT_MUSIC_STYLE) expect(reads.filter(url => !listed.has(url))).toEqual([]);
      else expect(reads.filter(url => !listed.has(url)).every(url => url.startsWith(`/assets/music/${style}/`))).toBe(true);
    }
  } finally { set.mockRestore(); settings.setMusicStyle(DEFAULT_MUSIC_STYLE); }
});

// The pinned Driftwood product (`node scripts/pins.ts install`) and this build's boot table, when the checkout has them.
const driftwood = 'out/driftwood-isle', bootTables = 'out/.app/boot-tables.json';
test.skipIf(!existsSync(`${driftwood}/shard.json`) || !existsSync(bootTables))('Driftwood: its fence audio and its default boot set are on the download', async () => {
  const common = JSON.parse((JSON.parse(readFileSync(bootTables, 'utf8')) as { common: string }).common) as AssetTables;
  const half = shardHalf(openShardfile(productTarball(driftwood)), (_url, bytes) => bytes.length);
  const fence = half.mountRows('phone', 'entry').map(row => row.url.split('?')[0] ?? row.url).filter(url => /^\/assets\/(?:music|sfx)\//u.test(url));
  const listed = shardBootAudio(half.shard.sections, common, half.mountRows('phone', 'entry').map(row => row.url));
  expect(fence.length).toBeGreaterThanOrEqual(18);
  expect(listed).toEqual(expect.arrayContaining(fence));
  const row = half.shard.sections.get('audio/audio') as { audio: AudioData };
  const page = await pageBootAudio(row.audio);
  expect(page.length).toBeGreaterThan(50);
  expect(listed).toEqual(expect.arrayContaining(page));
});

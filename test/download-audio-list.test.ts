// AUDIO AU19 (J299, J304): DOWNLOAD fetches exactly the audio a shard names. For each pinned shard, the `/assets/music/**`
// and `/assets/sfx/**` recordings in its cooked `client-phone` and `grid-phone` manifests are AU18's derived engine music, the
// default boot effects (including authored sample overlays), and the shard's fence audio: nothing more, no row twice,
// and no engine style but the one. A shard with no recorded music (Dunes, Far Reach) has no engine music row.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned products and own the cook's folder.
import { existsSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import type { SpawnManifestBook } from '../src/cook/game/entryTotals';
import { readBuiltSpawnManifest } from '../src/cook/game/engineHalf';
import { openShardfile, shardHalf } from '../src/cook/game/shardCook';
import { folderTarball } from '../src/cook/game/folderTarball';
import { defaultBootAudio, ENGINE_MUSIC_STYLE, engineMusicFiles, musicDir } from '../src/shared/engine/audio/bootAudio';
import { withAssetTables, type AssetTables } from '../src/shared/engine/boot/tables';
import { cookFilesOnly } from './filesOnlyCook';

// Driftwood, Pine, Nalati, Nine Dragon, one Open Plot, Dunes and Far Reach, each with its engine music's file count
// (AU18's derived list: title, its base slot's calm and tension, its stings). Counts, not names: a re-encode renames.
const SHARDS = [['driftwood-isle', 4], ['pine-hollow', 6], ['nalati-grasslands', 4], ['nine-dragon-stack', 1],
  ['open-plot-alien-plain', 1], ['sunscar-dunes', 0], ['far-reach', 0]] as const;
// SF24: an images-only zone mounts its own audio under its slug (/assets/<slug>/sfx/...), beside the engine's.
const AUDIO = /^\/assets\/(?:[a-z0-9-]+\/)?(?:music|sfx)\/[^?]+\.(?:m4a|mp3|ogg|opus|wav|webm|flac)$/u;
const AUDIO_BANK = /^\/assets\/(?:[a-z0-9-]+\/)?(music|sfx)\/([^/]+)\/\1\.json$/u;
const path = (url: string): string => url.split('?')[0] ?? url;
// The pinned products (`pnpm pins`, as CI's test jobs install them); the boot tables are baked here, never read stale.
const have = SHARDS.every(([shard]) => existsSync(`out/${shard}/shard.json`));

/** The audio a manifest lists that `want` lacks, the files of `want` it lacks, and any file it lists twice. */
function audioDiff(listed: readonly string[], want: readonly string[]): { extra: string[]; missing: string[]; twice: string[] } {
  const all = listed.map(path).filter(url => AUDIO.test(url)), rows = new Set(all), wanted = new Set(want);
  return { extra: [...rows].filter(url => !wanted.has(url)).sort(), missing: [...wanted].filter(url => !rows.has(url)).sort(),
    twice: [...new Set(all.filter((url, at) => all.indexOf(url) !== at))].sort() };
}
const clean = { extra: [], missing: [], twice: [] };

// The shard's own words, read without the cook: the selected boot recordings and the recorded fence mounts.
function expected(shard: string, common: AssetTables): { want: string[]; engineMusic: string[] } {
  const half = shardHalf(openShardfile(folderTarball(`out/${shard}`)), (_url, bytes) => bytes.length);
  const row = half.shard.sections.get('audio/audio') as { audio: AudioData } | undefined, data = row?.audio;
  const shipped = (url: string): boolean => Object.hasOwn(common.bytes, url);
  const engineMusic = data === undefined ? [] : withAssetTables(common, () => engineMusicFiles(data));
  const boot = data?.music === undefined || data.samples === undefined ? [] : withAssetTables(common, () => defaultBootAudio(data));
  // Every own audio mount ships: one the build lacks would drop from both sides and hide a missing row.
  const mounts = half.mountRows('phone', 'entry').map(mount => path(mount.url));
  const own = mounts.filter(url => AUDIO.test(url));
  expect(own.filter(url => !shipped(url)), `${shard}: own audio mounts the build lacks`).toEqual([]);
  // Prepared shards can mount the source JSON. LOAD uses the copy in the boot tables.
  for (const url of mounts) {
    const bank = AUDIO_BANK.exec(url);
    const name = bank?.[2];
    if (name === undefined) continue;
    const manifests = bank?.[1] === 'music' ? common.music : common.sfx;
    expect(Object.hasOwn(manifests, name), `${shard}: missing boot audio bank ${url}`).toBe(true);
  }
  return { want: [...new Set([...boot, ...own])].sort(), engineMusic: engineMusic.sort() };
}

let root = '', output = '', book: SpawnManifestBook | undefined, common: AssetTables | undefined;
beforeAll(async () => {
  if (!have) return;
  // A build root: this checkout's boot tables, baked as src/scripts/app-build/assetTables.mjs does, the products and public/.
  ({ root, output, book, common } = await cookFilesOnly(SHARDS.map(([shard]) => shard), 'download-audio-list'));
}, 120_000);
afterAll(() => { if (root !== '') rmSync(root, { recursive: true, force: true }); });

for (const [shard, engineFiles] of SHARDS) {
  test.skipIf(!have)(`${shard}: DOWNLOAD lists exactly its derived engine music, the boot effects and its own audio`, () => {
    if (common === undefined) throw new Error('no boot tables');
    const tables = common, { want, engineMusic } = expected(shard, tables);
    expect(engineMusic).toHaveLength(engineFiles);
    for (const address of [book?.client[shard]?.phone, book?.grid['000']?.[shard]?.phone]) {
      if (address === undefined) throw new Error(`${shard}: no phone manifest`);
      const listed = readBuiltSpawnManifest(output, address).files.map(row => row.url);
      expect(audioDiff(listed, want), address.url).toEqual(clean);
      // The engine's music rows are AU18's list alone, all in the one style; no other style's folder appears.
      const music = listed.map(path).filter(url => url.startsWith('/assets/music/'));
      const dir = withAssetTables(tables, () => musicDir(ENGINE_MUSIC_STYLE));
      expect(music.filter(url => url.startsWith(dir)).sort()).toEqual(engineMusic);
      expect(music.filter(url => /^\/assets\/music\/(?:[a-z0-9-]+-)?(?:folk|orchestral)\//u.test(url))).toEqual([]);
      // The comparison bites each way: one more shipped recording, one fewer, or one twice fails it (the cook-side proof:
      // project/journal/2026-11-13-download-audio-list.md).
      const extra = Object.keys(tables.bytes).find(url => AUDIO.test(url) && !want.includes(url)), gone = want[0];
      if (extra === undefined) throw new Error('the build ships no recording outside this shard\'s list');
      expect(audioDiff([...listed, `${extra}?v=12345678`], want)).toEqual({ ...clean, extra: [extra] });
      if (gone !== undefined) {
        expect(audioDiff(listed.filter(url => path(url) !== gone), want)).toEqual({ ...clean, missing: [gone] });
        expect(audioDiff([...listed, `${gone}?v=87654321`], want)).toEqual({ ...clean, twice: [gone] });
      }
    }
  });
}

// @vitest-environment happy-dom
// AUDIO AU2 (J299, QA 11-12 row 36: Jake on bad LTE sat 34 s on "Read audio 7 / 91"): LOAD reads a shard's boot audio from
// the spawn download's copy (its part, memory or the page's store), never with `fetch`, so a warm visit with audio cut
// off, or a slow link, finishes LOAD's `audio` step with no network audio read. The prefetch queue no longer carries the
// audio either, and LOAD has no `Read audio i / n` wait.
import { afterEach, expect, test, vi } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import { createCatalogueAudio, type LevelAudioBank, type LevelAudioProfile } from '../src/client/engine/audio/levelAudio';
import { bootFiles, extraFetches, startAudioPreload, useDownloadAudio } from '../src/client/engine/boot/extras';
import { defaultBootAudio } from '../src/shared/engine/audio/bootAudio';
import { installAssetTables, type AssetTables } from '../src/shared/engine/boot/tables';
import { loadingWaitState } from '../src/shared/engine/boot/loadingWaits';
import { PUBLIC_BYTES } from '../src/client/game/boot/bytes.generated';
import { ASSET_VERSIONS } from '../src/client/game/boot/versions.generated';
import { MUSIC_MANIFESTS, SFX_MANIFESTS } from '../src/client/game/boot/audio.generated';

const blank = { sky: [], baked: [], terrain: [], trees: [], cabins: [], props: [], physics: [], art: [], music: [], sfx: [] };
const level = { slug: 'driftwood-isle', card: { thumb: 'data:,', portrait: 'data:,', landscape: 'data:,' }, boot: { files: [], sources: () => blank } } as never;
const tables: AssetTables = { bytes: PUBLIC_BYTES, versions: ASSET_VERSIONS, music: MUSIC_MANIFESTS, sfx: SFX_MANIFESTS, packs: {} };
// Driftwood's shape (AU1's cook test): the title and its island slot, the island bed, sample overlay.
const driftwood = { music: { bootSlots: ['title', 'island'], controlTension: 'late' },
  samples: { bed: 'island', set: 'fixture-isle', loopGains: { island: 0.5 },
    catalogue: { inventoryOmitSlots: [], loopOrder: [], overlaySamples: true, ownMusic: false, priorityOwn: false } } } as unknown as AudioData;
const bank: LevelAudioBank = { title: undefined, score: { slots: new Map(), stings: new Map() }, cues: { loops: new Map(), shots: new Map() } };
const AUDIO = /\/assets\/(?:music|sfx)\/|\/blobs\/audio\//u;

afterEach(() => { useDownloadAudio(null); vi.restoreAllMocks(); });

test('a warm visit with the network cut for audio finishes LOAD audio from the download, with no fetch and no Read audio wait', async () => {
  installAssetTables(tables);
  const listed = new Set(defaultBootAudio(driftwood));
  expect(listed.size).toBeGreaterThan(10);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return AUDIO.test(url) ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(new Uint8Array([0])));
  });
  const held: string[] = [];
  useDownloadAudio({ listed: url => listed.has(url), read: url => { held.push(url); return Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } });
  const catalogue = await createCatalogueAudio(driftwood);
  const read: string[] = [];
  // Driftwood's own selection; the decode is stubbed (no OfflineAudioContext here) but reads every boot file, as it does.
  const profile: LevelAudioProfile = { ...catalogue, decode: async (style, readFile) => {
    for (const url of catalogue.bootFiles(style)) { expect([...new Uint8Array(await readFile(url))]).toEqual([1, 2, 3]); read.push(url); }
    return bank;
  } };
  const files = bootFiles(level, 'img', profile, false);
  const audio = [...files.music, ...files.sfx];
  expect(audio.length).toBeGreaterThan(10);
  expect(audio.every(url => listed.has(url))).toBe(true);
  // The prefetch queue no longer carries the audio: DOWNLOAD fetched it.
  expect(extraFetches(files).filter(url => AUDIO.test(url))).toEqual([]);
  const step = startAudioPreload(files, level, profile).wait({ set: () => undefined, detail: () => undefined });
  const outcome = await Promise.race([step.then(() => 'finished'), new Promise(resolve => { setTimeout(() => { resolve('stalled'); }, 2000); })]);
  const waits = [...loadingWaitState().pending.values()].map(row => row.label);
  expect({ outcome, waits: waits.filter(label => /Read audio/u.test(label)) }).toEqual({ outcome: 'finished', waits: [] });
  expect(fetch.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input)).filter(url => AUDIO.test(url))).toEqual([]);
  expect(new Set(held)).toEqual(new Set(audio));
  expect(read.length).toBeGreaterThan(10);
});

test('a file the download does not list (an older product) is still read from the network, once', async () => {
  installAssetTables(tables);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(new Uint8Array([4, 5]))));
  useDownloadAudio({ listed: () => false, read: () => Promise.resolve(null) });
  const catalogue = await createCatalogueAudio(driftwood);
  const files = bootFiles(level, 'img', catalogue, false), audio = [...files.music, ...files.sfx];
  const profile: LevelAudioProfile = { ...catalogue, decode: async (style, readFile) => { for (const url of catalogue.bootFiles(style)) await readFile(url); return bank; } };
  await startAudioPreload(files, level, profile).wait({ set: () => undefined, detail: () => undefined });
  expect(new Set(fetch.mock.calls.map(([input]) => String(input)))).toEqual(new Set(audio));
  expect(fetch).toHaveBeenCalledTimes(audio.length);
});

test('a listed copy that fails its check, or a read that throws, is fetched instead of falling silent', async () => {
  installAssetTables(tables);
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(new Uint8Array([6]))));
  const catalogue = await createCatalogueAudio(driftwood);
  const files = bootFiles(level, 'img', catalogue, false), [bad, broken] = [...files.music, ...files.sfx];
  useDownloadAudio({ listed: () => true, read: url => url === bad ? Promise.resolve(null) : url === broken ? Promise.reject(new Error('quota')) : Promise.resolve(new Uint8Array([1]).buffer) });
  const seen = new Map<string, number[]>();
  const profile: LevelAudioProfile = { ...catalogue, decode: async (style, readFile) => {
    for (const url of catalogue.bootFiles(style)) seen.set(url, [...new Uint8Array(await readFile(url))]);
    return bank;
  } };
  await startAudioPreload(files, level, profile).wait({ set: () => undefined, detail: () => undefined });
  expect(fetch.mock.calls.map(([input]) => String(input)).sort()).toEqual([bad, broken].sort());
  expect([seen.get(bad ?? ''), seen.get(broken ?? '')]).toEqual([[6], [6]]);
});

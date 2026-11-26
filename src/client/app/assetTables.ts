import { installAssetTables, publicBytes, assetVersions, musicManifests, sfxManifests, bootPacks, type AssetTables, type PackDef, type PackFile, type PackPart } from '@wildshard/engine/boot/tables';
import { readContent } from '@wildshard/engine/boot/contentRead';
import { contentURL } from '@wildshard/engine/boot/contentBase';
import { prepareBootImports } from './bootDownloads';
import { ZONE_DIR, audioManifestRow } from '@wildshard/engine/boot/zoneAssets';

/** Exact compiler address consumed by the existing size/hash-verified table reader. */
export interface AssetTableAddress { readonly url: string; readonly bytes: number; readonly sha256: string }
declare const __BOOT_TABLE_ASSETS__: { readonly common: AssetTableAddress; readonly all: AssetTableAddress; readonly packs: Readonly<Record<string, AssetTableAddress>> };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const size = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const files = (value: unknown): value is readonly PackFile[] => Array.isArray(value) && value.every((row: unknown) => Array.isArray(row) && row.length === 4
  && typeof row[0] === 'string' && size(row[1]) && size(row[2]) && typeof row[3] === 'string');
const parts = (value: unknown): value is readonly PackPart[] => Array.isArray(value) && value.every((row: unknown) => record(row)
  && typeof row['url'] === 'string' && size(row['bytes']) && files(row['files']));
const pack = (value: unknown): value is PackDef => record(value) && size(value['bytes']) && files(value['files']) && parts(value['parts']);
function tables(value: unknown): value is AssetTables {
  return record(value) && record(value['bytes']) && Object.values(value['bytes']).every(size)
    && record(value['versions']) && Object.values(value['versions']).every(row => typeof row === 'string')
    && record(value['music']) && record(value['sfx']) && record(value['packs'])
    && Object.values(value['packs']).every(row => record(row) && Object.values(row).every(pack));
}
/** Selection owns this read, before any gameplay module can read synchronous tables.
 * Exact build bytes cross the boundary atomically; partial/corrupt input never installs. */
export async function readAssetTables(address: AssetTableAddress, read: (url: string, init?: RequestInit) => Promise<Response>): Promise<AssetTables> {
  if (!/^\/assets\/boot-tables-[a-f0-9]{8}\.json$/u.test(address.url) || !/^[a-f0-9]{64}$/u.test(address.sha256)
    || !address.url.includes(address.sha256.slice(0, 8)) || !size(address.bytes) || address.bytes < 2 || address.bytes > 16 * 1024 * 1024) throw new Error('Invalid asset table address');
  // PAGE-SIZE PZ13: the tables are content, read from the content base when the boot bank names one
  const wire = await readContent(address.url, address.bytes, {fetch: (url, init) => Object.keys(init).length === 0 ? read(contentURL(url)) : read(contentURL(url), init)});
  if (wire.length !== address.bytes) throw new Error('Asset table size differs');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wire.buffer));
  if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') !== address.sha256) throw new Error('Asset tables differ from the build');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire));
  if (!tables(parsed)) throw new Error('Invalid asset tables');
  return parsed;
}
let pending: Promise<void> | undefined;
async function load(): Promise<void> {
  try {
    const address = __BOOT_TABLE_ASSETS__.common;

    const line = document.querySelector<HTMLElement>('.ws-load [data-el="line"]');
    if (line !== null) line.textContent = 'Reading download inventory';
    installAssetTables(await readAssetTables(address, (url, init) => fetch(url, init)));
  } catch (error) { pending = undefined; throw error; }
}
export function prepareAssetTables(): Promise<void> {
  pending ??= load();
  return pending;
}

const packReads = new Map<string, Promise<AssetTables>>();
async function loadPacks(address: AssetTableAddress): Promise<AssetTables> {
  try {
    return await readAssetTables(address, (url, init) => fetch(url, init));
  } catch (error) { packReads.delete(address.url); throw error; }
}
/** Before session data or background downloads can call packFor. A grid/desktop
 * page borrows the complete pack bank; a standalone phone borrows only its own. */
async function readPackTables(key?: string): Promise<AssetTables | undefined> {
  await prepareAssetTables();
  const address = key === undefined ? __BOOT_TABLE_ASSETS__.all : __BOOT_TABLE_ASSETS__.packs[key];
  if (address === undefined) return undefined; // The original packFor returns null for an unpacked shard.
  let reading = packReads.get(address.url);
  if (reading === undefined) { reading = loadPacks(address); packReads.set(address.url, reading); }
  return reading;
}
/** Begin verified metadata IO alongside memory reservation, but publish only
 * when the caller crosses its original admission barrier. Early failures are
 * captured until that barrier and cannot become an unhandled rejection. */
export function prepareAssetPackRead(key?: string): { readonly ready: () => Promise<void> } {
  const read = prepareBootImports(readPackTables(key));
  let installed = false;
  return { ready: async () => {
    const incoming = await read.ready();
    if (incoming === undefined || installed) return;
    installAssetTables({ bytes: publicBytes(), versions: assetVersions(), music: musicManifests(), sfx: sfxManifests(),
      packs: { ...bootPacks(), ...incoming.packs } });
    installed = true;
  } };
}
export async function prepareAssetPacks(key?: string): Promise<void> {
  await prepareAssetPackRead(key).ready();
}

/** The cook mounts an inline candidate's descriptor names (`cook.json`'s `mounts`: URL and bytes), each once. */
export function inlineMountBytes(cook: unknown): Record<string, number> {
  const rows: unknown = record(cook) ? cook['mounts'] : undefined, out: Record<string, number> = {};
  if (!Array.isArray(rows)) throw new Error('Inline candidate cook has no mounts');
  for (const row of rows as unknown[]) {
    if (!record(row) || typeof row['url'] !== 'string' || !row['url'].startsWith('/') || row['url'].split('/').includes('..') || !size(row['bytes'])) throw new Error('Invalid inline candidate mount');
    out[row['url']] = row['bytes'];
  }
  return out;
}
/** SHARD-AUTHORING SA15 / SA43 (MEMORY-GATES MG9): `wildshard dev` and `wildshard prepare` serve the inline candidate's cook
 * mounts at their URLs beside the page, but this build's tables list only its pinned revisions' files. A candidate whose cook
 * made a file the pin lacks (S12d's phone ASTC 6x6 KTX2s) refused at level.data ("declares … but public/assets has no such
 * file"), so prepare timed out at 240 s. The candidate's mounts join the byte table; a draft with no cook adds nothing. */
export async function adoptInlineMounts(descriptor: unknown, base: string, read: (url: string) => Promise<Response> = url => fetch(url)): Promise<number> {
  const cook: unknown = record(descriptor) ? descriptor['cook'] : undefined;
  if (!record(cook) || typeof cook['path'] !== 'string') return 0;
  const response = await read(new URL(cook['path'], base).href);
  if (!response.ok) throw new Error(`Inline candidate cook unreadable: ${String(response.status)}`);
  const added = inlineMountBytes(await response.json());
  // SHARD-COMPAT SM8: the build's music and sfx tables list only pinned shards, so a candidate no pin names (the retired
  // showcase template, a new shard) refused at level.play ("Scene cue bank requires its credit") and prepare timed out at
  // 240 s. The candidate's own mounted music.json and sfx.json join those tables, minus their provenance, as gen.ts
  // compiles them; the candidate's copy wins over a pinned one, since the mounts served beside the page are its own.
  const music: Record<string, unknown> = { ...musicManifests() }, sfx: Record<string, unknown> = { ...sfxManifests() };
  for (const url of Object.keys(added)) {
    // SF4: an engine-wide /assets/<kind>/<key>/ manifest or a zone's own /assets/<slug>/<kind>/<key>/ one (boot/zoneAssets.ts)
    const audio = audioManifestRow(url);
    if (audio === null) continue;
    const manifestResponse = await read(new URL(url, base).href);
    if (!manifestResponse.ok) throw new Error(`Inline candidate ${url} unreadable: ${String(manifestResponse.status)}`);
    const manifest: unknown = await manifestResponse.json();
    if (!record(manifest)) throw new Error(`Inline candidate ${url} is not a manifest`);
    (audio.kind === 'music' ? music : sfx)[audio.key] = { ...Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'provenance' && key !== 'synth_keeps')),
      ...audio.dir === undefined ? {} : { [ZONE_DIR]: audio.dir } };
  }
  installAssetTables({ bytes: { ...publicBytes(), ...added }, versions: assetVersions(), music, sfx, packs: bootPacks() });
  return Object.keys(added).length;
}

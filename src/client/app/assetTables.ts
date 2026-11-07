import { installAssetTables, publicBytes, assetVersions, musicManifests, sfxManifests, bootPacks, type AssetTables, type PackDef, type PackFile, type PackPart } from '@wildshard/engine/boot/tables';
import { readContent } from '@wildshard/engine/boot/contentRead';

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
  const wire = await readContent(address.url, address.bytes, {fetch: (url, init) => Object.keys(init).length === 0 ? read(url) : read(url, init)});
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

const packReads = new Map<string, Promise<void>>();
async function loadPacks(address: AssetTableAddress): Promise<void> {
  try {

    const incoming = await readAssetTables(address, (url, init) => fetch(url, init));
    installAssetTables({ bytes: publicBytes(), versions: assetVersions(), music: musicManifests(), sfx: sfxManifests(),
      packs: { ...bootPacks(), ...incoming.packs } });
  } catch (error) { packReads.delete(address.url); throw error; }
}
/** Before session data or background downloads can call packFor. A grid/desktop
 * page borrows the complete pack bank; a standalone phone borrows only its own. */
export async function prepareAssetPacks(key?: string): Promise<void> {
  await prepareAssetTables();
  const address = key === undefined ? __BOOT_TABLE_ASSETS__.all : __BOOT_TABLE_ASSETS__.packs[key];
  if (address === undefined) return; // The original packFor returns null for an unpacked shard.
  let reading = packReads.get(address.url);
  if (reading === undefined) { reading = loadPacks(address); packReads.set(address.url, reading); }
  await reading;
}

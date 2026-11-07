export interface AssetTableAddress { readonly url: string; readonly bytes: number; readonly sha256: string }
export interface AssetTableAsset { readonly fileName: string; readonly source: string; readonly address: AssetTableAddress }
export interface AssetTableBanks { readonly common: AssetTableAsset; readonly all: AssetTableAsset; readonly packs: Readonly<Record<string, AssetTableAsset>> }
/** The baked banks' path under the repo root (gitignored). */
export const ASSET_TABLES: string;
/** Move the exact generated values across a JSON transport, not into compiled JS. */
export function assetTableAsset(source: string): AssetTableAsset;
/** Selected homes include their own late-audio parts, including unpacked homes. */
export function selectedPackTables(packs: Readonly<Record<string, unknown>>, homes: readonly string[]): Record<string, string>;
/** Common URL/tier/audio facts are shared; each selected pack bank has its own bytes. */
export function assetTableBanks(source: string): AssetTableBanks;
/** Serialize the boot tables into ASSET_TABLES. */
export function bakeAssetTables(root: string): void;
/** The baked banks (throws when the app build has not serialized them). */
export function readAssetTables(root: string): AssetTableBanks;
/** `__BOOT_TABLE_ASSETS__`: each bank's address. */
export function assetTableAddresses(banks: AssetTableBanks): { readonly common: AssetTableAddress; readonly all: AssetTableAddress; readonly packs: Readonly<Record<string, AssetTableAddress>> };
/** Write each bank's exact bytes once as its hashed asset into `outDir`. */
export function writeAssetTables(outDir: string, root: string): void;

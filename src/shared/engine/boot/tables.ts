/**
 * The app's asset tables (E405 E415): every shipped file's size and content hash, the music and sound-effect
 * manifests, and each level's boot pack. They list the game's own files (every shard's folders), so they are the
 * game's: scripts/app-build/gen.ts and scripts/bake-packs.mjs write them to src/client/game/boot/*.generated.ts, and the page entry
 * fetches them after selection, before gameplay imports (a Node bake gets them through
 * scripts/bake-loader.mjs). The engine reads them through these accessors, never by importing a table.
 *
 * Like the identity, they sit in one global slot, so a test that resets its modules still sees them; nothing has a
 * default (an empty table would make every declared boot file look missing).
 */

/** one packed file: its path, its offset in the part, its size and its content-type */
export type PackFile = readonly [path: string, offset: number, size: number, type: string];
export interface PackPart { readonly url: string; readonly bytes: number; readonly files: readonly PackFile[] }
/** a level's boot pack for one tier, in content-addressed parts (src/client/engine/boot/pack.ts) */
export interface PackDef { readonly parts: readonly PackPart[]; readonly bytes: number; readonly files: readonly PackFile[] }

export interface AssetTables {
  /** every file under public/assets: URL path → bytes */
  readonly bytes: Readonly<Record<string, number>>;
  /** URL path → content hash (`?v=`), for the files whose names are not content-addressed */
  readonly versions: Readonly<Record<string, string>>;
  /** music style → its music.json, sound-effect set → its sfx.json (provenance stripped) */
  readonly music: Readonly<Record<string, unknown>>;
  readonly sfx: Readonly<Record<string, unknown>>;
  /** level slug → tier → its boot pack */
  readonly packs: Readonly<Record<string, Readonly<Record<string, PackDef>>>>;
}

const SLOT = Symbol.for('engine.asset-tables');
const isTables = (v: unknown): v is AssetTables => typeof v === 'object' && v !== null && 'bytes' in v && 'packs' in v;
export function installAssetTables(value: AssetTables): void { Reflect.set(globalThis, SLOT, value); }
function tables(): AssetTables {
  const v: unknown = Reflect.get(globalThis, SLOT);
  if (!isTables(v)) throw new Error('No asset tables installed: selected-entry preparation installs them first');
  return v;
}
export const publicBytes = (): Readonly<Record<string, number>> => tables().bytes;
export const assetVersions = (): Readonly<Record<string, string>> => tables().versions;
export const musicManifests = (): Readonly<Record<string, unknown>> => tables().music;
export const sfxManifests = (): Readonly<Record<string, unknown>> => tables().sfx;
export const bootPacks = (): AssetTables['packs'] => tables().packs;

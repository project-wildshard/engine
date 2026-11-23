/** SHARD-COMPAT SP1b2: a cook preparation sidecar. When a stored shard's author preparation was recorded on another
 * renderer (spec 3, `stale`), the box's cook may record it again on its own renderer (headless WebKit, the recorder
 * `wildshard prepare` runs) and keep the result beside the original, never inside it: the original stays the author's,
 * signed and unchanged. A cook that finds a sidecar for its renderer and the same inputs cooks by it (`prepared by cook`);
 * one for another renderer or other inputs is a miss, and one whose bytes don't hold is corrupt. Either way the cook
 * falls back to the author's stale lists, as before (SP1a). */
import {readCookData, type CookData} from '@wildshard/format/cookData';
import {requireCookPreparation} from '@wildshard/format/cookPreparation';
import type {OutputIndex} from '@wildshard/format/outputIndex';

/** The sidecar's bytes: its `cook.json` and the mounts it names that the original lacks or holds differently. */
export interface CookSidecar {readonly cook: Uint8Array; readonly mounts: ReadonlyMap<string, Uint8Array>}
/** What became of a sidecar: `hit` cooks by it, `miss` and `corrupt` fall back to the author's preparation. */
export type SidecarOutcome =
  | {readonly kind: 'hit'; readonly cook: CookData; readonly mounts: ReadonlyMap<string, Uint8Array>}
  | {readonly kind: 'miss' | 'corrupt'; readonly reason: string};

/** The line every entry point prints for a cook that took the sidecar, so `grep 'prepared by cook'` finds them all. */
export const cookPreparedLine = (slug: string): string => `prepared by cook: ${slug}`;
/** The line for a sidecar the cook could not take. */
export const sidecarRefusedLine = (slug: string, outcome: Extract<SidecarOutcome, {kind: 'miss' | 'corrupt'}>): string =>
  `cook preparation ${outcome.kind}: ${slug}: ${outcome.reason}`;

function parsed(bytes: Uint8Array): CookData | undefined {
  try { return readCookData(JSON.parse(new TextDecoder().decode(bytes))); } catch { return undefined; }
}

/** Every mount the sidecar names, from the sidecar or else the original, each held to its listed size and hash. */
function mountsHeld(cook: CookData, sidecar: CookSidecar, original: (path: string) => Uint8Array | undefined, hash: (bytes: Uint8Array) => string): string | undefined {
  for (const mount of cook.mounts) {
    const bytes = sidecar.mounts.get(mount.path) ?? original(mount.path);
    if (bytes === undefined || bytes.length !== mount.bytes || hash(bytes) !== mount.hash) return `mount ${mount.path} does not match its listing`;
  }
  return undefined;
}

/** Whether `cook` is a whole preparation of `index`'s inputs (its inputHash, fence and program mount), or why not. */
function bound(index: OutputIndex, cook: CookData, hash: (bytes: Uint8Array) => string): string | undefined {
  try { requireCookPreparation(index, cook, hash); return undefined; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** Judge `sidecar` against the author's preparation `author` of `files.index`, for a cook on `renderer`. */
export function judgeSidecar(sidecar: CookSidecar, author: CookData, renderer: string | null, files: Readonly<{index: OutputIndex; read: (path: string) => Uint8Array | undefined; hash: (bytes: Uint8Array) => string}>): SidecarOutcome {
  const cook = parsed(sidecar.cook);
  if (cook === undefined) return {kind: 'corrupt', reason: 'its cook.json does not read'};
  if (cook.version !== 3 || author.version !== 3) return {kind: 'miss', reason: 'only a spec 3 preparation names a renderer'};
  if (renderer === null || cook.renderer !== renderer) return {kind: 'miss', reason: `recorded on ${cook.renderer.slice(0, 12)}, not this renderer`};
  const broken = bound(files.index, cook, files.hash) ?? mountsHeld(cook, sidecar, files.read, files.hash);
  return broken === undefined ? {kind: 'hit', cook, mounts: sidecar.mounts} : {kind: 'corrupt', reason: broken};
}

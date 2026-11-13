// SA33's placement file, read by both ends: the box (`src/server/host/dedicated/placementFile.ts`, Node's key check) and a released page
// (`src/client/game/grid/placedCells.ts`, WebCrypto). Game layer, so the page's grid code may read it.
import * as v from 'valibot';
/** SA33's placement file (`releases/<channel>-placements.json`), as the API signs it under its own placement key: every cell the API
 *  placed on one channel, in its grid's order. Read by both ends, as the release file is: the box by Node's key check
 *  (`placementFile.ts`), a released page by WebCrypto (`src/client/game/grid/placedCells.ts`). */
export interface PlacementFile {
  /** Which kind of signed file this is, so a body can never be read as another kind's. */
  readonly kind: 'placement';
  readonly channel: 'production' | 'staging';
  /** Rises with every write; an older file is never believed (J179). */
  readonly serial: number;
  /** SA47: `hash` is the channel pointer's shardfile (the raw upload), so a box whose build's book lacks the slug opens it from the
   *  cook's `index/<build>/<hash>.json`. A file from before SA47 names none. */
  readonly cells: readonly { readonly instance: string; readonly slug: string; readonly cell: readonly [number, number]; readonly hash?: string }[];
}
const placedId = v.pipe(v.string(), v.regex(/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u), v.maxLength(64));
const placedSpot = v.pipe(v.number(), v.integer());
const placedHash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u));
/** A placement file's body, once its signature has held. The spot's bounds are `placeCell`'s. */
export const PlacementSchema: v.GenericSchema<PlacementFile> = v.object({ kind: v.literal('placement'), channel: v.picklist(['production', 'staging']), serial: v.pipe(v.number(), v.integer(), v.minValue(0)),
  cells: v.pipe(v.array(v.object({ instance: placedId, slug: placedId, cell: v.tuple([placedSpot, placedSpot]), hash: v.exactOptional(placedHash) })), v.maxLength(49)) });
/** The file on R2: the body as signed, and its signature in hex (as the release file's, `releaseRows.ts`). */
export const SignedPlacementSchema: v.GenericSchema<{ readonly body: string; readonly signature: string }> = v.object({ body: v.string(), signature: v.string() });
/** The API's placement key (SA33a, `~/.config/wildshard/placement-signing-key.pub.pem`), SPKI DER in hex: the box's PLACEMENT_PUBLIC_KEY. */
export const PLACEMENT_PUBLIC_KEY = '302a300506032b65700321004afd39342aac6a4de6066cb72e9df54cbd3d4eb522e5e6e175a17954ab98f25e';
/** A channel's placement file beside its release file: `…/releases/staging.json` → `…/releases/staging-placements.json`. Null for
 *  any other address, and for preview, whose page bakes staging's cells at deploy instead (SA35). */
export function placementsURL(release: string): string | null {
  let url: URL;
  try { url = new URL(release); } catch { return null; }
  const channel = /^\/releases\/(staging|production)\.json$/u.exec(url.pathname)?.[1];
  if (channel === undefined || url.search !== '' || url.hash !== '') return null;
  url.pathname = `/releases/${channel}-placements.json`;
  return url.href;
}

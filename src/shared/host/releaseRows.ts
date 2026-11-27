// J171: what a signed release file says, read by both ends. The server checks a signature with Node's key check, a page with WebCrypto.
import * as v from 'valibot';

/** What a release file says. */
export interface ReleaseFile {
  readonly channel: 'production' | 'staging' | 'preview';
  /** Rises with every write: an older file is never served, because we only fix forward (J179). */
  readonly serial: number;
  /** Names the build's folder and its server book. */
  readonly engineBuild: string;
  readonly saveEpoch: number;
  /** `revision` is the api-server's integer upload number (R2 layout RL12 renames it); `shardVersion` the raw `X.Y.Z` (J524), which
   *  fix preview PV2's zone table keys the cooked index by. A release from before PV2 names none. */
  readonly shards: readonly { readonly slug: string; readonly revision: number; readonly shardVersion?: string }[];
  /** Fix preview PV1, PV2: the cook version and cook hash this build's cook writes under
   *  (`shards/<slug>/<shardVersion>/cooks/<cookVersion>/<cookHash>/`), so preview takes staging's cook as its pack key and refuses a
   *  skew. A release from before PV2 names none. */
  readonly cook?: { readonly version: string; readonly hash: string };
  /** The server bundle: its path under `BUNDLE_ORIGIN` and its SHA-256. `src/scripts/vps/pull.mjs` reads this, and a bad hash moves nothing (E7.2c). */
  readonly bundle?: { readonly name: string; readonly sha256: string };
  /** The address clients dial. For the first sitting this is the quick tunnel's name (C22). */
  readonly socket?: string;
  /** Q37: immutable native item data, copied from the API before this release is signed. */
  readonly items?: { readonly path: string; readonly sha256: string; readonly bytes: number };
}
const Whole = v.pipe(v.number(), v.integer(), v.minValue(0));
const Semver = v.pipe(v.string(), v.regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u));
const CookVersion = v.pipe(v.string(), v.regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u, 'Invalid cook version'));
/** A release file's body, once its signature has held. */
export const ReleaseSchema: v.GenericSchema<ReleaseFile> = v.object({ channel: v.picklist(['production', 'staging', 'preview']), serial: Whole, engineBuild: v.pipe(v.string(), v.minLength(1)), saveEpoch: v.pipe(Whole, v.minValue(1)), shards: v.array(v.object({ slug: v.string(), revision: Whole, shardVersion: v.exactOptional(Semver) })),
  cook: v.exactOptional(v.strictObject({ version: CookVersion, hash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)) })),
  bundle: v.exactOptional(v.object({ name: v.pipe(v.string(), v.minLength(1)), sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u)) })), socket: v.exactOptional(v.string()),
  items: v.exactOptional(v.pipe(v.strictObject({ path: v.pipe(v.string(), v.regex(/^assets\/catalogue\/items-[0-9a-f]{64}\.json$/u)), sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u)), bytes: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(1_048_576)) }), v.check(row => row.path === `assets/catalogue/items-${row.sha256}.json`, 'Item catalogue digest and path disagree'))) });
/** The file on R2: the body as signed, and its signature in hex (C20). */
export const SignedSchema: v.GenericSchema<{ readonly body: string; readonly signature: string }> = v.object({ body: v.string(), signature: v.string() });

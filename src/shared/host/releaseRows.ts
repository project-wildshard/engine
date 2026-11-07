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
  readonly shards: readonly { readonly slug: string; readonly revision: number }[];
  /** The server bundle: its path under `BUNDLE_ORIGIN` and its SHA-256. `scripts/vps/pull.mjs` reads this, and a bad hash moves nothing (E7.2c). */
  readonly bundle?: { readonly name: string; readonly sha256: string };
  /** The address clients dial. For the first sitting this is the quick tunnel's name (C22). */
  readonly socket?: string;
}
const Whole = v.pipe(v.number(), v.integer(), v.minValue(0));
/** A release file's body, once its signature has held. */
export const ReleaseSchema: v.GenericSchema<ReleaseFile> = v.object({ channel: v.picklist(['production', 'staging', 'preview']), serial: Whole, engineBuild: v.pipe(v.string(), v.minLength(1)), saveEpoch: v.pipe(Whole, v.minValue(1)), shards: v.array(v.object({ slug: v.string(), revision: Whole })),
  bundle: v.exactOptional(v.object({ name: v.pipe(v.string(), v.minLength(1)), sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u)) })), socket: v.exactOptional(v.string()) });
/** The file on R2: the body as signed, and its signature in hex (C20). */
export const SignedSchema: v.GenericSchema<{ readonly body: string; readonly signature: string }> = v.object({ body: v.string(), signature: v.string() });

import * as v from 'valibot';

const Text = v.pipe(v.string(), v.nonEmpty());
const Count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
export const ZONE_SELECT_PRESS_PATH = '/zone-select/enter';
export interface ZoneSelectCard {
  readonly slug: string;
  readonly name: string;
  readonly status: string | null;
  readonly heroHash: string | null;
  readonly firstUploadedAt: string | null;
  readonly enters: number;
}

export interface ZoneSelectDocument {
  readonly channel: 'staging' | 'production' | 'preview';
  readonly serial: number;
  readonly featured: readonly ZoneSelectCard[];
  readonly popular: readonly ZoneSelectCard[];
  readonly new: readonly ZoneSelectCard[];
  readonly all: readonly ZoneSelectCard[];
}

/** QA 11-23-b row 26 (J453, J493, J498): a placeholder open plot, a tooling proof, a private `_` slug, a retired slug or a test
 *  shard. It may hold a grid cell (staging v0.1.76 placed Pastel Plain and Ink-Cel Valley), but Featured, Popular, New and the
 *  title's other player lists never name it; only Developer mode's All does. api-server's grid PUT refuses the same test slugs. */
const OFF_PLAYER_LISTS = /^(?:_|open-plot-|proof-|walkin-proof|f30-clean$|blender-template$|pastel-plain$|ink-cel-valley$|cinder-orchard$)/u;
export function offPlayerLists(card: { readonly slug: string; readonly status?: string | null | undefined }): boolean {
  return card.status === 'hidden' || OFF_PLAYER_LISTS.test(card.slug);
}

const Card: v.GenericSchema<ZoneSelectCard> = v.object({
  slug: v.pipe(v.string(), v.regex(/^_?[a-z][\da-z.-]{0,127}$/u)),
  name: v.pipe(Text, v.maxLength(128)),
  status: v.nullable(Text),
  heroHash: v.nullable(v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u))),
  firstUploadedAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  enters: Count,
});

export const ZoneSelectSchema: v.GenericSchema<ZoneSelectDocument> = v.object({
  channel: v.picklist(['staging', 'production', 'preview']),
  serial: Count,
  featured: v.array(Card),
  popular: v.array(Card),
  new: v.array(Card),
  all: v.array(Card),
});

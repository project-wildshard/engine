import * as v from 'valibot';

const Text = v.pipe(v.string(), v.nonEmpty());
const Count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
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

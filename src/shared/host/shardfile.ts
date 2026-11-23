import * as v from 'valibot';
import { ShardfileSchema as GameSchema, parseShardfile as parse, parseShardfileField as parseField, shardfileRules as rules, type Shardfile as GameShardfile } from '@wildshard/format/shardSchema';
import { assertStateCompatibility as assertCompatibility } from '@wildshard/format/stateLineage';

/** Author-facing serialisable renderer-neutral shardfile contract. */
export type Shardfile = GameShardfile;
/** Author-facing strict schema, sharing the client's validator without a barrel.
 * Its explicit contract also bounds composite declaration emission as new sections are added. */
export const ShardfileSchema: v.GenericSchema<unknown, Shardfile> = v.pipe(GameSchema);
/** Parse untrusted author output using the same contract as the client. */
export function parseShardfile(input: unknown, sections?: ReadonlyMap<string, unknown>): Shardfile { return parse(input, sections); }
/** Admit one owned/cached declaration field with its defining schema (SHARD-COMPAT SI1: the format's own parser).
 * The complete assembled declaration still crosses parseShardfile's cross-field rules. */
export function parseShardfileField<Key extends keyof Shardfile>(field: Key, input: unknown): Shardfile[Key] { return parseField(field, input); }
/** Inspect semantic author errors using the client contract. */
export function shardfileRules(input: Shardfile, sections?: ReadonlyMap<string, unknown>): string[] { return rules(input, sections); }
/** Refuse saved-state identity changes between two validated revisions of the same shard. */
export function assertStateCompatibility(previous: Shardfile, next: Shardfile): void { assertCompatibility(previous, next); }

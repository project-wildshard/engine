import * as v from 'valibot';

const finite = v.pipe(v.number(), v.finite());
const pack: v.ObjectSchema<{ readonly counts: v.RecordSchema<v.StringSchema<undefined>, v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>, undefined>; readonly order: v.ArraySchema<v.StringSchema<undefined>, undefined>; }, undefined> = v.object({ counts: v.record(v.string(), finite), order: v.array(v.string()) });
/** The one inventory definition shared by legacy play and stable-instance grid wallets. */
export const inventoryKey: { key: string; scope: "shard"; version: number; schema: v.ObjectSchema<{ readonly counts: v.RecordSchema<v.StringSchema<undefined>, v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>, undefined>; readonly order: v.ArraySchema<v.StringSchema<undefined>, undefined>; }, undefined>; initial: () => v.InferOutput<typeof pack>; } = { key: 'inventory', scope: 'shard' as const, version: 1, schema: pack,
  initial: (): v.InferOutput<typeof pack> => ({ counts: {}, order: [] }) };
/** The existing local coin wire format; a profile never owns these coins. */
export const purseKey: { key: string; scope: "shard"; version: number; schema: v.SchemaWithPipe<readonly [v.SchemaWithPipe<readonly [v.NumberSchema<undefined>, v.FiniteAction<number, undefined>]>, v.MinValueAction<number, 0, undefined>]>; initial: () => number; } = { key: 'purse', scope: 'shard' as const, version: 1, schema: v.pipe(finite, v.minValue(0)), initial: (): number => 0 };

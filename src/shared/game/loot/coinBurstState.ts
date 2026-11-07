import * as v from 'valibot';

const finite = v.pipe(v.number(), v.finite());
const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(48));
const point = v.tuple([finite, finite, finite]);
const coin = v.nullable(v.strictObject({ age: v.pipe(finite, v.minValue(0)), pos: point, vel: point,
  spin: finite, spinRate: finite, value: v.pipe(finite, v.integer(), v.minValue(0)), group: count }));
interface SavedCoin { age: number; pos: [number, number, number]; vel: [number, number, number]; spin: number; spinRate: number; value: number; group: number }
export interface CoinBurstState { version: 1; coins: (SavedCoin | null)[]; groups: number[]; matrix: number[]; count: number }
const state: v.GenericSchema<CoinBurstState> = v.strictObject({ version: v.literal(1), coins: v.pipe(v.array(coin), v.length(48)),
  groups: v.pipe(v.array(v.pipe(count, v.minValue(1))), v.maxLength(48)),
  matrix: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xffffffff))), v.length(48 * 16)), count });

/** The existing pool and burst groups, with no callback, RNG or allocation authority. */
export function readCoinBurstState(input: unknown): CoinBurstState {
  const saved = v.parse(state, input), actual = saved.groups.map(() => 0);
  for (const row of saved.coins) if (row !== null) {
    if (row.group >= actual.length) throw new RangeError('Unknown coin burst group');
    actual[row.group] = (actual[row.group] ?? 0) + 1;
  }
  if (actual.some((n, index) => n !== saved.groups[index])) throw new RangeError('Coin burst counts do not match its pool');
  return saved;
}

import * as v from 'valibot';
import { StrikeRunner, type StrikeSpec } from './strikes';

const finite = v.pipe(v.number(), v.finite());
const nonnegative = v.pipe(finite, v.minValue(0));
const state = v.strictObject({ version: v.literal(1), phase: v.picklist(['idle', 'windup', 'active', 'recover', 'cooldown']),
  currentId: v.nullable(v.string()), hit: v.boolean(), elapsed: nonnegative, speedMul: v.pipe(finite, v.minValue(Number.MIN_VALUE)), clock: nonnegative,
  deadlines: v.array(v.strictObject({ id: v.string(), at: finite })), scores: v.array(v.strictObject({ id: v.string(), score: finite })),
  x0: finite, z0: finite, x1: finite, z1: finite, yaw: finite, length: finite });
/** Validate a JSON strike continuation against this policy's exact finite strike catalogue before any state mutates. */
export function readStrikeState(value: unknown, specs: readonly StrikeSpec[]): ReturnType<StrikeRunner['snapshot']> {
  const parsed = v.parse(state, value), ids = new Set(specs.map(spec => spec.id));
  if (parsed.deadlines.length > ids.size || parsed.scores.length > ids.size
    || new Set(parsed.deadlines.map(row => row.id)).size !== parsed.deadlines.length
    || new Set(parsed.scores.map(row => row.id)).size !== parsed.scores.length
    || [...parsed.deadlines, ...parsed.scores].some(row => !ids.has(row.id))) throw new Error('Invalid policy strike continuation');
  new StrikeRunner().restore(parsed, specs);
  return parsed;
}

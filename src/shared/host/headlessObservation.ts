import * as v from 'valibot';
import { TickCommitSchema, type HeadlessTickCommit } from './tickProtocol';

export const OBSERVATION_WARMUP_TICKS = 60;
export const OBSERVATION_WINDOW_TICKS = 60;
export const OBSERVATION_WINDOWS = 3;
export const OBSERVATION_TICKS: number = OBSERVATION_WARMUP_TICKS + OBSERVATION_WINDOW_TICKS * OBSERVATION_WINDOWS;
export interface HeadlessTickSample { tick: number; tickMicros: number; scriptMicros: number; fuelUsed: number }
export interface HeadlessObservationReport { samples: HeadlessTickSample[]; commit: HeadlessTickCommit }
const cost = v.pipe(v.number(), v.finite(), v.minValue(0));
/** Fixed real ticks and all raw costs, plus one complete final continuation. */
export const HeadlessObservationReportSchema: v.GenericSchema<HeadlessObservationReport> = v.pipe(v.strictObject({
  samples: v.pipe(v.array(v.strictObject({ tick: v.pipe(cost, v.integer()), tickMicros: cost, scriptMicros: cost,
    fuelUsed: v.pipe(cost, v.integer(), v.maxValue(0x7fffffff)) })), v.length(OBSERVATION_TICKS)),
  commit: TickCommitSchema,
}), v.check(report => report.samples.every((row, index) => row.tick === report.commit.tick - OBSERVATION_TICKS + index + 1), 'Observation ticks must be complete and ordered'));

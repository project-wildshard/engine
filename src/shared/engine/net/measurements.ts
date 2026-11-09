import * as v from 'valibot';

const nonnegative=v.pipe(v.number(),v.finite(),v.minValue(0));
export const CORRECTION_MODES=['foot','board','swim','ride'] as const;
/** A client-reported observation, never authority over movement or saves. */
export interface NetCorrection {readonly kind:'correction';readonly session:string;readonly tick:number;readonly mode:'foot'|'board'|'swim'|'ride';readonly offset:number;readonly snapped:boolean}
export const CorrectionSchema:v.GenericSchema<unknown,NetCorrection>=v.strictObject({kind:v.literal('correction'),session:v.pipe(v.string(),v.regex(/^[\w.-]{1,64}$/u)),
 tick:v.pipe(nonnegative,v.integer(),v.maxValue(0xffffffff)),mode:v.picklist(CORRECTION_MODES),offset:v.pipe(nonnegative,v.maxValue(10_000)),snapped:v.boolean()});
export interface HitRewind {readonly requested:number;readonly applied:number;readonly clamped:boolean}
export interface NetRecord {
 readonly kind:'net';readonly build:string;readonly install:string;readonly session:string;readonly level:string;readonly tag?:string;
 readonly seconds:number;readonly frames:number;readonly fps:number;readonly packets:number;readonly rttMs:number|null;readonly rttP95:number|null;
 readonly reconnects:number;readonly reconnectMs:number;readonly maxOffset:number;readonly corrections:Readonly<Record<typeof CORRECTION_MODES[number],number>>;
}

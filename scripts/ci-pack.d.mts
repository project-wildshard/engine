import type {AmberVerdict} from './test-amber.mjs';
/** One unit of a packed CI job's share (scripts/ci-pack.mjs). */
export interface Unit {name:string;phase:number;seconds:number;blocking:boolean}
export const UNIT_SECONDS:Readonly<Record<'static'|'e2e'|'plan-proofs'|'quarantine'|'products'|'boundaries',number>>;
/** The units a run has, from its plan's shard count and the kinds asked for. */
export function runUnits(shards:number,kinds:readonly string[],shardSeconds?:(index:number)=>number):Unit[];
/** Longest first onto the least-loaded job; with more than one job, products takes the last job to itself (EV3). */
export function packUnits(units:readonly Unit[],jobs:number):Unit[][];
/** The set-up a shard's wall is charged: job start to ci-pack less the checks only this job runs, plus pins (EV3c). */
export function sharedSetupMs(clock:{jobStart:number;packStart:number;ownMs:number;pinsMs:number}):number;
/** Each shard's charged wall, the artifact upload included, judged by J295's rule: AMBER over the wall, red at 2x. */
export function wallVerdicts(report:{ended:number;units:readonly {name:string;charged:number;ended:number}[]},now:number):AmberVerdict[];
/** J193 after the upload: false only when a shard's charged wall reached twice the five-minute budget (J295). */
export function checkWalls(job:number,now?:number):boolean;

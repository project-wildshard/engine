/** One unit of a packed CI job's share (scripts/ci-pack.mjs). */
export interface Unit {name:string;phase:number;seconds:number;blocking:boolean}
export const UNIT_SECONDS:Readonly<Record<'static'|'e2e'|'plan-proofs'|'quarantine'|'products'|'boundaries',number>>;
/** The units a run has, from its plan's shard count and the kinds asked for. */
export function runUnits(shards:number,kinds:readonly string[],shardSeconds?:(index:number)=>number):Unit[];
/** Longest first onto the least-loaded job; with more than one job, products takes the last job to itself (EV3). */
export function packUnits(units:readonly Unit[],jobs:number):Unit[][];
/** J193 after the upload: whether every shard's charged wall stayed under the five-minute budget. */
export function checkWalls(job:number,now?:number):boolean;

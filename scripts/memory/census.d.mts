export function censusInit(big?:number):string;
export interface CensusRow {kind:string;bytes:number;site:string;owner:string|null}
export function siteOf(stack:string,mapFor:(file:string)=>unknown,dist:string,originalPositionFor:(map:unknown,position:{line:number;column:number})=>{source?:string|null;line?:number|null;name?:string|null}):string;
export function censusTable(live:readonly CensusRow[]):{total:number;owned:number;bySite:{site:string;bytes:number;count:number;owners:string[]}[];byOwner:Record<string,number>};
export const NOT_ARRAY_BUFFER:Set<string>;
export function closure(ledger:{ram?:Record<string,number>;workers?:Record<string,number>}|null,seen:{partition:number|null;censusBytes:number;wasm:number}):{arrayBuffers:number;ratio:number|null;within10Pct:boolean;censusRatio:number|null;wasm:number;wasmSeen:number;wasmEqual:boolean;workerNames:string[]};

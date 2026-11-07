import type { MemoryAllocation } from './memory-report-blocks.mjs';

export interface MemoryMeasured {wc:number;gl:number;total:number;time:string;source:string;pid:number}
export interface MemoryAccounted {
  /** Allocator raw accounted sum; not the sum of observed storage rows. */
  total:number|null;
  allocations:MemoryAllocation[];
  unattributed:{ram:number|null;gpu:number|null};
  storageTotals:{ram:number|null;gpu:number|null};
}
export interface MemoryPose {name:string;measured:MemoryMeasured|null;accounted:MemoryAccounted;missing:string[];evidence?:Record<string,unknown>}
export interface MemoryReport {schema:'memory-report/1';pin:string;device:string;settings:Record<string,unknown>;cap:{bytes:1000000000};poses:MemoryPose[]}
/** Native-ruler bytes with no named owner (SF64): owned storage matched to GL / clamped to WC, and the rest. */
export interface MemoryNoOwner {gpuOwned:number;ramOwned:number;gpu:number;ram:number;bytes:number;share:number}
export const NO_OWNER:RegExp;
export function memoryNoOwner(pose:MemoryPose):MemoryNoOwner|null;
export interface CrossingMemorySample {measured:MemoryMeasured;glTime:string;accounted:MemoryAccounted}
export function readMemoryMeasured(value:unknown):MemoryMeasured|null;
export function readMemoryAttribution(value:unknown):MemoryAccounted;
export function readMemoryReport(value:unknown):MemoryReport;
export function emptyMemoryAttribution():MemoryAccounted;
export function nativeMemoryPose(value:unknown,label:string,name:string,source:string,attribution?:unknown):MemoryPose;
export function worstMemoryCrossing(samples:readonly CrossingMemorySample[],complete:boolean):MemoryPose;
/** Reuse original confidence/provenance; RAM residual is not a storage allocation. */
export function withItemizedMemoryPose(pose:MemoryPose,value:unknown,id:string,source:string):MemoryPose;

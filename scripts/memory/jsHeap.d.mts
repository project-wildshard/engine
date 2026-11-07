export interface HeapMetrics {bootAllocatedBytes:number;settledUsedBytes:number;idleBytesPerSecond:number;majorGCsPer30Seconds:number}
export interface HeapReading {shard:'_template'|'blender-template';metrics:HeapMetrics}
export function sampledHeapBytes(profile:unknown):number;
export function majorHeapGCs(events:unknown,seconds:number):number;
/** An absent baseline fails qualification; explicit seeding never increases an existing metric. */
export function checkHeapRatchet(input:unknown,baseline:unknown,rebase?:boolean):{passed:boolean;failures:string[];ratchet:{version:number;baselines:Record<string,HeapMetrics>}};

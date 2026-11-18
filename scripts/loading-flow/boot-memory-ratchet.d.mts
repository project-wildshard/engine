import type {Object3D} from 'three';

export const NINE_RETAINED_GEOMETRY_CEILING_BYTES:number;
export const NINE_LIVE_CEILING_BYTES:number;
export interface BootMemoryMark {operation:string;detail:Record<string,unknown>}
export interface BootMemoryVerdict {held:number|null;released:number;retained:number|null;live:number;faults:string[]}
export function bootMemoryMarks():BootMemoryMark[];
export function retainedGeometryBytes(scene?:Object3D|null):number|null;
export function bootMemoryVerdict(marks:readonly BootMemoryMark[],retained:number|null,liveBytes:number,limits?:{retainedCeiling?:number;liveCeiling?:number}):BootMemoryVerdict;
export function liveHeapBytes(session:{send:(method:string,params?:object)=>Promise<unknown>}):Promise<number>;

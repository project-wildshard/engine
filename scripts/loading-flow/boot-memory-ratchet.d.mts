export const NINE_RELEASED_FLOOR_BYTES:number;
export const NINE_LIVE_CEILING_BYTES:number;
export interface BootMemoryMark {operation:string;detail:Record<string,unknown>}
export interface BootMemoryVerdict {held:number|null;released:number;live:number;faults:string[]}
export function bootMemoryMarks():BootMemoryMark[];
export function bootMemoryVerdict(marks:readonly BootMemoryMark[],liveBytes:number,limits?:{releasedFloor?:number;liveCeiling?:number}):BootMemoryVerdict;
export function liveHeapBytes(session:{send:(method:string,params?:object)=>Promise<unknown>}):Promise<number>;

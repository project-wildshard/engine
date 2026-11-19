export const FRAME_ALLOC_SCOPE:RegExp;
export const FRAME_ALLOC_POLICY:string;
export interface FrameAllocSite {start:number;end:number;kind:string}
export function frameTagged(text:string,start:number):boolean;
export function frameAllocSites(program:unknown,text:string):FrameAllocSite[];
export function frameAllocPath(filename:string):string;
export function noFrameAllocRule(policyFile:string):{meta:object;create:(context:unknown)=>object};

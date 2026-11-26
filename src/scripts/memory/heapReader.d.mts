import type {HeapReading} from './jsHeap.mjs';
/** Clean Chromium allocation diagnostic; never a native memory-floor qualification. */
export function measureCleanHeap(base:string,shard:'brasscap-mesa'):Promise<HeapReading & {build:string;protocol:string;idleSeconds:number;postGC:boolean;clean:{pins:boolean;developer:boolean;href:string}}>;

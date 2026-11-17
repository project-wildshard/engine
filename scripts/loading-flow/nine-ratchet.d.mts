export interface FrameSummary {fps:number;p95:number;gpu95:number;draws95:number;tris95:number}
export interface NineReading {
 renderer:string;seconds:number;throttle:number;dpr:number;phone:boolean;
 load:{phases:{control:number};stage:{op:string;ms:number}[]};
 play:{pixelRatio:number;all:FrameSummary;minutes:FrameSummary[];
 route:{name:string;reached:number;stuck:unknown[];path:number[][]}};
}
export const NINE_LIMITS: Readonly<{triangles95:number;draws95:number;fps:number;frame95:number;gpu95:number;controlMs:number;shadersMs:number;firstFrameMs:number}>;
export function nineFaults(reading:NineReading):string[];

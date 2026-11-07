export interface WaveBaseline {wave:string;revision:string;record:string;customLines:Record<string,number>;platformLines:Record<string,number>}
export function platformLineFile(path:string):boolean;
export const PLATFORM_LAYERS:string[];
export function platformLineTotals(root:string,count:(source:string,path:string)=>number):Record<string,number>;
export function netLineReport(current:Record<string,{customLines:number;basis:string}|undefined>,baselines:WaveBaseline[],platform:Record<string,number>):{
 wave:string;revision:string;record:string;baselineBasis:string;enforcement:string;
 shards:Record<string,{before:number;after:number|null;basis:string;cut:number|null}>;
 layers:Record<string,{before:number;after:number;growth:number}>;customCut:number|null;platformGrowth:number;netCut:number|null;
}[];
export interface SourceLineBaseline {since:string;revision:string;basis:'source';customLines:Record<string,number>}
export function sourceLineDelta(current:Record<string,{customLines:number;basis:string}|undefined>,baseline:SourceLineBaseline):{
 since:string;revision:string;basis:string;shards:Record<string,{before:number;after:number|null;removed:number|null}>;totalRemoved:number|null;
};

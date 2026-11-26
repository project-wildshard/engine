export const PROTOCOL:string;
export const TYPE_BYTES:Readonly<Record<number,number>>;
export const TYPE_NAMES:Readonly<Record<number,string>>;
export const SHIM:string;
export function preprocess(source:string):{lines:string[];defines:Map<string,string>};
export function stageVaryings(source:string,stage:'vertex'|'fragment'):Map<string,number>;
export interface LiveVaryings {count:number;components:number;names:string[];vertexOutputs:number}
export function liveVaryings(vertex:string,fragment:string):LiveVaryings;
export function programName(vertex:string,id:number):string;
export function familyOf(names:readonly string[]):string;
export interface CensusAttribute {name:string;size:number;type:number;normalized:boolean;int:boolean;stride:number;offset:number;divisor:number}
export interface CensusBuffer {id:number;bytes:number;target:number;indices?:number;layout:CensusAttribute[];programs:number[]}
export interface ResidentCensus {triangles:number;arrayBytes:number;elementBytes:number;otherBytes:number;instanceBytes:number;unlaidBytes:number;vertexBytes:number;vertices:number;channels:Record<string,{bytes:number;perVertex:Record<string,number>}>;families:Record<string,{bytes:number;vertices:number;vertexBytes:number;channels:Record<string,string>}>}
export function residentCensus(buffers:readonly CensusBuffer[],names:Map<number,string>):ResidentCensus;
export interface PassRow {id:number;draws:number;invocations:number;triangles:number}
export function heaviestPasses(frame:{programs:readonly PassRow[]},info:Map<number,{name:string;varyings:LiveVaryings}>,top?:number):(PassRow&{name:string;varyings:number|null;components:number|null;weight:number})[];

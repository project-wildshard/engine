export const MB: number;
export const HOSTS: readonly ['webkit', 'chromium', 'simulator'];
export const KINDS: readonly ['none', 'arraybuffer', 'jsheap', 'wasm', 'worker', 'texrgba', 'texcomp', 'glbuffer', 'msaa', 'canvas2d', 'imagebitmap', 'audio'];
export interface Fit {slope:number;interceptMB:number;r2:number}
export interface KindRow extends Fit {
  unit:string;lands:string;spread:{runs:number;slopeMin:number;slopeMax:number;at256MB:number|null};
  sizesMB:number[];roles:Record<string,Fit>;format?:string;note?:string;
}
export interface HostTable {instrument:string;browser:string;measured:string;engine:string;baselineMB:Record<string,number>;kinds:Record<string,KindRow>}
export interface CalibrationTable {version:1;note:string;hosts:Partial<Record<'webkit'|'chromium'|'simulator',HostTable>>}
export interface Reading {host:string;kind:string;run:number;askedMB:number;gotBytes:number;unit:string;format?:string;error?:string|null;roles:Record<string,number>}
export const calibrationSchema: unknown;
export function fitLine(points:readonly (readonly [number,number])[]):Fit;
/** The kind lands in the role with the largest slope; spread is the per-run slope range and the 256 MB reading range. */
export function fitHost(readings:readonly Reading[]):{baselineMB:Record<string,number>;kinds:Record<string,KindRow>};
export function median(values:readonly number[]):number;
export function parseCalibration(table:unknown):CalibrationTable;
export const PROBE_2026_11_17: Record<string,Record<string,[string,number]>>;
export function compareWithProbe(host:string,table:{baselineMB:Record<string,number>;kinds:Record<string,{roles:Record<string,{slope:number;interceptMB:number}>}>},tolerance?:number):
  {kind:string;role:string;probe:number;table:number|null;slope:number|null;within:boolean}[];

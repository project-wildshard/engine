export const FOOTPRINT_PY: string;
export const MB: number;
export interface FootprintReading {pid:number;startAbstime:number;physicalFootprintBytes:number;residentBytes:number;intervalMaxPhysicalFootprintBytes:number;lifetimeMaxPhysicalFootprintBytes:number}
export function readFootprints(pids:readonly number[]):Record<string,FootprintReading|{error:string}>;
export interface ProcessRow {pid:number;ppid:number;rpid:number;name:string;path:string}
export interface BrowserProcess {pid:number;role:string;name:string;path?:string}
export function listProcesses():ProcessRow[];
export function webkitRole(name:string):'webcontent'|'gpu'|'networking'|'ui';
export function descendsFrom(byPid:Map<number,ProcessRow>,pid:number,ancestor:number):boolean;
export function pickWebkitProcesses(rows:readonly ProcessRow[],owner:number):BrowserProcess[];
export function webkitProcesses(owner?:number):BrowserProcess[];
export function chromiumProcesses(browser:{newBrowserCDPSession:()=>Promise<unknown>}):Promise<BrowserProcess[]>;
export function pickSimulatorProcesses(rows:readonly ProcessRow[],manager:number):BrowserProcess[];
export function simulatorProcesses(udid:string):BrowserProcess[];
export interface Sample {seq:number;t:number;p:Record<string,[number,number]|null>}
export interface Mark {seq:number;t:number;mark:string}
export interface Segment {mark:string;from:number;to:number;samples:number;peak:Record<string,number>;last:Record<string,number>}
export function parseFootprintStream(text:string):{samples:Sample[];marks:Mark[]};
/** Peak per pid is the larger of each sample's footprint and the kernel interval high-water since the previous sample. */
export function markSegments(stream:{samples:readonly Sample[];marks:readonly Mark[]}):Segment[];
export function roleSum(values:Record<string,number>,procs:readonly BrowserProcess[],role:string):number;
export function startSampler(pids:readonly number[],options?:{everyMs?:number}):{
  mark:(name:string)=>void;add:(pid:number)=>void;snapshot:()=>{samples:Sample[];marks:Mark[]};
  stop:()=>Promise<{samples:Sample[];marks:Mark[];segments:Segment[]}>;
};

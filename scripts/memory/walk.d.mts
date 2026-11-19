export type Route = {points:[number,number][];reach:number}|null;
export const WALK_ROUTES: Readonly<Record<string,Route>>;
export const CULLER: RegExp;
export function routeFor(chunk:string):string;
export interface WalkRecord {name:string;reached:number;stuck:number[][];metres:number;path:number[][];frames:number}
export function pageWalk(options:{seconds:number;name:string;route:Route}):{done:Promise<WalkRecord>};
export function walkRoute(page:unknown,chunk:string,seconds:number):Promise<WalkRecord>;
export interface CallFrame {functionName:string;url:string;lineNumber:number;columnNumber:number}
export interface ProfileNode {callFrame:CallFrame;selfSize:number;children:ProfileNode[]}
export type Symbolize = (f:CallFrame)=>string|null;
export function frameName(f:CallFrame,symbol?:Symbolize):string;
export function symbolizer(dist:string):Promise<Symbolize>;
export interface SiteRow {site:string;bytes:number}
export function allocationSites(profile:{head:ProfileNode},options?:{top?:number;depth?:number;symbol?:Symbolize}):{
  total:number;stacks:{bytes:number;stack:string[]}[];sites:SiteRow[];owners:SiteRow[];allOwners:SiteRow[];
};
export function bytesMatching(profile:{head:ProfileNode},pattern:RegExp,symbol?:Symbolize):number;
export interface WalkPeak {peak:{webcontent:number;gpu:number};last:{webcontent:number;gpu:number};aboveSettled:{webcontent:number;gpu:number};samples:number}
export function walkPeak(segments:readonly {mark:string;samples:number;peak:Record<string,number>;last:Record<string,number>}[],procs:readonly {pid:number;role:string}[],settled:{webcontent:number;gpu:number}):WalkPeak|null;

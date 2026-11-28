import type {Sample,BrowserProcess} from './footprint.mjs';
import type { PhoneModel } from './phoneModel.mjs';
import type { StallEntry } from '../loading-flow/stalls.mjs';
import type { SiteRow, WalkRecord } from './walk.mjs';

export const PROTOCOL: 'memory-run/1';
export type Instrument = 'minimal'|'full';
export const INSTRUMENTS: readonly ['minimal','full'];
export function minimiseInspector(page:unknown):Promise<unknown>;
export function sameInspectorSession(page:unknown,session:unknown):boolean;
export const PHONE_VIEW: {viewport:{width:number;height:number};screen:{width:number;height:number};deviceScaleFactor:number;isMobile:boolean;hasTouch:boolean};
export const STEP_LOG: string;
export type Ledger = Record<string,Record<string,number>>;
export type StepRow = [number,string,Ledger|null];
export interface Pair {webcontent:number;gpu:number}
export interface Checkpoint {step:string;from:number;to:number;samples:number;peak:Pair;last:Pair;ledger:Ledger|null}
export function stepCheckpoints(samples:readonly Sample[],steps:readonly StepRow[],procs:readonly BrowserProcess[]):Checkpoint[];
export function refusal(checkpoints:readonly Checkpoint[]):string|null;
export function settleControl<T extends {step:string;ledger:unknown}>(checkpoints:readonly T[],settled:unknown):(T|(T&{unsettled:unknown}))[];
export function ledgerByKind(snapshot:{allocations?:readonly {domain:string;kind:string;bytes:number}[]}|null|undefined):Ledger|null;
export function stats(values:readonly number[]):{n:number;median:number;min:number;max:number;spreadPct:number};
export interface DumpProcess {pid:number;role:string;footprint:number;alloc:Record<string,number>}
export function dumpsInOrder(events:readonly unknown[]):{id:string;processes:DumpProcess[]}[];
export const BOOT_FLAGS:string;
export function bootURL(url:string):string;
export function bootZone(page:unknown,url:string,chunk:string):Promise<void>;
export function bootZoneEntry(url:string,chunk:string):{zone:string;base:string;flags:string;unplaced:true};
export type Boot = 'online'|'standalone';
export interface WorldStamp {release:string;key:string}
export function isServerWorker(url:string):boolean;
export function bootOf(runs:readonly {boot?:string}[]):string;
export function builtGridCell(html:string,slug:string):readonly [number,number]|null;
export function devicePin(text:string):{key:string;data:unknown};
export function ringThree():[number,number][];
export function placeOffGrid<C extends {grid:{cells:{instance:string;slug:string;cell:number[]}[]}}>(catalogue:C,slugs:readonly string[]):C;
export function openOnlineBoot(options:{dist:string;chunk:string;scratch:string}):Promise<{url:string;stamp:WorldStamp;close:()=>Promise<void>}>;
export interface WebkitRun {
  host:'webkit';instrument:Instrument|'minimal-lost';boot:Boot;serverWorker:boolean;workers:string[];chunk:string;url:string;build:string|null;ready:boolean;failure:string|null;errors:string[];readyMs:number;loadAverage:number;
  processes:(BrowserProcess&{lifetimeMaxBytes:number|null})[];checkpoints:Checkpoint[];traceCheckpoints:Checkpoint[];settled:(Pair&{reads:Pair[]})|null;
  ledger:{totals:Record<string,number>;unattributed:Record<string,number>;byKind:Ledger|null}|null;refused:string|null;samples:number;
  counters:Counters|null;categories:Record<'webcontent'|'gpu',Record<string,number>>|null;probe?:unknown;
}
export function webkitBoot(options:{url:string;chunk:string;settleMs?:number;timeoutMs?:number;everyMs?:number;gcs?:number;reads?:number;closure?:boolean;instrument?:Instrument;probe?:(page:unknown,procs:BrowserProcess[])=>Promise<unknown>;prepare?:(context:unknown)=>Promise<void>;world?:WorldStamp|null;walk?:number}):Promise<WebkitRun>;
export interface MicroscopeRun {host:'chromium';ready:boolean;failure:string|null;gpuDetail:{kinds:Record<string,number>;formats:Record<string,number>;owners:Record<string,number>}|null;checkpoints:{step:string;ledger:Record<string,Record<string,number>>|null;processes:DumpProcess[]}[];timeline?:StallEntry[]|null}
export function chromiumMicroscope(options:{url:string;chunk:string;timeoutMs?:number;depth?:number;plantRetainedBuffer?:boolean;captureDumps?:boolean}):Promise<MicroscopeRun>;
export function webkitLines(run:WebkitRun):string[];
export function microscopeLines(run:MicroscopeRun):string[];
export function settledReading(page:unknown,procs:readonly BrowserProcess[],options?:{settleMs?:number;gcs?:number;reads?:number}):Promise<Pair&{reads:Pair[]}>;
export function serveCalibrationPage():Promise<{url:string;close:()=>void}>;
export function webkitRung(options:{rung:'blank'|'webgl'|'title';calibUrl:string;gameUrl:string;settleMs?:number;gcs?:number;reads?:number;timeoutMs?:number;instrument?:Instrument}):Promise<{rung:string;instrument:Instrument;settled:Pair&{reads:Pair[]};ledger:Ledger|null}>;
export function ledgerTotal(ledger:Ledger|null|undefined):number;
export function quietMachine(limits:{maxLoad:number;maxLanes:number;waitMs:number}):Promise<{load:number;otherLanes:number}>;
type Stats = ReturnType<typeof stats>;
export interface LadderParts {
  parts:{browserFloor:{k:number;l:number};webglContext:{k:number;l:number};title:{k:number;l:number};engineFixed:{k:number;l:number}};
  byZone:Record<string,{zone:{k:number;l:number};transient:{k:number};whole:{k:number;l:number};sumK:number;closesWithin2Pct:boolean}>;
}
export function ladderParts(rounds:readonly Record<string,{k:number;l:number;peak?:number}>[],zones:readonly string[]):LadderParts;
export function ladderLines(result:LadderParts&{rungs:Record<string,{k:Stats;wc:Stats;gpu:Stats;l:Stats;peak?:Stats}>;runs:number}):string[];
export function ledgerParity(checkpoint:{ledger?:Record<string,Record<string,number>>|null;processes:{role:string;alloc:Record<string,number>}[]}):{ledgerGpu:number;ledgerBuffers:number;angleMetal:number;webglBuffers:number}|null;
export function phoneContext(context:unknown,options?:{route?:boolean}):Promise<void>;
export function untilControl(page:unknown,timeoutMs:number,requireSettledFrame?:boolean):Promise<string|null>;
export interface BootState {now:number;steps:[number,string][];trace:[number,string][];errors:string[];resources:{name:string;end:number}[];files:number}
export function bootState(page:unknown):Promise<BootState>;
export function stallReport(state:BootState|null):string;
export function untilAfterBootAudio(page:unknown,timeoutMs:number):Promise<string|null>;
export interface Counters {gpu?:Record<string,number>;ram?:Record<string,number>;workers?:Record<string,number>}
export interface CalibrationHost {baselineMB:{webcontent:number;gpu:number};kinds:Record<string,{slope:number;interceptMB:number;lands:string;roles?:Record<string,{slope:number;interceptMB:number}>}>}
export interface ClosureTerm {process:'webcontent'|'gpu';term:string;category:string;bytes:number}
export function footprintCategories(procs:readonly BrowserProcess[]):Record<'webcontent'|'gpu',Record<string,number>>;
export function addCategories(into:Record<string,number>,categories:Record<string,{dirty?:number;swapped?:number}>):void;
export const LEDGER_WEIGHTS:Readonly<{ram:Record<string,[string,string]>;arrayBuffer:[string,string];worker:[string,string];gpu:Record<string,[string,string]>}>;
export function predictFootprint(counters:Counters|null,host:CalibrationHost):{floor:{webcontent:number;gpu:number};terms:ClosureTerm[];webcontent:number;gpu:number};
export function categoryRemainder(measured:Record<string,number>,terms:readonly ClosureTerm[],role:'webcontent'|'gpu'):{category:string;measured:number;ledger:number;unexplained:number}[];
export function closureLines(run:unknown,host:CalibrationHost):string[];
export function webkitCalibration():CalibrationHost;
export function traceToControl(trace:readonly StepRow[],steps:readonly StepRow[]):StepRow[];
export function phoneLine(run:{instrument?:string;checkpoints:readonly {peak:{webcontent:number;gpu:number}}[];settled:{webcontent:number;gpu:number}|null},model?:PhoneModel):string|null;
export interface LedgerRow {step:string;ram:number;gpu:number}
export function ledgerPeak(checkpoints:readonly {step:string;ledger:Record<string,Record<string,number>>|null}[]):{rows:LedgerRow[];peak:LedgerRow;control:LedgerRow}|null;
export function ledgerPeakLines(chunk:string,ledger:{peak:LedgerRow;control:LedgerRow}):string[];
export function summaryMarkdown(chunk:string,webkit:readonly unknown[],summary:unknown,ledger:{peak:LedgerRow;control:LedgerRow}|null):string;
export interface WalkSampled {host:'chromium';boot:Boot;chunk:string;ready:boolean;failure:string|null;errors:string[];seconds?:number;route?:WalkRecord;
  bytesPerSecond?:number;cullerBytesPerSecond?:number;sampledBytes?:number;owners?:SiteRow[];stacks?:{bytes:number;stack:string[]}[];sites?:SiteRow[]}
export function loopbackWorld(context:{grantPermissions:(permissions:string[],options:{origin:string})=>Promise<void>},url:string,world:WorldStamp|null):Promise<void>;
export function chromiumWalk(options:{url:string;chunk:string;world:WorldStamp|null;seconds:number;timeoutMs?:number;settleMs?:number;intervalBytes?:number;top?:number;dist?:string;profileOut?:string;jsFlags?:string}):Promise<WalkSampled>;
export interface WalkSummary {complete:boolean;peakAboveSettled:Stats;gpuPeakAboveSettled:Stats;walkPeak:Stats;bytesPerSecond:Stats;cullerBytesPerSecond:Stats;stuck:number[]}
export function walkSummary(webkit:readonly unknown[],walks:readonly unknown[]):WalkSummary;
export function walkSummaryLines(summary:WalkSummary):string[];
export function walkLines(run:unknown,sampled:unknown):string[];

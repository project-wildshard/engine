import type { MemoryWarning } from './test-amber.mjs';
import type { BudgetResult } from './budgets/watch.mjs';

export interface Run {id:number;head_sha:string;status:string;conclusion:string|null;created_at:string;event:string;run_attempt?:number;blockingChecked?:boolean;advisoryVersion?:number;started?:boolean;blockingFailed?:boolean;nativeInfra?:string}
export interface Job {name:string;conclusion:string|null;started_at?:string|null;runner_id?:number|null;steps?:readonly {name:string;conclusion:string|null}[]}
export interface MemoryQa {id:number;sha:string;created:string;warnings?:MemoryWarning[];pusher?:string;results?:readonly BudgetResult[]}
export interface RedSpan {run:number;at:number;text:string;keeper:boolean}
export interface State {judged:number[];dispatched:string[];memoryQa?:MemoryQa[];red?:RedSpan}
export interface Verdict {kind:'green'|'red'|'superseded'|'dispatch';run:Run;from?:string|null;by?:string}
export interface Pane {pane_id:string;label?:string;cwd?:string;foreground_cwd?:string}
export interface Io {
  repo:string;state:string;runs:()=>Run[];failed:(id:number)=>string[];annotations:(id:number)=>string;tip:()=>string;
  commits:(from:string|null,to:string)=>string[];contains:(ancestor:string,descendant:string)=>boolean;
  receipts:()=>string;receipt:(line:string)=>void;panes:()=>Pane[];send:(pane:string,text:string)=>boolean;prompt:(agent:string,text:string)=>boolean;fixers:()=>string[];dispatch:()=>void;
  nativeRuns?:()=>Run[];
  budgetRuns?:()=>Run[];
  budgetAnnotations?:(id:number)=>string;
  memoryQa?:(rows:MemoryQa[])=>void;
  quotaReset?:()=>number;
  now?:()=>number;
}
export const REPO: string;
export const KEEPER_MS: number;
export function advisory(job:Job):boolean;
export function failedNames(jobs:readonly Job[]):string[];
export function blockingRun(run:Run,jobs:readonly Job[]):Run;
export function judge(runs:readonly Run[],state:State,tip:string|null):Verdict[];
export function verdictFor(runs:readonly Run[],sha:string,contains:(ancestor:string,descendant:string)=>boolean):{state:'green'|'red';run:Run}|null;
export function landers(text:string):Map<string,{lane:string;slug:string;pane?:string;count?:number}>;
export function attribute<L extends {lane:string;count?:number}>(commits:readonly string[],who:ReadonlyMap<string,L>):{sha:string;lander:L|undefined}[];
export function paneFor(panes:readonly Pane[],slug:string):string|undefined;
export function readState(file:string):State|null;
export function sharedRuns(cache:string,fetch:()=>Run[],now?:number,freshMs?:number):Run[];
export function liveIo(env?:NodeJS.ProcessEnv):Io;
export function sweep(io:Io,hint?:{sha?:string;lane?:string;pane?:string}):Verdict[];
export function reached(io:{tip:()=>string;contains:(ancestor:string,descendant:string)=>boolean},sha:string,waitMs:number,pollMs?:number):Promise<boolean>;
export function follow(io:Io,options:{sha:string;lane?:string;pane?:string;pollMs?:number;timeoutMs?:number}):Promise<Verdict[]>;

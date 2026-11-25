import type { MemoryWarning } from './test-amber.mjs';
import type { BudgetObservation, BudgetResult } from './budgets/watch.mjs';

export interface Run {id:number;head_sha:string;display_title?:string;status:string;conclusion:string|null;created_at:string;event:string;run_attempt?:number;blockingChecked?:boolean;advisoryVersion?:number;started?:boolean;blockingFailed?:boolean;nativeInfra?:string}
export interface Job {id?:number;name:string;conclusion:string|null;started_at?:string|null;runner_id?:number|null;steps?:readonly {name:string;conclusion:string|null}[]}
export interface MemoryQa {id:number;sha:string;created:string;warnings?:MemoryWarning[];pusher?:string;results?:readonly BudgetResult[]}
export interface RedSpan {run:number;at:number;text:string;keeper:boolean;history?:{commits:string[];files:string[];jobs:string[]}}
export interface Rerun {id:number;at:number}
export interface State {judged:number[];dispatched:string[];reruns?:Rerun[];memoryQa?:MemoryQa[];budgetPending?:Record<string,BudgetObservation>;red?:RedSpan;notified?:Record<string,string[]>}
export interface Verdict {kind:'green'|'red'|'superseded'|'dispatch'|'rerun';run:Run;from?:string|null;by?:string}
export interface Pane {pane_id:string;label?:string;cwd?:string;foreground_cwd?:string}
export interface RedRecipient {lane:string;sendPane?:string;sendTerminal?:string;key:string;lanes:Set<string>;commits:Set<string>;fixer:boolean}
export interface RedLander {lane:string;slug:string;pane?:string}
export interface RedSuspect {sha:string;file:string}
export interface Io {
  repo:string;state:string;runs:()=>Run[];failed:(id:number)=>{names:string[];logs:string[]};annotations:(id:number)=>string;tip:()=>string;
  commits:(from:string|null,to:string)=>string[];contains:(ancestor:string,descendant:string)=>boolean;
  changes:(from:string|null,to:string)=>Map<string,string[]>;agents:()=>Map<string,string>;
  receipts:()=>string;receipt:(line:string)=>void;panes:()=>Pane[];send:(pane:string,text:string)=>boolean;prompt:(agent:string,text:string)=>boolean;fixers:()=>string[];dispatch:()=>void;
  redAllowed?:(run:number,commits:readonly string[],recipientLanes:readonly string[])=>boolean;
  lanes?:(commits:readonly string[])=>Map<string,string[]>;
  nativeRuns?:()=>Run[];
  budgetRuns?:()=>Run[];
  failmodeRuns?:()=>Run[];
  fpsRuns?:()=>Run[];
  budgetAnnotations?:(id:number)=>string;
  memoryQa?:(rows:MemoryQa[])=>void;
  quotaReset?:()=>number;
  now?:()=>number;
  /** Meta QA 11-25 row 67: rerun a red run's failed jobs once. */
  rerun?:(id:number)=>void;
  /** QA 11-25 row 21: the builder's hc terminal, and hc send to a terminal (false when refused). */
  builder?:()=>string|undefined;
  hcSend?:(terminal:string,text:string)=>boolean;
}
export const REPO: string;
export const KEEPER_MS: number;
export function advisory(job:Job):boolean;
export function failedNames(jobs:readonly Job[]):string[];
export function blockingRun(run:Run,jobs:readonly Job[]):Run;
export function cancelledJobs(jobs:readonly Job[]):{started:boolean,blockingFailed:boolean};
export function fpsNight(run:{display_title?:string}):{build:string;since:string|null}|null;
export const RERUN_STALE_MS: number;
export function pendingReruns(state:State|null,runs:readonly Run[],now?:number):Set<number>;
export function judge(runs:readonly Run[],state:State,tip:string|null,now?:number):Verdict[];
export function verdictFor(runs:readonly Run[],sha:string,contains:(ancestor:string,descendant:string)=>boolean):{state:'green'|'red';run:Run}|null;
export function landers(text:string):Map<string,{lane:string;slug:string;pane?:string;count?:number}>;
export function withAuthors<L extends {lane:string;slug:string}>(found:readonly {sha:string;lander:L|undefined}[],authored:ReadonlyMap<string,readonly string[]>):{sha:string;lander:L|{lane:string;slug:string}|undefined}[];
export function attribute<L extends {lane:string;count?:number}>(commits:readonly string[],who:ReadonlyMap<string,L>):{sha:string;lander:L|undefined}[];
export function paneFor(panes:readonly Pane[],slug:string):string|undefined;
export function failurePaths(logs:readonly string[]):string[];
export function redSuspect(commits:readonly string[],files:readonly string[],changes:ReadonlyMap<string,readonly string[]>):RedSuspect|undefined;
/** QA 11-25 row 21: the builder's hc terminal takes a red no lander was reached for and the keeper's red. */
export const BUILDER_LABEL:string;
export function fallbackRecipient(terminal:string|undefined):RedRecipient;
export function redNote(lane:string,run:number,range:string,failed:string):string;
export function redRecipients(rows:readonly {sha:string;lander?:RedLander}[],panes:readonly Pane[],agents:ReadonlyMap<string,string>,fixers:readonly string[]):RedRecipient[];
export function redMessage(recipient:RedRecipient,details:{range:string;url:string;failed:string;named:string;suspect?:RedSuspect}):string;
export function readState(file:string):State|null;
export function sharedRuns(cache:string,fetch:()=>Run[],now?:number,freshMs?:number):Run[];
export function liveIo(env?:NodeJS.ProcessEnv):Io;
export function sweep(io:Io,hint?:{sha?:string;lane?:string;pane?:string}):Verdict[];
export function reached(io:{tip:()=>string;contains:(ancestor:string,descendant:string)=>boolean},sha:string,waitMs:number,pollMs?:number):Promise<boolean>;
export function follow(io:Io,options:{sha:string;lane?:string;pane?:string;pollMs?:number;timeoutMs?:number}):Promise<Verdict[]>;

export function shouldPromptRed(scope:{machine:string;run:number;commits:readonly string[];recipientLanes:readonly string[];localLanes:ReadonlySet<string>;receipts:string;trailers:ReadonlyMap<string,readonly string[]>}):boolean;

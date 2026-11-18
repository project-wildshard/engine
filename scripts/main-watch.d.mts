export interface Run {id:number;head_sha:string;status:string;conclusion:string|null;created_at:string;event:string;run_attempt?:number;blockingChecked?:boolean;advisoryVersion?:number;started?:boolean;blockingFailed?:boolean;nativeInfra?:string}
export interface Job {name:string;conclusion:string|null;started_at?:string|null;runner_id?:number|null;steps?:readonly {name:string;conclusion:string|null}[]}
export interface State {judged:number[];dispatched:string[]}
export interface Verdict {kind:'green'|'red'|'superseded'|'dispatch';run:Run;from?:string|null;by?:string}
export interface Pane {pane_id:string;label?:string;cwd?:string;foreground_cwd?:string}
export interface Io {
  repo:string;state:string;runs:()=>Run[];failed:(id:number)=>string[];annotations:(id:number)=>string;tip:()=>string;
  commits:(from:string|null,to:string)=>string[];contains:(ancestor:string,descendant:string)=>boolean;
  receipts:()=>string;receipt:(line:string)=>void;panes:()=>Pane[];send:(pane:string,text:string)=>boolean;prompt:(agent:string,text:string)=>boolean;fixers:()=>string[];dispatch:()=>void;
  quotaReset?:()=>number;
}
export const REPO: string;
export function blockingRun(run:Run,jobs:readonly Job[]):Run;
export function judge(runs:readonly Run[],state:State,tip:string|null):Verdict[];
export function verdictFor(runs:readonly Run[],sha:string,contains:(ancestor:string,descendant:string)=>boolean):{state:'green'|'red';run:Run}|null;
export function landers(text:string):Map<string,{lane:string;slug:string;pane?:string}>;
export function paneFor(panes:readonly Pane[],slug:string):string|undefined;
export function readState(file:string):State|null;
export function sharedRuns(cache:string,fetch:()=>Run[],now?:number,freshMs?:number):Run[];
export function liveIo(env?:NodeJS.ProcessEnv):Io;
export function sweep(io:Io,hint?:{sha?:string;lane?:string;pane?:string}):Verdict[];
export function reached(io:{tip:()=>string;contains:(ancestor:string,descendant:string)=>boolean},sha:string,waitMs:number,pollMs?:number):Promise<boolean>;
export function follow(io:Io,options:{sha:string;lane?:string;pane?:string;pollMs?:number;timeoutMs?:number}):Promise<Verdict[]>;

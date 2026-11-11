export interface Run {id:number;head_sha:string;status:string;conclusion:string|null;created_at:string;event:string}
export interface State {judged:number[];dispatched:string[]}
export interface Verdict {kind:'green'|'red'|'superseded'|'dispatch';run:Run;from?:string|null;by?:string}
export interface Pane {pane_id:string;label?:string;cwd?:string;foreground_cwd?:string}
export interface Io {
  repo:string;state:string;runs:()=>Run[];failed:(id:number)=>string[];tip:()=>string;
  commits:(from:string|null,to:string)=>string[];contains:(ancestor:string,descendant:string)=>boolean;
  receipts:()=>string;receipt:(line:string)=>void;panes:()=>Pane[];send:(pane:string,text:string)=>boolean;dispatch:()=>void;
}
export const REPO: string;
export function judge(runs:readonly Run[],state:State,tip:string|null):Verdict[];
export function verdictFor(runs:readonly Run[],sha:string,contains:(ancestor:string,descendant:string)=>boolean):{state:'green'|'red';run:Run}|null;
export function landers(text:string):Map<string,{lane:string;slug:string;pane?:string}>;
export function paneFor(panes:readonly Pane[],slug:string):string|undefined;
export function readState(file:string):State|null;
export function liveIo(env?:NodeJS.ProcessEnv):Io;
export function sweep(io:Io,hint?:{sha?:string;lane?:string;pane?:string}):Verdict[];
export function follow(io:Io,options:{sha:string;lane?:string;pane?:string;pollMs?:number;timeoutMs?:number}):Promise<Verdict[]>;

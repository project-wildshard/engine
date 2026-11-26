export const PROCESSES: readonly string[];
export function commands(o:{udid?:string;seconds:number;out:string}):{list:string[];sysmon:string[][];syslog:string[];crash:string[]};
export function parseSysmon(line:string):{name:string;pid:number;physFootprint:number}|null;
export type SyslogHit={kind:'limits';activeMB:number;inactiveMB:number;line:string}|{kind:'exceeded';process:string;pid:number;limit:string;limitMB:number;fatal:boolean;line:string};
export function parseSyslog(line:string):SyslogHit|null;
export interface JetsamRow {name:string;pid:number;pages:number;bytes:number;lifetimeMaxBytes:number|null;reason:string|null}
export interface Jetsam {date:string|null;largestProcess:string|null;pageSize:number;killed:JetsamRow[];rows:JetsamRow[]}
export function parseJetsam(text:string):Jetsam;
export function jetsamLines(j:Jetsam):string[];
export function options(argv:string[]):{seconds:number;udid:string|undefined;out:string;dryRun:boolean};
export function main(argv:string[],io?:{devices?:()=>unknown[];log?:(line:string)=>void}):Promise<number>;

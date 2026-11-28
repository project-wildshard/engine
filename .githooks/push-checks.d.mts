export interface CheckTask {name:string;commands:string[][];stuckSeconds?:number;env?:NodeJS.ProcessEnv}
export function pushEnvironment(environment?:NodeJS.ProcessEnv):NodeJS.ProcessEnv;
export interface CheckResult {ok:boolean;seconds:number;results:{name:string;code:number;seconds:number;stoppedBy?:string;stuck?:boolean}[];timedOut:boolean}
export function parallelChecks(tasks:CheckTask[],options?:{cwd?:string;env?:NodeJS.ProcessEnv;graceMs?:number;timeoutMs?:number;stuck?:boolean}):Promise<CheckResult>;
export const STUCK_STEP_SECONDS:number;
export const STUCK_VITEST_SECONDS:number;
export function stuckLimitMs(task:{name:string;stuckSeconds?:number},env?:NodeJS.ProcessEnv,load?:number,cores?:number):number;
export function stuckExtensionMs(task:{name:string;stuckSeconds?:number},elapsedMs:number,limitMs:number,env?:NodeJS.ProcessEnv,load?:number,cores?:number):number;
export const STUCK_LOAD_CAP:number;
export const STUCK_RESAMPLE_MS:number;
export function staticChecks(lintThreads?:number):CheckTask[];
export function fullStuckSeconds(table:Record<string,number>|undefined,workers:number):number;
export function withProgressReporter(command:readonly string[]):string[];
export const FULL_STUCK_FACTOR:number;

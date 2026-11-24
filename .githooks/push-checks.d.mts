export interface CheckTask {name:string;commands:string[][];stuckSeconds?:number}
export function pushEnvironment(environment?:NodeJS.ProcessEnv):NodeJS.ProcessEnv;
export interface CheckResult {ok:boolean;seconds:number;results:{name:string;code:number;seconds:number;stoppedBy?:string;stuck?:boolean}[];timedOut:boolean}
export function parallelChecks(tasks:CheckTask[],options?:{cwd?:string;env?:NodeJS.ProcessEnv;graceMs?:number;timeoutMs?:number;stuck?:boolean}):Promise<CheckResult>;
export const STUCK_STEP_SECONDS:number;
export const STUCK_VITEST_SECONDS:number;
export function stuckLimitMs(task:{name:string;stuckSeconds?:number},env?:NodeJS.ProcessEnv,load?:number,cores?:number):number;
export function staticChecks(lintThreads?:number):CheckTask[];

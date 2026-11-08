export interface CheckTask {name:string;commands:string[][]}
export function pushEnvironment(environment?:NodeJS.ProcessEnv):NodeJS.ProcessEnv;
export interface CheckResult {ok:boolean;seconds:number;results:{name:string;code:number;seconds:number}[];timedOut:boolean}
export function parallelChecks(tasks:CheckTask[],options?:{cwd?:string;env?:NodeJS.ProcessEnv;graceMs?:number;timeoutMs?:number}):Promise<CheckResult>;

export interface CheckTask {name:string;commands:string[][]}
export interface CheckResult {ok:boolean;seconds:number;results:{name:string;code:number;seconds:number}[]}
export function parallelChecks(tasks:CheckTask[],options?:{cwd?:string;env?:NodeJS.ProcessEnv;graceMs?:number}):Promise<CheckResult>;

import type { Job as WatchJob } from './main-watch.mjs';

export interface Run {id:number;event:string;status:string;head_branch?:string;head_sha:string;created_at:string}
export interface Job extends WatchJob {status:string}
export function failedBlocking(job:Job):boolean;
export function earlyRed(runs:readonly Run[],jobsFor:(id:number)=>readonly Job[]):{cancel:number;newer:number;failed:string[]}|null;

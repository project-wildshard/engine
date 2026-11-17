export interface CpuProof {lease:string;slots:number;capacity:number;queueSeconds:number}
export interface CpuLease {proof:CpuProof;pid:number|undefined;lost:Promise<void>;parentContext?:string;release:()=>Promise<void>}
export const PARENT_CONTEXT:'WS_CPU_PARENT_GRANT';
export function holdCpu(slots:number|'all',options?:{root?:string;capacity?:number;repo?:string;inherit?:boolean;browser?:boolean}):Promise<CpuLease>;
export function holdBuildCpu():Promise<CpuLease>;
export function cpuRoot(env?:NodeJS.ProcessEnv):string;
export function parentCpuContext(proof:{lease:string},env?:NodeJS.ProcessEnv):string;
export function ancestorCpuBudget(env?:NodeJS.ProcessEnv):{slots:number;capacity:number;parentPid:number}|null;

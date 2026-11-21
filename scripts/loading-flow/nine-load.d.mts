import type {Browser} from 'playwright';

export const NINE_STALL_MS:number;
export const NINE_READY_CAP_MS:number;

export interface NineState {error:string|null;ready:boolean;frames:number;done:number;open:string[]}
export interface NineWait {now?:()=>number;sleep?:(ms:number)=>Promise<void>;log?:(line:string)=>void;stallMs?:number;capMs?:number}

export function readNineState():NineState;
export function waitNineReady(read:()=>Promise<NineState|null>,options?:NineWait):Promise<{readinessMs:number;last:NineState}>;
export function assertNineLoad(browser:Browser,base:string,out:string,wait?:NineWait):Promise<void>;

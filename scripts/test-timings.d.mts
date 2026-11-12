import type {AmberLedger} from './test-amber.mjs';

export interface Timings {version:1;run:string;sha:string;measuredAt:number;full:Record<string,number>;ring1:Record<string,number>;amber?:AmberLedger}
export const TIMINGS_FILE: string;
export const DEFAULT_SECONDS: number;
export const LOCAL_MAX_AGE_MS: number;
export function timingsDir(env?:NodeJS.ProcessEnv):string;
export function readTimings(env?:NodeJS.ProcessEnv):Timings|null;
export function readWeights(ring?:'full'|'1',env?:NodeJS.ProcessEnv):Record<string,number>;
export function writeTimings(timings:Timings,env?:NodeJS.ProcessEnv):string;
export function collectTimings(previous:Timings|null,directory:string):{timings:Timings;measured:number;amber:string[]}|null;
export function pickCache(before:number,env?:NodeJS.ProcessEnv,repo?:string):string|null;
export function fetchTimings(env?:NodeJS.ProcessEnv,options?:{before?:number;strict?:boolean;repo?:string}):string|null;
export function timingsStale(env?:NodeJS.ProcessEnv):boolean;

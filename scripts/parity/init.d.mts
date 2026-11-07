import type {BrowserContext} from 'playwright';
import type {bindFrameBudget} from './frame-budget.mjs';

export function installInit(context:BrowserContext,meta:{lane:string;sha:string;browser:string;capture?:number|null;accelerated?:boolean;tier?:string}):Promise<void>;
declare global {
  interface Window {
    __bindParityFrameBudget:typeof bindFrameBudget;
    __parityTelemetryOnly:(before:string|null,after:string,key:string)=>boolean;
    __sc_gl:()=>{texBytes:number;rbBytes:number;bufBytes:number}[];
    __parityResources:()=>{listeners:{window:number;document:number;canvas:number;other:number};listenerDetails:{id:number;type:string;capture:boolean;kind:string;target:string;stack:string}[];timers:{timeouts:number;intervals:number;raf:number};stacks:{listeners:string[];timers:string[]}};
    /** scripts/parity/audio-settle.mjs: the page's audio work in flight, how much has started, the frame the graph was built on */
    __parityAudioWork:{inflight:number;started:number;builtAt?:number};
    __parity:{cpu:number;on:boolean;rawRAF:typeof requestAnimationFrame;free:boolean;remaining:number;now?:()=>number;wait?:(frames:number)=>Promise<void>;observe?:(fn:()=>void)=>()=>void;advance:(frames:number)=>Promise<void>};
  }
}

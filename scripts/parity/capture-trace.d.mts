import type { Page } from 'playwright';

export interface CaptureStage {label:string;stage:string;state:string;ms:number|null;message?:string}
export function screenshotTraceStages(text:string,label:string):CaptureStage[];
export function registerCaptureTrace(page:Page,out:string,receipt:string):void;
export function beginCaptureTrace(page:Page,label:string):Promise<()=>Promise<void>>;

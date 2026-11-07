import type { Page } from 'playwright';
import type { captureViewportPng } from './fast-png.mjs';

export interface FrameSample { width:number; height:number; pixels:number; darkShare:number }
export interface BootFrameSample extends FrameSample { label:string }
/** Decode the actual composited PNG in the browser, using a detached analysis canvas. */
export function screenshotPixels(bytes:number[]):Promise<FrameSample>;
/** Reject missing samples and frames with at least 90% near-black pixels. */
export function frameFailure(sample:FrameSample):string|null;
/** Wait one browser frame and sample within the original 10-second capture and boot deadlines. */
export function captureBootFrame(page:Page,label:string,deadline:number,frames:BootFrameSample[],capture?:typeof captureViewportPng):Promise<void>;

import type { Buffer } from 'node:buffer';
import type { Page } from 'playwright';
import type { BootFrameSample, FrameSample } from './black-frame.mjs';

export const NIGHTLY_FRAME_LIMIT: 120;
export const NIGHTLY_WALL_MS: 90000;
export function observeNightlyFrames(budget: {draws:number;frames:number;wallMs:number}): {
  result: Promise<{error:string|null;samples:number[]}>;
  stop: () => void;
};
export function nightlyDrawSamples(page:Page):Promise<number[]>;
export function captureNightlyBootFrame(page:Page,label:string,frames:BootFrameSample[]):Promise<void>;
export function nightlyCapturePixels(bytes:Buffer):Promise<FrameSample>;

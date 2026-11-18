import type { PhoneModel } from './phoneModel.mjs';

export function lineFit(points:readonly [number,number][]):{floorMB:number;perMB:number};
export function zoneSummary(runs:readonly unknown[]):unknown;
export function fitPhoneModel(input:{anchor:readonly {traceCheckpoints?:readonly {step:string;peak:{webcontent:number;gpu:number}}[]}[];last:string;zones:readonly (readonly unknown[])[];chromium:Record<string,number[]>;limitMB:number;limitHighMB:number;gpuFloorMB:number;anchorRendererMB?:readonly number[]}):PhoneModel&{anchor:{consistent:boolean}};
export const ANCHOR_RENDERER_MB:readonly number[];

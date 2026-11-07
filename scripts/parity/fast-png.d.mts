import type { Page } from 'playwright';
import type { Buffer } from 'node:buffer';

/** Decode the native screenshot protocol's PNG payload. */
export function decodeProtocolPng(data:string):Buffer;

export interface CaptureOptions {
  format:'png'; clip:{x:number;y:number;width:number;height:number;scale:number};
  fromSurface:true; captureBeyondViewport:false; optimizeForSpeed:true;
}
export interface CaptureSession {
  layout:()=>Promise<{visualViewport:{pageX:number;pageY:number;scale:number}}>;
  capture:(options:CaptureOptions)=>Promise<{data:string}>;
  detach:()=>Promise<void>;
}
export type OpenCaptureSession = (page:Page)=>Promise<CaptureSession>;
/** Fast lossless Chromium PNG of the original viewport, within the supplied capture deadline. */
export function captureViewportPng(page: Page, label: string, deadline: number, openSession?:OpenCaptureSession): Promise<Buffer>;

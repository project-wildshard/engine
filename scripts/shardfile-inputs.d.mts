import type { InputHashMemo } from './bake-input-hashes.mjs';
import type { Plugin } from 'vite';

export function installInputRecorder():void;
export function recordResolution(id:string,importer:string|undefined):void;
export function recordModuleInput(id:string,options?:{execution?:boolean}):void;
export function recordBundle(result:unknown,options?:{execution?:boolean}):void;
export function captureProductInputs(root:string,receipt:string,run:()=>Promise<void>):Promise<void>;
export function replayProductInputs(root:string,receipt:string):void;
export function productInputKey(root:string,receipt:string,args:string[],memo:InputHashMemo):string|undefined;
export function matchingProductInputKey(root:string,directory:string,args:string[],memo:InputHashMemo):string|undefined;
export function publishProductInputs(directory:string,receipt:string,key:string):void;
export function productToolchainKey(root:string,memo:InputHashMemo):string;

/** Execution applies only to the trusted compiler bundle; runtime stays exact. */
export function inputRecorderPlugin(options?:{execution?:boolean}):Plugin;

/** Isolated raw read tracing with conservative fallback for unobserved I/O. */
export function startGenerationInputTrace(root:string,receipt:string):void;

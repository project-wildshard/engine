import type { InputHashMemo } from './bake-input-hashes.mjs';
import type { Plugin } from 'vite';

export function installInputRecorder():void;
export function recordResolution(id:string,importer:string|undefined):void;
export function recordModuleInput(id:string,options?:{execution?:boolean}):void;
export function recordBundle(result:unknown,options?:{execution?:boolean}):void;
export function captureFolderInputs(root:string,receipt:string,run:()=>Promise<void>):Promise<void>;
export function replayFolderInputs(root:string,receipt:string):void;
export function folderInputKey(root:string,receipt:string,args:string[],memo:InputHashMemo):string|undefined;
export function matchingFolderInputKey(root:string,directory:string,args:string[],memo:InputHashMemo):string|undefined;
export function publishFolderInputs(directory:string,receipt:string,key:string):void;
export function folderToolchainKey(root:string,memo:InputHashMemo):string;

/** Execution applies only to the trusted compiler bundle; runtime stays exact. */
export function inputRecorderPlugin(options?:{execution?:boolean}):Plugin;

/** Isolated raw read tracing with conservative fallback for unobserved I/O. */
export function startGenerationInputTrace(root:string,receipt:string):void;

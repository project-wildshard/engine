import type { Browser } from 'playwright';

export interface ExplorerCardSample {id:string;ready:boolean;pixels:number;darkShare:number}
export interface ExplorerDocument {url:string;timeOrigin:number;slug:string|null}
export interface ExplorerSession {sweep:(slug:string,out:string)=>Promise<void>;close:()=>Promise<void>}
/** Read pixels from actual already-drawn catalogue canvases. */
export function explorerCards(): ExplorerCardSample[];
/** Read the displayed catalogue's existing canvases without rendering or reading pixels. */
export function explorerState(): {fatal:(string|null)[];document:ExplorerDocument;empty:boolean;ready:boolean;readyIds:string[]};
export function explorerCases(catalogue:readonly {slug:string;status:string;legacy:boolean;shardSelect?:boolean}[]):string[];
/** Exact even/odd route partition; unknown groups or duplicate routes refuse. */
export function explorerPartition(cases:readonly string[],group?:string):string[];
export function explorerFailures(cards:readonly ExplorerCardSample[]):string[];
/** Sweep every real card with a 180-second no-progress hang guard, including stuck page reads; retain pixel/fatal checks. */
export function sweepExplorer(browser:Browser,base:string,slug:string,out:string):Promise<void>;
/** Retain HTTP/shader caches for four catalogues per native context, clear persistent origin stores, and check every fresh document independently. */
export function openExplorerSession(browser:Browser,base:string):Promise<ExplorerSession>;
export function verifyExplorerDocument(observed:ExplorerDocument,base:string,slug:string,previous:number|undefined):void;
export function explorerDiagnostics():{document:ExplorerDocument;timingBufferFull:boolean;navigation:Record<string,unknown>|null;resources:{url:string;type:string;durationMs:number;transferBytes:number;encodedBytes:number;startMs:number;responseStartMs:number;deliveryType:unknown}[];measures:{name:string;startMs:number;durationMs:number}[]};

export function explorerCapture():{before:ReturnType<typeof explorerState>;cards:ExplorerCardSample[];after:ReturnType<typeof explorerState>};

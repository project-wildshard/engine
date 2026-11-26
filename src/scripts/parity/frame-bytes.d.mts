import type { JSHandle } from 'playwright';
import type { ByteSinkPage } from '../bake-output.mjs';

export interface ParityFrame { width:number;height:number;data:Uint8Array<ArrayBuffer> }
/** Validate native RGBA storage, returning only its byte count and metadata. */
export function frameSummary<T extends ParityFrame>(frame:T):{bytes:number;metadata:Omit<T,'data'>};
/** Write optional binary output and always retire the native handle and upload route. */
export function readParityFrame<T extends ParityFrame>(page:ByteSinkPage,handle:Pick<JSHandle<T>,'evaluate'|'dispose'>,file?:string,validate?:(metadata:Omit<T,'data'>)=>void):Promise<Omit<T,'data'>>;

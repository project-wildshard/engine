import type {BinaryLike} from 'node:crypto';
import type {Buffer} from 'node:buffer';
/** SHA-256 of the exact emitted bytes. */
export function outputHash(bytes:BinaryLike):string;
/** Serialize ordinary JSON rows after refusing embedded byte values. */
export function jsonBytes(value:unknown,indent?:number|string):Buffer;
export function toolVersion(command:string,args:readonly string[]):string|null|undefined;
export interface ByteWriter {
  readonly put:(path:string,bytes:Uint8Array|string|readonly number[])=>void;
  readonly remove:(path:string)=>void;
  readonly finish:()=>number;
}
/** Check or publish complete bytes; JSON output also passes its writer guard. */
export function byteWriter(check:boolean,label:string,root?:string):ByteWriter;

export interface ByteRoute {
  readonly request: () => { readonly method: () => string; readonly url: () => string; readonly postDataBuffer: () => Uint8Array | null };
  readonly fulfill: (response: { status: number; headers: Record<string, string>; body?: string }) => Promise<void>;
}
export interface ByteSinkPage {
  readonly route: (pattern: string, handler: (route: ByteRoute) => Promise<void>) => Promise<unknown>;
  readonly unroute: (pattern: string, handler: (route: ByteRoute) => Promise<void>) => Promise<void>;
}
/** One bounded, owned byte handoff from a native authoring page. */
export function browserBakeBytes(page: ByteSinkPage, options?: { maxBytes?: number; maxFiles?: number }): Promise<{
  readonly url: string;
  readonly take: (id: string) => Uint8Array;
  readonly dispose: () => Promise<void>;
}>;

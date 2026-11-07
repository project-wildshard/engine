import type {Page} from 'playwright';
/** Serve original immutable JPEG buffers until disposal; no data-URL copies. */
export function jpegImageRoutes(page:Pick<Page,'route'|'unroute'>,images:readonly Uint8Array[]):Promise<{urls:string[];dispose:()=>Promise<void>}>;
/** Serve mixed original PNG/JPEG buffers, preserving MIME and byte views. */
export function imageRoutes(page:Pick<Page,'route'|'unroute'>,images:readonly {bytes:Uint8Array;mime:'image/png'|'image/jpeg'}[]):Promise<{urls:string[];dispose:()=>Promise<void>}>;

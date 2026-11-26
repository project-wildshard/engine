import type {MemoryReport} from './memory-report-data.mjs';
/** Read bounded plain/gzip/Brotli diagnostic JSON. */
export function readMemoryJson(path:string):unknown;
/** Resolve native report references, required coverage and matched crossing windows into the approved v1 shape. */
export function memoryReportFromManifest(value:unknown,directory:string):MemoryReport;

/** Writes the web bundle's `.vite/chunk-modules.json` from its manifest, source maps and bytes, and throws when the
 *  title or grid session closure is over its ratchet budget. */
export function writeChunkReport(outDir: string, root: string): Record<string, { name: string; moduleIds: string[]; rawBytes: number; gzBytes: number; imports: string[] }>;

/** A chunk that carries Vite's preload list is named after its final bytes. */
export function finalHash(bytes: Uint8Array | string): string;
export function nameChunksByFinalBytes(outDir: string): { from: string; to: string }[];

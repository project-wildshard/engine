/** Every module request a chunk makes by a literal: static imports, re-exports, dynamic imports and preload deps. */
export function chunkRequests(fileName: string, code: string): string[];
/** A document's one import map, or null when it loads no module code; throws on none, several, or one too late. */
export function documentImportMap(name: string, html: string): Record<string, string> | null;
/** Throws unless every page document holds the same import map first, every page chunk request resolves through it or
 *  to a file, and every other bundle under /b/ resolves to files directly. */
export function checkImportMaps(outDir: string): {documents: number; rows: number; chunks: number; mapped: number};

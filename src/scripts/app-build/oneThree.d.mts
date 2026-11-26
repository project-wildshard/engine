/** The written scripts a build's pages load: import-map chunks, the documents' entries and the online shell's graph. */
export function pageScripts(outDir: string, buildId: string): string[];
/** The page scripts that hold a copy of three.js. */
export function threeCopies(outDir: string, buildId: string): string[];
/** Throws when a build's pages load more than one three.js (QA 11-25 row 137). */
export function checkOneThree(outDir: string, buildId: string): { copies: number };

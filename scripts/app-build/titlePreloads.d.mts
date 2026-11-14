/** PZ18: the grid page entry, whose static closure the document preloads. */
export const TITLE_PRELOAD_ROOT: string;
/** The title root's static-closure chunks the document does not already preload or load as its module script. */
export function titlePreloadFiles(report: Record<string, { moduleIds: string[]; imports: string[] }>, html: string, root?: string): string[];
/** The document with a modulepreload link for each file after its last one (or before its first module script). */
export function withTitlePreloads(html: string, files: readonly string[]): string;
/** Adds the title closure's modulepreload links to the output's index.html; returns the files it preloads. */
export function writeTitlePreloads(outDir: string, report: Record<string, { moduleIds: string[]; imports: string[] }>): string[];

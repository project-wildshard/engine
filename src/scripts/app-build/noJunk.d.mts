/** The top-level folder a page build never holds. */
export const RIG: 'crossroads-rig';
/** Every `.mp4` under `outDir` and its `crossroads-rig/` folder, sorted. */
export function junkIn(outDir: string): string[];
/** Throws when a page build holds a video or the measuring rig (QA 11-26 row 14). */
export function checkNoJunk(outDir: string): void;

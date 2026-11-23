/** In-page owner census body (census.mjs): `arguments[0]` frames, the callback last. */
export declare const OWNER_CENSUS: string;
/** DW3: route probe bodies (census.mjs): the owners of each leg's heaviest sampled frames. */
export declare const LEG_CENSUS_START: string;
export declare const LEG_CENSUS_STOP: string;
export declare const LEG_ALLOC_START: string;
export declare const LEG_ALLOC_STOP: string;
export declare const LEG_VSYNC_START: string;
export declare const LEG_VSYNC_STOP: string;
/** In-page bodies (census.mjs): time every procedural voice render, then read the log. */
export declare const VOICE_LOG_START: string;
export declare const VOICE_LOG_READ: string;
export declare const VOICE_WORKER_READ: string;
/** In-page bodies (census.mjs): log every frame's interval with its GL links, uploads and scene adds, then read it. */
export declare const FRAME_LOG_START: string;
export declare const FRAME_LOG_READ: string;
/** DF8: what each long frame waited on (gc, compile, upload, update, render or other). */
export declare function nameLongFrames(frames: unknown[][], collections?: [string, number, number][], over?: number): { at: number; ms: number; cause: string; causes: string[] }[];
/** DF8: each long frame's work outside the game tick (GPU-waiting calls, long timers), longest first. */
export declare function gapWork(named: { at: number; ms: number }[], log: { reads?: [number, string, number][]; tasks?: [number, string, number][]; stamps?: [number, [number, number, string][], number, number, (number | null)?][] | null }): string[][];
/** DF8: an `other` frame split by `debug.taskStamp` (task, held or free); null without the stamps. */
export declare function otherKind(n: { at: number; ms: number; cause: string }, log: { stamps?: [number, [number, number, string][], number, number, (number | null)?][] | null }, gameFrame?: (label: string) => boolean): string | null;

/** In-page bodies (gpuFence.mjs): WebGL2 fences after each render and a full-collection sentinel, then read them. */
export declare const GPU_FENCE_START: string;
export declare const GPU_FENCE_READ: string;
/** DF8: each long frame's fences ([ms to signalled, frames waited, slowest status call]) and full collections. */
export declare function fenceFrames(named: { at: number; ms: number }[], log: { fences?: [number, number, number, number][]; full?: [number, number][] } | null): { at: number; fences: [number, number, number][]; full: number; gpu: boolean }[];
/** DF8: every fence's frames waited, as { waited: count }. */
export declare function fenceWaits(log: { fences?: [number, number, number, number][] } | null): Record<string, number>;

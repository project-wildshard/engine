/**
 * SF22d: the attributes whose CPU array the Memory saver let go (memorySaver.ts). A leaf module with no imports, so the
 * census labels (gpuLabels.ts, imported by the renderer) can ask without pulling the saver and the Settings store into the
 * renderer's import graph: that import moved the Settings module's evaluation and changed the lighting of a booted shard.
 */
const released = new WeakSet();

/** memorySaver: `a` gave up its array (reading `a.array` reads it back from the GPU) */
export function markArrayReleased(a: object): void { released.add(a); }
/** memorySaver: `a` has its array again */
export function markArrayRestored(a: object): void { released.delete(a); }
/** has `a` given up its CPU array: the census labels skip it rather than read it back */
export function arrayReleased(a: object): boolean { return released.has(a); }

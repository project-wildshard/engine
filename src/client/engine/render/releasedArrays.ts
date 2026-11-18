/**
 * SF22d: the attributes whose CPU array the Memory saver let go (memorySaver.ts). A leaf module with no imports, so the
 * census labels (gpuLabels.ts, imported by the renderer) can ask without pulling the saver and the Settings store into the
 * renderer's import graph: that import moved the Settings module's evaluation and changed the lighting of a booted shard.
 */
const released = new WeakMap<object, string>();
const cpuReaders = new WeakSet();
const fixedBatches = new WeakSet();

/** memorySaver: `a` gave up its array (reading `a.array` reads it back from the GPU) */
export function markArrayReleased(a: object, arrayType: string): void { released.set(a, arrayType); }
/** memorySaver: `a` has its array again */
export function markArrayRestored(a: object): void { released.delete(a); }
/** has `a` given up its CPU array: the census labels skip it rather than read it back */
export function arrayReleased(a: object): boolean { return released.has(a); }

/** Read an uploaded attribute's layout without restoring its CPU copy. */
export function releasedArrayType(a: object): string | undefined { return released.get(a); }

/** The owner of a CPU geometry reader registers its input here. */
export function retainGeometryForCpuReads(geometry: object): void { cpuReaders.add(geometry); }
export function geometryHasCpuReader(geometry: object): boolean { return cpuReaders.has(geometry); }

/** A fixed native batch has cached its per-part culling spheres before its first upload. */
export function markFixedBatchGeometry(geometry: object): void { fixedBatches.add(geometry); }
export function fixedBatchGeometry(geometry: object): boolean { return fixedBatches.has(geometry); }

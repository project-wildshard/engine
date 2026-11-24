/**
 * QA 11-23-b row 17 (free at upload): gpuOnly.ts detaches a released CPU copy's ArrayBuffer at its upload, so the bytes go
 * at once instead of when JSC next collects. A buffer a cache keeps for later reads (a shard folder's file bytes) must never
 * be detached: its owner marks it here, and gpuOnly leaves it (and every view of it) to the collector as before.
 */
const held = new WeakSet<ArrayBufferLike>();
export function holdBytes(bytes: ArrayBufferView): void { held.add(bytes.buffer); }
export function bytesHeld(buffer: ArrayBufferLike): boolean { return held.has(buffer); }

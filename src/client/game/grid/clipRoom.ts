/**
 * DW12b (`roadBuildLean.ts`): channels made with room for the clip's cut vertices. `clipRoomArray` allocates a channel at
 * the clip's exact vertex count and hands back a view of the vertices it holds now; `clipToBinsSteps` (`roadCull.ts`)
 * takes the room once, writing the cut vertices into the tail of the same buffer instead of copying the channel. Only
 * buffers made here are ever grown in place, so a caller's own arrays are never written past their end.
 */
import { ownedArray, ownedBuffer } from '@wildshard/engine/core/ownedBuffer';

const rooms = new WeakSet<ArrayBufferLike>();
const LABEL = { owner: 'grid/road-deck', asset: 'clip-room' } as const;

/** A channel of `vertices` x `size` floats over a buffer sized for `capacity` vertices (capacity below vertices: tight). */
export function clipRoomArray(vertices: number, capacity: number, size: number): Float32Array {
  if (capacity <= vertices) return ownedArray(Float32Array, vertices * size, LABEL);
  const buffer = ownedBuffer(capacity * size * Float32Array.BYTES_PER_ELEMENT, LABEL);
  rooms.add(buffer);
  return new Float32Array(buffer, 0, vertices * size);
}

/** `array` grown in place to `length` floats when it was made by `clipRoomArray` with that much room (the room is then
 *  spent), else null: the caller copies. */
export function takeClipRoom(array: ArrayLike<number>, length: number): Float32Array | null {
  if (!(array instanceof Float32Array) || array.byteOffset !== 0 || !rooms.has(array.buffer)) return null;
  if (array.buffer.byteLength < length * Float32Array.BYTES_PER_ELEMENT) return null;
  rooms.delete(array.buffer);
  return new Float32Array(array.buffer, 0, length);
}

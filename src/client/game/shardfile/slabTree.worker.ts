import { BufferAttribute, BufferGeometry } from 'three';
import { installWorkerBootTiming } from '@wildshard/engine/boot/workerTiming';
import { SLAB_LEAF_TRIANGLES, slabFarLevels, spatialSlabRanges, type SlabFarKind } from './slabRanges';

installWorkerBootTiming('slab-tree');

/**
 * NINE-DRAGON-BENCHMAX NB8 (mini-nb8i): a phone slab chunk's leaf tree split by facing too (`slabRangesJob`'s `faced`),
 * built here, off the main thread, while the world loads (`slabLibrary.ts` `facedTree`). The chunk's index and positions
 * come in; its index in the tree's order and the tree go back, transferred. NB23 (b): with `far` (the levels' cells) and
 * `room` (the triangles the chunk's index has free after its own), the far levels too (`slabFarLevels`).
 */
/** the kinds a far level's clusters keep apart, as sent (`slabLibrary.ts` `facedTree`) */
function slabFarKinds(sent: unknown): SlabFarKind[] {
  if (!Array.isArray(sent)) return [];
  return sent.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return [];
    const array: unknown = Reflect.get(row, 'array'), itemSize: unknown = Reflect.get(row, 'itemSize');
    return ArrayBuffer.isView(array) && !(array instanceof DataView) && typeof itemSize === 'number' && itemSize > 0 ? [{ array: array as unknown as ArrayLike<number>, itemSize }] : [];
  });
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const data = event.data;
  if (typeof data !== 'object' || data === null) return;
  const id: unknown = Reflect.get(data, 'id'), index: unknown = Reflect.get(data, 'index'), xyz: unknown = Reflect.get(data, 'xyz');
  if (typeof id !== 'number' || !(index instanceof Uint32Array) || !(xyz instanceof Float32Array)) return;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(xyz, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    const ranges = spatialSlabRanges(geometry, SLAB_LEAF_TRIANGLES, true);
    if (ranges === null) { self.postMessage({ id, tree: null }, { transfer: [] }); return; }
    const { boxes, nodes, size, cones, triangles } = ranges;
    const cells: unknown = Reflect.get(data, 'far'), room: unknown = Reflect.get(data, 'room');
    const far = Array.isArray(cells) && cells.length > 0 && cells.every(cell => typeof cell === 'number') && typeof room === 'number' && room > 0
      ? slabFarLevels(index, xyz, ranges, cells, room, slabFarKinds(Reflect.get(data, 'kinds'))) : null;
    const tree = { index, boxes, nodes, size, cones, triangles, ...(far === null ? {} : { farCorners: far.corners, farCells: far.far.cells, farStarts: far.far.starts, farEnds: far.far.ends }) };
    if (far === null) self.postMessage({ id, tree }, { transfer: [index.buffer, boxes.buffer, nodes.buffer, size.buffer, cones.buffer] });
    else self.postMessage({ id, tree }, { transfer: [index.buffer, boxes.buffer, nodes.buffer, size.buffer, cones.buffer, far.corners.buffer, far.far.cells.buffer, far.far.starts.buffer, far.far.ends.buffer] });
  } catch (error) {
    self.postMessage({ id, tree: null, error: error instanceof Error ? error.message : String(error) }, { transfer: [] });
  }
};

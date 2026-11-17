import { BufferAttribute, BufferGeometry } from 'three';
import { installWorkerBootTiming } from '@wildshard/engine/boot/workerTiming';
import { SLAB_LEAF_TRIANGLES, spatialSlabRanges } from './slabRanges';

installWorkerBootTiming('slab-tree');

/**
 * NINE-DRAGON-BENCHMAX NB8 (mini-nb8i): a phone slab chunk's leaf tree split by facing too (`slabRangesJob`'s `faced`),
 * built here, off the main thread, while the world loads (`slabLibrary.ts` `facedTree`). The chunk's index and positions
 * come in; its index in the tree's order and the tree go back, transferred.
 */
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
    self.postMessage({ id, tree: { index, boxes, nodes, size, cones, triangles } }, { transfer: [index.buffer, boxes.buffer, nodes.buffer, size.buffer, cones.buffer] });
  } catch (error) {
    self.postMessage({ id, tree: null, error: error instanceof Error ? error.message : String(error) }, { transfer: [] });
  }
};

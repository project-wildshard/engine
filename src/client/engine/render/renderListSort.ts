/**
 * MEMORY-STRUCTURE STR20: three sorts each render list with `Array.prototype.sort`, which copies the list into a fresh
 * work array on every call: ~0.13 MB/s of Nine's 60 s walk (Chromium [S], mini-memstruct-m3c). Each list's three arrays
 * get an own stable merge sort over one kept scratch array instead. Stable like the builtin, and like it a comparator's
 * NaN reads as a tie, so a consistent comparator orders the list exactly as before.
 */
import type { Scene, WebGLRenderList, WebGLRenderLists } from 'three';

type Compare = (a: unknown, b: unknown) => number;
const RUN = 16;
/** the left halves being merged; it grows to the largest half once and is reused (it holds three's pooled items) */
const scratch: unknown[] = [];

/** @frame */
function insertion(list: unknown[], from: number, to: number, compare: Compare): void {
  for (let i = from + 1; i < to; i++) {
    const item = list[i];
    let j = i - 1;
    while (j >= from && compare(list[j], item) > 0) { list[j + 1] = list[j]; j--; }
    list[j + 1] = item;
  }
}

/** @frame */
function merge(list: unknown[], from: number, mid: number, to: number, compare: Compare): void {
  if (!(compare(list[mid - 1], list[mid]) > 0)) return;
  const left = mid - from;
  for (let i = 0; i < left; i++) scratch[i] = list[from + i];
  let i = 0, j = mid, k = from;
  while (i < left && j < to) {
    const right = list[j];
    // a right item goes first only when strictly smaller: ties keep the left one first (stable)
    if (compare(scratch[i], right) > 0) { list[k++] = right; j++; } else list[k++] = scratch[i++];
  }
  while (i < left) list[k++] = scratch[i++];
}

/** Sort `list` in place, stably, allocating nothing once the scratch has grown. @frame */
export function stableSort<T>(list: T[], compare: (a: T, b: T) => number): T[] {
  const items = list as unknown[], order = compare as Compare, n = items.length;
  for (let from = 0; from < n; from += RUN) insertion(items, from, Math.min(from + RUN, n), order);
  for (let width = RUN; width < n; width *= 2) {
    for (let from = 0; from + width < n; from += 2 * width) merge(items, from, from + width, Math.min(from + 2 * width, n), order);
  }
  return list;
}

function ownSort(this: unknown[], compare: Compare): unknown[] { return stableSort(this, compare); }

/** Give every render list three hands out its own sort (its opaque, transmissive and transparent arrays are made once). */
export function installRenderListSort(renderer: { readonly renderLists: WebGLRenderLists }): void {
  const lists = renderer.renderLists, get = lists.get.bind(lists), seen = new WeakSet();
  lists.get = (scene: Scene, depth: number): WebGLRenderList => {
    const list = get(scene, depth);
    if (!seen.has(list)) {
      seen.add(list);
      // an own, non-enumerable sort: each array still reads and spreads as three's plain array
      for (const items of [list.opaque, list.transmissive, list.transparent]) {
        Object.defineProperty(items, 'sort', { configurable: true, writable: true, enumerable: false, value: ownSort });
      }
    }
    return list;
  };
}

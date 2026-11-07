/** Pure tree geometry specifications and file fallback selection. */
export const TREE_SPECS = [
  { height: 22, trunk: 0.42, seed: 1 },
  { height: 17, trunk: 0.34, seed: 2 },
  { height: 26, trunk: 0.5, seed: 3 },
  { height: 13, trunk: 0.27, seed: 4 },
] as const;

/** Select a supplied set when its files exist; bakecards forces the runtime bake. */
export function treeSetOf(trees: { set?: string | undefined }, has?: (url: string) => boolean): string | null {
  if (trees.set === undefined) return null;
  if (has && !has(`/assets/models/${trees.set}/trees.glb`)) return null; // a build without the set's files: the runtime pines
  const q = typeof location === 'undefined' ? '' : location.search;
  return new URLSearchParams(q).has('bakecards') ? null : trees.set;
}

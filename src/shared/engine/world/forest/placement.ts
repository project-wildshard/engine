import { TREE_SPECS, treeSetOf } from './treeSpec';
import type { TreeSpec, ForestSpec, TerrainField } from '../../level/data';
/**
 * Where the forest goes (SDK-SPLIT SP5b, Q35): format's `placeForestSteps` is the law, shared with the build; this binds it to
 * the active level and the installed terrain when no source is given, and makes the page's records (tints as `THREE.Color`).
 */
import * as THREE from 'three';
import * as forestLaw from '@wildshard/format/forestPlacement';
import { TREE_COUNT, SEED } from '../../core/config';
import { heightAt, normalAt, trailDistance, cabinMask, pondMask } from '../Heightfield';
import { activeLevel } from '../../level/selection';
import type { TreeSpecies, TreeSetVariant } from '../../../../client/engine/world/forest/treeSpecies';

/** The canopy density map, the identical defining format function. */
export const canopyMapOf: typeof forestLaw.canopyMapOf = forestLaw.canopyMapOf;
export type PlantSpec = forestLaw.PlantSpec;

export interface TreeInstance { x: number; y: number; z: number; r: number; variant: number; scale: number; rot: number; height: number; tint: THREE.Color; species?: TreeSpecies | undefined }

/** Explicit forest construction inputs for renderer-free native authors.
 * Supplying this never selects a level, installs terrain or changes page constants. */
export interface ForestPlacementSource extends Pick<TerrainField, 'heightAt' | 'normalAt' | 'trailDistance' | 'cabinMask' | 'pondMask'> {
  readonly seed: number;
  readonly treeCount: number;
  readonly forest?: ForestSpec;
}

/** The variants placement plants for a shard's trees (the bakes; TreeFactory builds the same list with geometry). */
export function plantSpecs(trees: { factory: TreeSpec['factory']; set?: string | undefined; setVariants?: readonly TreeSetVariant[] | undefined }): PlantSpec[] {
  if (trees.factory === 'none') return [];
  if (treeSetOf(trees) !== null) return (trees.setVariants ?? []).map((s) => ({ trunkRadius: s.trunk, height: s.height, species: s.species, collider: s.collider }));
  return TREE_SPECS.map((s) => ({ trunkRadius: s.trunk, height: s.height }));
}

/** Trees bucketed in 16 m cells (format's `TreeGrid`), over the page's tree records by default. */
export class TreeGrid<T extends { readonly x: number; readonly z: number; readonly r: number } = TreeInstance> extends forestLaw.TreeGrid<T> {}

/** The active chunk's trees for these variants (none for an empty list: a treeless shard). */
export function placeForest(variants: readonly PlantSpec[], source?: ForestPlacementSource): { trees: TreeInstance[]; grid: TreeGrid } {
  const steps = placeForestSteps(variants, source);
  for (;;) { const step = steps.next(); if (step.done === true) return step.value; }
}

/** `placeForest` as steps (SF67: `Forest.buildSliced` pauses between them): a yield every 256 candidates, which draws
 *  nothing, so the same trees from the same stream. Without a source it reads the active level and the installed terrain
 *  live, as each candidate is tested. */
export function* placeForestSteps(variants: readonly PlantSpec[], source?: ForestPlacementSource): Generator<void, { trees: TreeInstance[]; grid: TreeGrid }> {
  const forest = source === undefined ? activeLevel().forest : source.forest;
  const bound: Omit<forestLaw.ForestPlacementSource, 'forest'> = source ?? {
    seed: SEED, treeCount: TREE_COUNT, heightAt: (x, z) => heightAt(x, z), normalAt: (x, z, eps) => normalAt(x, z, eps),
    trailDistance: (x, z) => trailDistance(x, z), cabinMask: (x, z) => cabinMask(x, z), pondMask: (x, z) => pondMask(x, z),
  };
  const placed = yield* forestLaw.placeForestSteps(variants, {
    seed: bound.seed, treeCount: bound.treeCount, heightAt: bound.heightAt, normalAt: bound.normalAt,
    trailDistance: bound.trailDistance, cabinMask: bound.cabinMask, pondMask: bound.pondMask, ...(forest === undefined ? {} : { forest }),
  });
  const trees: TreeInstance[] = [];
  for (const tree of placed.trees) {
    const { tint, species } = tree;
    const made: TreeInstance = { x: tree.x, y: tree.y, z: tree.z, r: tree.r, variant: tree.variant, scale: tree.scale, rot: tree.rot, height: tree.height,
      tint: new THREE.Color(tint[0], tint[1], tint[2]) };
    if (species !== undefined) made.species = species;
    trees.push(made);
  }
  return { trees, grid: treeGridOf(trees) };
}

/** The 16 m lookup grid over given trees (what `placeForest` returns beside them). */
export function treeGridOf(trees: readonly TreeInstance[]): TreeGrid {
  const grid = new TreeGrid();
  for (const t of trees) grid.add(t);
  return grid;
}

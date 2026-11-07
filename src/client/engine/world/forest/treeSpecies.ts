/**
 * A tree set's species (PH-B4; E405: the set is content — Pine Hollow's is src/shards/pine-hollow/generators/treeSet.ts): a
 * level names its species, how each is planted (ForestSpec.speciesTraits, in draw order) and the set's variants
 * (TreeSpec.setVariants). A leaf module (no imports).
 */
export type TreeSpecies = string;
export type SpeciesWeights = Partial<Record<TreeSpecies, number>>;

/** how a species is planted: its scale range; whether it follows the zone's growth (ForestSpec.scale); the trunk's extra
 *  girth (m); its spacing — 'wide' keeps every neighbour 3.5 m off (a giant's buttresses), 'tight' 0.6 m (a sapling),
 *  else 1.2 m; a hue shift of its tint */
export interface TreeSpeciesTraits {
  readonly id: TreeSpecies; readonly scale: readonly [number, number]; readonly grows: boolean; readonly girth: number;
  readonly spacing: 'wide' | 'normal' | 'tight'; readonly hue?: number;
}
/** one variant of a tree set: its mesh name in the set's GLB, its species, height and trunk (m), the trunk collider's scale */
export interface TreeSetVariant { readonly name: string; readonly species: TreeSpecies; readonly height: number; readonly trunk: number; readonly collider: number }

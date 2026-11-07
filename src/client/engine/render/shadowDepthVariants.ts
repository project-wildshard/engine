import type * as THREE from 'three';

/**
 * The depth material a renderer's shadow pass really draws a caster's material with, where that is not three's stock
 * `MeshDepthMaterial` (sp-o289). The classic graph back-end (`graph/glslMaterial.ts`'s `classicShadowDepth`) swaps a graph
 * material that moves its vertices (`graphShadowDepth`) for its own depth variant inside the shadow draw; precompile's
 * shadow jobs compiled the stock depth material instead, so every such variant linked inside a travel frame on its first
 * shadow draw (Pine Hollow's road entry: 107–164 ms `getProgramInfoLog` frames on desktop with a cold shader cache).
 *
 * `resolve(source, stock)` configures and returns the variant exactly as the shadow draw would for a caster of `source`
 * whose stock depth material is `stock`, or null when the shadow draw keeps the stock one. The back-end registers it on
 * its renderer; a renderer without one resolves nothing, so its programs stay as they were.
 */
export type ShadowDepthResolver = (source: THREE.Material, stock: THREE.MeshDepthMaterial) => THREE.Material | null;

const resolvers = new WeakMap<object, ShadowDepthResolver[]>();

/** Register a shadow-pass depth substitution for this renderer (the classic graph back-end's, once it loads; NF17). */
export function registerShadowDepthResolver(renderer: object, resolve: ShadowDepthResolver): void {
  const list = resolvers.get(renderer) ?? [];
  if (!list.includes(resolve)) list.push(resolve);
  resolvers.set(renderer, list);
}

/** This renderer's shadow-pass depth substitution (the first registered that claims a material), or undefined where its
 *  shadow draws keep three's stock materials. */
export function shadowDepthResolver(renderer: object): ShadowDepthResolver | undefined {
  const list = resolvers.get(renderer);
  if (list === undefined || list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return (source, stock) => {
    for (const resolve of list) { const variant = resolve(source, stock); if (variant !== null) return variant; }
    return null;
  };
}

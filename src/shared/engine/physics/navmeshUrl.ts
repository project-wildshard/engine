import { publicBytes } from '../boot/tables';
/** The shard's baked navmesh (scripts/bake-navmesh.mjs), when the build has one — its own module so src/client/engine/boot/manifest.ts
 *  (which also runs under Node's type stripping in scripts/bake-packs.mjs) can declare it without pulling in navcat. */

export const navmeshUrl = (slug: string): string | null => {
  const url = `/assets/baked/${slug}/navmesh.bin`;
  return url in publicBytes() ? url : null;
};

/**
 * Which shards ship a committed terrain bake (`public/assets/baked/<slug>/terrain.bin`, the WSTR lattice). One rule shared
 * by the baker (`scripts/bake-chunk.mjs`, which writes and checks exactly these)
 * and the grid's edge reader (`src/client/game/grid/edgeSources.ts`, which fetches only these): a landscape-terrain shard with no
 * structures. A structures world (Sky Reach's islands over the void, Nine Dragon's stack) bakes none (SF49, C4-R1-C13).
 */
import type { ShardManifest } from '../../../client/game/shard/manifest';

/** True when the shard's terrain is baked at build time and committed. */
export function bakesTerrain(ground: ShardManifest['ground']): boolean {
  return ground.terrain !== undefined && ground.structures === undefined;
}

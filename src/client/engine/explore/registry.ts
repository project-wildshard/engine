/**
 * The model registry Explore World reads (project/archive/2026-09-23-explore-world.md X10) — a view onto the one world
 * registry (src/client/engine/world/registry.ts, ENGINE-FIT E1). Models get there one way only (E306 / E315, M6): `place` and
 * `listModel` (src/client/engine/models/) register a model's ONE catalog entry per shard; nothing registers a model by hand. Explore
 * itself knows no shard; the rest of Explore stays a lazy chunk.
 *
 *   registeredModels() / registeredPicks() / registeredSets()
 */
import { app } from '../app/runtime';
import type { RegisteredModel, RegisteredPick, RegisteredSet } from '../world/registry';


export function registeredModels(): readonly RegisteredModel[] { return app.registry.models(); }
export function registeredPicks(): readonly RegisteredPick[] { return app.registry.picks; }
/** the shard's sets (E306 M7: `placeSet`, src/client/engine/models/sets.ts) — the Sets explorer's list, a model card's PART OF */
export function registeredSets(): readonly RegisteredSet[] { return app.registry.sets; }

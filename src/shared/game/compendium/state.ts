import { compendiumSave, saveSlug } from '../saves';
import { CompendiumRules } from './rules';
import type { ShardCompendium } from './types';
/**
 * CompendiumState — the per-entry state machine (unknown → discovered → seen → taken) and its stats, persisted per
 * shard in localStorage ('ws.compendium.v1', keyed by chunk id, like ws.progress.v1 / ws.inventory.v1). The in-memory
 * copy is the truth for the session: iOS private mode throws on write, and a corrupt save loads as empty.
 *
 *   const state = new CompendiumState(def);                  // def = compendiumFor(chunkId)
 *   state.animalNear('deer', 'stag')                         // within the tracker's hearing range → discovered
 *   state.animalSpotted('deer', 'stag')                      // one individual in view → seen, SEEN + 1
 *   state.animalKilled('deer', 'stag', 187)                  // → taken, TAKEN + 1, BEST = max(kg)
 *   state.placeNear('pond') / state.placeVisited('pond')     // → discovered / seen (VISITS + 1)
 *   state.stats('red-deer') → { state, seen, taken, best }   state.onChange = (entry, from, to) => …
 *
 * A state only moves forward; `taken` implies `seen` (a kill you never "spotted" still unlocks the plate).
 */

/** Page save adapter over the same renderer-free journal law. Its public transitions and callbacks are unchanged. */
export class CompendiumState extends CompendiumRules {
  constructor(def: ShardCompendium) { super(def, compendiumSave.read(saveSlug(def.chunkId))); }
  protected override persist(): void { compendiumSave.write(this.snapshot().entries, saveSlug(this.def.chunkId)); }
}

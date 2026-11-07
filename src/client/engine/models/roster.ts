/**
 * Every shard's live models in its Model Explorer (E306 / E315 M5), listed once at boot (main.ts): the shared training
 * dummy (the practice arena's lineup, E348) and the hoverboard every player rides (E348), then the shard's roster
 * (`ShardManifest.roster`: its creatures — the species list, alive now or not — its people and the gear its player holds; a
 * lazy loader, so the def stays node-safe). None of it is placed: the AnimalManager, the quests, the arena and the
 * weapons keep drawing the copies (./live.ts).
 */
import type { AnimalStyle } from '../entities/AnimalFactory';
import type { SkyRig as Sky } from '../world/skyRig';
import type { WorldRegistry } from '../world/registry';
import { creatureContext } from './creature';
import { listRoster, live, type RosterEntry } from './live';
import { trainingDummy } from './trainingDummy';
import { hoverboard } from './hoverboard';
import { ARENA_LINEUP } from '../practice/lineup';
import type { Renderer } from '../render/renderer';

export interface ShardModelsOptions {
  /** the shard's roster (ShardManifest.roster) */
  readonly roster: (() => Promise<readonly RosterEntry[]>) | undefined;
  /** its creature style (ShardManifest.style): the factory its creatures' specimens are built with */
  readonly style: AnimalStyle;
  readonly sky: Sky;
  readonly renderer: Renderer;
  /** the live animals (a creature's copies) */
  readonly animals: () => readonly { readonly kind: string }[];
  readonly registry: WorldRegistry;
}

/** List the shard's live models (the dummy and the hoverboard at once, the roster once its module is in). */
export async function listShardModels(o: ShardModelsOptions): Promise<void> {
  const ctx = creatureContext(o.sky, o.style, o.renderer);
  // the arena's dummies: the copies its lineup places (src/client/engine/practice/lineup.ts); the board: the player's one (Player.board)
  listRoster([live(trainingDummy, { copies: ARENA_LINEUP.length, drawnAs: 'skinned' }), live(hoverboard, { copies: 1 })], ctx, o.animals, o.registry);
  try {
    const roster = await o.roster?.();
    if (roster) {
      await Promise.all(roster.flatMap(entry => entry.prepare === undefined ? [] : [entry.prepare()]));
      listRoster(roster, ctx, o.animals, o.registry);
    }
  } catch (error) {
    console.warn('[models] the level roster did not load; its creatures show from the live animals only', error);
  }
}

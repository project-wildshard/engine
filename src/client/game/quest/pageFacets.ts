/** A quest page's optional facets (G565): its ridden mover, its collections and its full map, each from admitted rows. */
import * as v from 'valibot';
import { QuestPageCollectionsSchema, QuestPageMapSchema, QuestPageMoverSchema } from '@wildshard/format/questPageFacets';
import type { StingName } from '@wildshard/engine/audio/Music';
import { INTERACT_SOUNDS } from '@wildshard/engine/audio/gen';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { InteractEvent } from '@wildshard/engine/world/interact/Interactables';
import type { FollowedMovers } from '../plugin/followedMovers';
import type { enterMovers } from '../plugin/moverViews';
import type { ShardContext } from '../plugin/context';
import type { SceneHandles } from '../shardfile/sceneHandles';
import { forestPage } from '../shardfile/forestPage';
import type { QuestChapter } from './chapter';

function entered(ctx: ShardContext) {
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null) throw new Error('Quest page facet requires entered play services');
  return { runtime, world, play };
}

/** Enter the page's declared mover on its scene mesh. */
export function installPageMover(ctx: ShardContext, input: unknown, ports: { readonly scenes: SceneHandles; readonly enter: typeof enterMovers }): FollowedMovers {
  const rows = v.parse(QuestPageMoverSchema, input), { runtime, world } = entered(ctx);
  if (!INTERACT_SOUNDS.some(sound => sound === rows.board.sound)) throw new Error(`Unknown mover boarding sound: ${rows.board.sound}`);
  return ports.enter(ctx, world, ctx.product.shardfile.movers, rows.binding,
    { [rows.target]: { group: ports.scenes.mesh(rows.mesh) } }, { prompts: runtime.interactables });
}

/** The page kit's calls for its collections: each event shows the count chip, each complete event runs its page action
 *  (the page's `action`), a pickup plays its sting (the play music's `sting`). */
export function pageCollectionCalls(input: unknown, ports: { readonly flags: Pick<Flags, 'count'>;
  readonly chip: () => { show: (row: { label: string; n: number; of: number }) => void };
  readonly action: (event: string) => (e: InteractEvent) => void; readonly sting: (name: StingName) => void }): Map<string, (e: InteractEvent) => void> {
  const rows = v.parse(QuestPageCollectionsSchema, input);
  const calls = new Map<string, (e: InteractEvent) => void>(rows.rows.flatMap((row): [string, (e: InteractEvent) => void][] => [
    [row.event, (): void => { ports.chip().show({ label: row.label, n: ports.flags.count(row.prefix), of: row.names.length }); }],
    [row.completeEvent, ports.action(row.completeEvent)],
  ]));
  const pickup = rows.pickup;
  if (pickup !== undefined) calls.set(pickup.event, () => { ports.sting(pickup.sting); });
  return calls;
}

/** Publish the page's pins to the full map with its policy, name its zones and lay the forest's ground features. */
export function installPageMap(ctx: ShardContext, input: unknown, chapter: Pick<QuestChapter, 'publishMap'>): void {
  const rows = v.parse(QuestPageMapSchema, input), { world, play } = entered(ctx);
  chapter.publishMap(rows.publish);
  if (rows.zones !== undefined) play.fullMap.setZones(rows.zones);
  if (rows.features !== undefined) play.fullMap.setFeatures({ trees: world.forest.trees, roofs: forestPage(ctx.scope, rows.features.forest).cabins.roofs });
}

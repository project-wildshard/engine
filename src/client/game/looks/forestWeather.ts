/** Client-only weather observations from actual native page and quest owners. */
import * as v from 'valibot';
import { ForestWeatherObservationSchema } from '@wildshard/format/rangedPage';
import { forestPage, type ForestPage } from '../shardfile/forestPage';
import { chapterLeadPosition } from '../../../shared/game/quest/chapterLeads';
import type { ShardContext } from '../plugin/context';
import type { ShardRuntime, ShardPlayHost } from '../../../shared/game/shard/runtime';
import { rangedPage } from '../loadout/rangedPage';
import type { ShardWorld } from '../../../server/game/shard/world';
import type { DeclaredAmbience } from '@wildshard/engine/audio/declaredAmbience';
import type { Vector3 } from 'three';

export interface ForestWeatherObservations {
  readonly guideAt: () => Vector3 | null;
  readonly game: ShardWorld['game']; readonly sky: ShardWorld['sky']; readonly trees: ShardWorld['forest']['trees'];
  readonly animals: ShardPlayHost['animals']; readonly particles: ForestPage['particles']; readonly ambience: DeclaredAmbience;
  readonly viewer: ShardRuntime['viewer']; readonly horizonVeil: ShardRuntime['horizonVeil'];
}
/** The guide observation borrows its actual body position. */
export function forestWeatherObservations(ctx: ShardContext, input: unknown): ForestWeatherObservations {
  const rows = v.parse(ForestWeatherObservationSchema, input), page = forestPage(ctx.scope, rows.page), runtime = ctx.game.runtime;
  const world = runtime?.world, play = runtime?.play;
  if (runtime === undefined || world === undefined || world === null || play === undefined || play === null) throw new Error('Weather observation requires its runtime');
  return { game: world.game, sky: world.sky, trees: world.forest.trees, animals: play.animals, particles: page.particles, ambience: rangedPage(ctx.scope, rows.audio).ambience,
    guideAt: () => chapterLeadPosition(ctx.scope, rows.guide), viewer: runtime.viewer, horizonVeil: runtime.horizonVeil };
}

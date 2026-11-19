import { Scene, type Vector3 } from 'three';
import type { MarkedBossPresentation, SpawnedBossProfileRows } from '@wildshard/format/bossProfiles';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { easeField } from '@wildshard/engine/world/easedFields';
import type { ShardContext } from '../plugin/context';
import { bossStorm } from '../plugin/bossStorm';
import { stormGoal } from '../../../shared/game/plugin/bodyBoss';
import { wirePage } from './wirePage';

/**
 * ONE-FORMAT OF19c1: a declared boss on a plan owner row whose profile is `spawned` (Dunes' Dune Matriarch) blows the
 * storm its marked presentation row draws, as the keeper's fight did on a page on a server (J130): the page steps no
 * fight, so the declared encounter's wire row (`encounter`) says when, by the profile's storm phases and at its fade.
 * The fog and the sand shells are `bossStorm`'s; the system is named after the encounter.
 */
export function installDeclaredBossStorm(ctx: ShardContext, source: Shardfile, encounter: string, player: Vector3,
  fight: SpawnedBossProfileRows['fight'], presentation: MarkedBossPresentation): void {
  const scene = ctx.game.runtime?.world?.game.scene ?? new Scene(), blow = bossStorm(ctx, source, player, presentation.storm)(scene);
  const ease = { seconds: fight.stormFade }, weather = { storm: 0 };
  ctx.system({ id: `${encounter}.storm`, phase: 'update', run: dt => {
    const row = wirePage.encounters().find(entry => entry.id === encounter);
    weather.storm = easeField(weather.storm, stormGoal(row, fight.stormPhases), dt, ease);
    blow(dt, weather.storm);
  } });
}

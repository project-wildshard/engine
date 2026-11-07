/** Declared entry into the existing engine elite feature over original loans. */
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { EliteBar } from '@wildshard/engine/ui/EliteBar';
import { Elites } from '../Elite';
import type { ShardContext } from '../plugin/context';
import { retainsRuntimeServices } from '../shard/retainedHooks';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';

/** Resolve all concrete owners before allocating UI. The existing engine binder
 * admits the whole programme/controller bank and rolls back a failed suffix. */
export function installClientEliteEntry(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'elite.entry' }>): void {
  const shell = ctx.game.runtime, world = shell?.world, play = shell?.play;
  if (shell === undefined || world === null || world === undefined || play === null || play === undefined
    || ctx.scope.disposed || ctx.scope.disposing) throw new Error('Elite entry requires its live world and play owners');
  const loan = entryOwner(ctx.scope, 'elite-entry', row.owner);
  const persistence = entryOwner(ctx.scope, 'adventure', row.adventure);
  const taming = row.taming === undefined ? null : entryOwner(ctx.scope, 'taming', row.taming);
  if (loan.construction !== world.game.levelScope || loan.construction.disposed || loan.construction.disposing)
    throw new Error('Elite entry requires its original construction scope');
  const scope = ctx.scope.child('Elites.bind');
  try {
    scope.run(() => {
      const { game, player } = world, entry = loan.entry, bar = new EliteBar();
      const owner = new Elites({ scene: game.scene, camera: game.camera, player,
        condition: rule => entry.holds(rule), ownSkin: skin => { entry.skins.add(skin); } }, bar, game.level.id, persistence.elites);
      owner.bindDeclaredEntry(entry, loan.rows, { ...loan, game, player, body: row.body, rock: row.rock, animals: play.animals,
        entered: { scope, interactables: shell.interactables, hud: play.hud, audio: play.audio, music: play.music }, wildlife: null, persistence });
      // Boss prewarming reserves its identity before authored lairs materialize.
      if (retainsRuntimeServices(ctx)) entry.initialize({ patrolAvailable: true, herdAvailable: true,
        kills: loan.patrol?.killsTonight ?? 0, bonded: taming?.phase === 'bonded', mount: taming?.companion ?? null });
    });
  } catch (error) { scope.dispose(); throw error; }
}

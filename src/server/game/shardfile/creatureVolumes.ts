import { parse } from 'valibot';
import { CreatureBodySchema } from '@wildshard/format/creatureLayers';
import { resolveSkinLookFiles, skinLookParameters } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { RestCreatureVolumes } from '../../../shared/game/shardfile/creatureVolumes';
import { RestCreatureSockets } from '../../../shared/game/shardfile/creatureSockets';
import { ClipCreatureVolumes } from '../../../shared/game/shardfile/creatureClipVolumes';
import { creatureRestRig } from '../../../shared/game/shardfile/creatureRestRig';

/** The actual admitted skin supplies rest joints. Native rows with no body layer
 * install nothing, retaining their existing posed-volume/publication owner. */
export function installCreatureVolumes(host: SimHost, shard: Pick<Shardfile, 'rows' | 'files' | 'creatures'>,
  assets: ReadonlyMap<string, Uint8Array>): void {
  const pending = shard.creatures.spawns.flatMap(spawn => {
    const species = shard.rows.species.find(row => row.id === spawn.species);
    if (species?.body === undefined) return [];
    const body = parse(CreatureBodySchema, species.body), actor = host.entities.get(spawn.id);
    const look = shard.rows.looks.find(row => row.id === body.look);
    if (actor === undefined || look === undefined) throw new Error(`species ${spawn.species}: hit volumes need an admitted look`);
    // Existing procedural bodies and own-rig skins still use their explicit
    // dims/fore until an author requests new volume or socket mechanics.
    if (look.recipe !== SKIN_LOOK_RECIPE) {
      if (body.volumes !== undefined || body.lock !== undefined || body.hits === 'clip') throw new Error(`species ${spawn.species}: authored hit volumes need an admitted skin`);
      return [];
    }
    if (body.skeleton === undefined && body.volumes === undefined && body.lock === undefined && body.hits !== 'clip') return [];
    const resolved = resolveSkinLookFiles(shard, look, assets), skin = resolved.variants?.get(spawn.variant) ?? resolved.skin;
    if (body.hits === 'clip' && Object.keys(skin.binding.poseLayers ?? {}).length > 0) throw new Error(`species ${spawn.species}: clip hits do not admit presentation-only pose layers`);
    const bytes = assets.get(skin.row.file);
    if (bytes === undefined) throw new Error(`species ${spawn.species}: missing admitted skin GLB`);
    const joints = creatureRestRig(bytes, skin.row.rig.joints[0] ?? []);
    const root = { position: actor.position, get yaw() { return actor.yaw; }, get scale() { return actor.scale * body.scale; } };
    return [{ actor, pose: body.hits === 'clip' ? new ClipCreatureVolumes(body, bytes, joints, actor, () => host.clock.now, skinLookParameters(look).attackSpan)
      : body.skeleton === undefined && body.volumes === undefined ? undefined : new RestCreatureVolumes(body, joints, root),
      locks: body.skeleton === undefined && body.lock === undefined ? undefined : new RestCreatureSockets(body, joints, root), contract: { id: spawn.id, body, skin: skin.hash, joints } }];
  });
  if (pending.length === 0) return;
  const id = 'creatures.volumes', contract = JSON.stringify(pending.map(row => row.contract));
  if (host.adapters.has(id)) throw new Error('Creature volumes already installed');
  // All source/rig checks precede binding any actual actor.
  for (const row of pending) { if (row.pose !== undefined) row.actor.bindHitVolumes(row.pose); if (row.locks !== undefined) row.actor.bindLockPoints(row.locks); }
  const adapter = { snapshot: () => contract, restore: (saved: unknown) => {
    if (saved !== contract) throw new Error('Incompatible creature volumes continuation');
  } };
  host.adapters.set(id, adapter);
  host.scope.onDispose(() => { if (host.adapters.get(id) === adapter) host.adapters.delete(id); });
}

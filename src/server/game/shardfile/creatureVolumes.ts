import { parse } from 'valibot';
import { CreatureBodySchema } from '@wildshard/format/creatureLayers';
import { CREATURE_SIZES } from '@wildshard/format/creatureSizes';
import { resolveSkinLookFiles, skinLookParameters } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { RestCreatureVolumes } from '../../../shared/game/shardfile/creatureVolumes';
import { CreatureSockets } from '../../../shared/game/shardfile/creatureSockets';
import { ClipCreatureVolumes } from '../../../shared/game/shardfile/creatureClipVolumes';
import { TrailCreatureVolumes } from '../../../shared/game/shardfile/trailCreatureVolumes';
import type { Vector3 } from 'three';
import { checkCreatureHeight } from './creatureSizes';
import { bodyContract } from '../../../shared/game/shardfile/creatureContract';
import { creatureRestRig } from '../../../shared/game/shardfile/creatureRestRig';

/** The actual admitted skin supplies rest joints. Native rows with no body layer
 * install nothing, retaining their existing posed-volume/publication owner. */
export function installCreatureVolumes(host: SimHost, shard: Pick<Shardfile, 'rows' | 'files' | 'creatures'>,
  assets: ReadonlyMap<string, Uint8Array>): void {
  const pending = shard.creatures.spawns.flatMap(spawn => {
    const species = shard.rows.species.find(row => row.id === spawn.species);
    const strikeNames = [...new Set((species?.abilities ?? []).flatMap(row => row.from === undefined ? [] : [row.from]))];
    if (species?.body === undefined) {
      if (strikeNames.length > 0) throw new Error(`species ${spawn.species}: a strike socket needs an admitted skin body`);
      return [];
    }
    const body = parse(CreatureBodySchema, species.body), actor = host.entities.get(spawn.id);
    const look = shard.rows.looks.find(row => row.id === body.look);
    if (actor === undefined || look === undefined) throw new Error(`species ${spawn.species}: hit volumes need an admitted look`);
    // Existing procedural bodies and own-rig skins still use their explicit
    // dims/fore until an author requests new volume or socket mechanics.
    if (look.recipe !== SKIN_LOOK_RECIPE) {
      if (body.volumes !== undefined || body.lock !== undefined || body.hits === 'clip') throw new Error(`species ${spawn.species}: authored hit volumes need an admitted skin`);
      if (strikeNames.length > 0) throw new Error(`species ${spawn.species}: a strike socket needs an admitted skin body`);
      return [];
    }
    const needsPorts = body.skeleton !== undefined || body.volumes !== undefined || body.lock !== undefined || body.hits === 'clip' || strikeNames.length > 0;
    if (!needsPorts && CREATURE_SIZES[body.size].maxHeight === undefined) return [];
    const resolved = resolveSkinLookFiles(shard, look, assets), skin = resolved.variants?.get(spawn.variant) ?? resolved.skin;
    if (body.hits === 'clip' && Object.keys(skin.binding.poseLayers ?? {}).length > 0) throw new Error(`species ${spawn.species}: clip hits do not admit presentation-only pose layers`);
    const bytes = assets.get(skin.row.file);
    if (bytes === undefined) throw new Error(`species ${spawn.species}: missing admitted skin GLB`);
    if (!needsPorts) { checkCreatureHeight(body, bytes, actor, undefined); return []; }
    const joints = creatureRestRig(bytes, skin.row.rig.joints[0] ?? []);
    const root = { position: actor.position, get yaw() { return actor.yaw; }, get scale() { return actor.scale; } };
    const parameters = skinLookParameters(look);
    const pose = body.skeleton === 'serpent' ? new TrailCreatureVolumes(body, root, (x, z) => host.heightAt(x, z))
      : body.hits === 'clip' ? new ClipCreatureVolumes(body, bytes, joints, actor, () => host.clock.now, parameters.attackSpan, parameters.clipMap)
      : body.skeleton === undefined && body.volumes === undefined ? undefined : new RestCreatureVolumes(body, joints, root);
    checkCreatureHeight(body, bytes, actor, pose);
    const canonicalSockets = bodyContract(body)?.sockets;
    for (const name of strikeNames) {
      if (canonicalSockets?.[name] === undefined && !skin.row.rig.sockets.includes(name)) throw new Error(`species ${spawn.species}: unknown strike socket ${name}`);
    }
    const strikes = strikeNames.length === 0 ? undefined : new CreatureSockets(body, joints, root, {
      names: strikeNames,
      ...(pose instanceof ClipCreatureVolumes ? { posed: pose.socket.bind(pose) }
        : pose instanceof TrailCreatureVolumes ? { posed: trailSocket(pose, joints) } : {}),
    });
    return [{ actor, pose,
      locks: body.skeleton === undefined && body.lock === undefined ? undefined : new CreatureSockets(body, joints, root),
      strikes, contract: { id: spawn.id, body, skin: skin.hash, joints, ...(strikes === undefined ? {} : { strikeNames }) } }];
  });
  if (pending.length === 0) return;
  const id = 'creatures.volumes', contract = JSON.stringify(pending.map(row => row.contract));
  if (host.adapters.has(id)) throw new Error('Creature volumes already installed');
  // All source/rig checks precede binding any actual actor.
  const trails = pending.flatMap(row => row.pose instanceof TrailCreatureVolumes ? [row.pose] : []);
  for (const row of pending) {
    if (row.pose !== undefined) row.actor.bindHitVolumes(row.pose);
    if (row.locks !== undefined) row.actor.bindLockPoints(row.locks);
    if (row.strikes !== undefined) row.actor.bindStrikePoints(row.strikes);
  }
  const adapter = { snapshot: () => contract, restore: (saved: unknown) => {
    if (saved !== contract) throw new Error('Incompatible creature volumes continuation');
  } };
  host.adapters.set(id, adapter);
  host.scope.onDispose(() => { if (host.adapters.get(id) === adapter) host.adapters.delete(id); });
  if (trails.length > 0) installTrails(host, trails);
}

/** CC23b: a serpent's strike sockets ride its trail bones (a sweep `from: tail` starts where the tail is now). */
function trailSocket(pose: TrailCreatureVolumes, joints: readonly { readonly name: string }[]): (index: number, at: readonly [number, number, number], out: Vector3) => Vector3 {
  return (index, _at, out) => {
    const bone = pose.bones.indexOf(joints[index]?.name ?? '');
    if (bone === -1) throw new Error('A serpent strike socket sits on a trail bone');
    return pose.bone(bone, out);
  };
}

/** CC22/CC23b: every serpent's ring takes the root on the 10 Hz sample ticks, after the bodies move; the rings are state. */
function installTrails(host: SimHost, trails: readonly TrailCreatureVolumes[]): void {
  host.onStep('creatures.trails', () => { for (const trail of trails) trail.sample(host.state.tick); }, {
    snapshot: () => trails.map(trail => trail.snapshot()),
    restore: saved => {
      if (!Array.isArray(saved) || saved.length !== trails.length) throw new Error('Incompatible trail continuation');
      trails.forEach((trail, index) => { trail.restore(saved[index]); });
    },
  }, 'afterBodies');
}

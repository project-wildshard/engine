import { parse } from 'valibot';
import { CreatureBodySchema } from '@wildshard/format/creatureLayers';
import { CREATURE_SIZES } from '@wildshard/format/creatureSizes';
import { resolveSkinLookFiles, skinLookParameters } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { RestCreatureVolumes, type CreatureRestJoint } from '../../../shared/game/shardfile/creatureVolumes';
import { CreatureSockets } from '../../../shared/game/shardfile/creatureSockets';
import { ClipCreatureVolumes } from '../../../shared/game/shardfile/creatureClipVolumes';
import { PartHealth } from '../../../shared/game/shardfile/partHealth';
import { TrailCreatureVolumes } from '../../../shared/game/shardfile/trailCreatureVolumes';
import { TailCreatureVolumes } from '../../../shared/game/shardfile/tailCreatureVolumes';
import type { Vector3 } from 'three';
import { checkCreatureHeight } from './creatureSizes';
import { bodyContract } from '../../../shared/game/shardfile/creatureContract';
import { creatureRestRig } from '../../../shared/game/shardfile/creatureRestRig';
import { creatureSkinBounds } from '../../../shared/game/shardfile/creatureSkinBounds';

/** The actual admitted skin supplies rest joints. Native rows with no body layer
 * install nothing, retaining their existing posed-volume/publication owner. */
export function installCreatureVolumes(host: SimHost, shard: Pick<Shardfile, 'rows' | 'files' | 'creatures'>,
  assets: ReadonlyMap<string, Uint8Array>): void {
  // QA 2026-11-23 row 2b4: spawns share skins, so each skin GLB is read once per install (its rest rig per joint list,
  // and its bounds); every spawn still gets its own joint rows, and a refused skin refuses at the same first spawn.
  const rigs = new Map<Uint8Array, Map<string, readonly CreatureRestJoint[]>>(), bounds = new Map<Uint8Array, { lower: number; upper: number }>();
  const restRig = (bytes: Uint8Array, expected: readonly string[]): readonly CreatureRestJoint[] => {
    const byJoints = rigs.get(bytes) ?? new Map<string, readonly CreatureRestJoint[]>(), key = JSON.stringify(expected);
    let rig = byJoints.get(key);
    if (rig === undefined) { rig = creatureRestRig(bytes, expected); byJoints.set(key, rig); rigs.set(bytes, byJoints); }
    return rig.map(joint => ({ name: joint.name, parent: joint.parent, position: [joint.position[0], joint.position[1], joint.position[2]] }));
  };
  const skinBounds = (bytes: Uint8Array): { lower: number; upper: number } => {
    let known = bounds.get(bytes);
    if (known === undefined) { known = creatureSkinBounds(bytes); bounds.set(bytes, known); }
    return known;
  };
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
    if (!needsPorts) { checkCreatureHeight(body, bytes, actor, undefined, skinBounds); return []; }
    const joints = restRig(bytes, skin.row.rig.joints[0] ?? []);
    const root = { position: actor.position, get yaw() { return actor.yaw; }, get scale() { return actor.scale; } };
    const parameters = skinLookParameters(look);
    const pose = body.skeleton === 'serpent' ? new TrailCreatureVolumes(body, root, (x, z) => host.heightAt(x, z))
      : body.stance === 'horizontal' ? new TailCreatureVolumes(body, joints, root)
      : body.hits === 'clip' ? new ClipCreatureVolumes(body, bytes, joints, actor, () => host.clock.now, parameters.attackSpan, parameters.clipMap)
      : body.skeleton === undefined && body.volumes === undefined ? undefined : new RestCreatureVolumes(body, joints, root);
    checkCreatureHeight(body, bytes, actor, pose, skinBounds);
    const canonicalSockets = bodyContract(body)?.sockets;
    for (const name of strikeNames) {
      if (canonicalSockets?.[name] === undefined && !skin.row.rig.sockets.includes(name)) throw new Error(`species ${spawn.species}: unknown strike socket ${name}`);
    }
    const strikes = strikeNames.length === 0 ? undefined : new CreatureSockets(body, joints, root, {
      names: strikeNames,
      ...(pose instanceof ClipCreatureVolumes ? { posed: pose.socket.bind(pose) }
        : pose instanceof TrailCreatureVolumes ? { posed: trailSocket(pose, joints) }
        : pose instanceof TailCreatureVolumes ? { posed: (index: number, _at: readonly [number, number, number], out: Vector3) => pose.socket(joints[index]?.name ?? '', out) } : {}),
    });
    // CC31: authored volumes with hp break at 0 (their volume goes off and `creature.part-broken` fires once)
    const hp = new Map((body.volumes ?? []).flatMap(row => row.hp === undefined ? [] : [[row.part, row.hp] as const]));
    if (hp.size > 0 && pose === undefined) throw new Error(`species ${spawn.species}: part hp needs hit volumes`);
    // CC30b: a volume's break channel goes to 1 as it breaks, so every page reads the break off the actor channels
    const breaks = new Map((body.volumes ?? []).flatMap(row => row.channel === undefined ? [] : [[row.part, (body.channels ?? []).findIndex(channel => channel.name === row.channel)] as const]));
    const onBreak = breaks.size === 0 ? undefined : (part: string): void => { const index = breaks.get(part); if (index !== undefined && index >= 0) actor.channels[index] = 1; };
    // CC36a: a body that stands again has its parts whole, and each break channel back at its declared start
    const onWhole = breaks.size === 0 ? undefined : (part: string): void => {
      const index = breaks.get(part); if (index !== undefined && index >= 0) actor.channels[index] = body.channels?.[index]?.initial ?? 0;
    };
    const parts = hp.size === 0 || pose === undefined ? undefined : new PartHealth(pose, hp, actor.combatActor(), host.combat, host.events, host.scope, onBreak, onWhole);
    return [{ actor, pose: parts?.pose ?? pose, parts, trail: pose instanceof TrailCreatureVolumes || pose instanceof TailCreatureVolumes ? pose : undefined,
      locks: body.skeleton === undefined && body.lock === undefined ? undefined : new CreatureSockets(body, joints, root),
      strikes, contract: { id: spawn.id, body, skin: skin.hash, joints, ...(strikes === undefined ? {} : { strikeNames }) } }];
  });
  if (pending.length === 0) return;
  const id = 'creatures.volumes', contract = JSON.stringify(pending.map(row => row.contract));
  if (host.adapters.has(id)) throw new Error('Creature volumes already installed');
  // All source/rig checks precede binding any actual actor.
  const trails = pending.flatMap(row => row.trail === undefined ? [] : [row.trail]);
  const parts = pending.flatMap(row => row.parts === undefined ? [] : [row.parts]);
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
  if (parts.length > 0) installParts(host, parts);
}

/** CC31: every part's remaining hp is saved state. */
function installParts(host: SimHost, parts: readonly PartHealth[]): void {
  const id = 'creatures.parts';
  if (host.adapters.has(id)) throw new Error('Part hp already installed');
  const adapter = { snapshot: () => parts.map(row => row.snapshot()), restore: (saved: unknown) => {
    if (!Array.isArray(saved) || saved.length !== parts.length) throw new Error('Incompatible part hp continuation');
    parts.forEach((row, index) => { row.restore(saved[index]); });
  } };
  host.adapters.set(id, adapter);
  host.scope.onDispose(() => { if (host.adapters.get(id) === adapter) host.adapters.delete(id); });
}

/** CC23b: a serpent's strike sockets ride its trail bones (a sweep `from: tail` starts where the tail is now). */
function trailSocket(pose: TrailCreatureVolumes, joints: readonly { readonly name: string }[]): (index: number, at: readonly [number, number, number], out: Vector3) => Vector3 {
  return (index, _at, out) => {
    const bone = pose.bones.indexOf(joints[index]?.name ?? '');
    if (bone === -1) throw new Error('A serpent strike socket sits on a trail bone');
    return pose.bone(bone, out);
  };
}

/** A trail ring the sim samples and saves: a serpent's (CC23b) or a horizontal biped's tail (CC58b). */
interface TrailState { sample: (tick: number) => void; snapshot: () => { head: number; size: number; points: number[] }; restore: (saved: unknown) => void }

/** CC22/CC23b/CC58b: every trail ring takes its root on the 10 Hz sample ticks, after the bodies move; the rings are state. */
function installTrails(host: SimHost, trails: readonly TrailState[]): void {
  host.onStep('creatures.trails', () => { for (const trail of trails) trail.sample(host.state.tick); }, {
    snapshot: () => trails.map(trail => trail.snapshot()),
    restore: saved => {
      if (!Array.isArray(saved) || saved.length !== trails.length) throw new Error('Incompatible trail continuation');
      trails.forEach((trail, index) => { trail.restore(saved[index]); });
    },
  }, 'afterBodies');
}

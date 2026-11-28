/**
 * Exported skins as the client's creature views (SHARD-PLATFORM SF16, the render half of the creature seam). Each
 * `platform.skin` look row (`./skins`) loads its SF9c skin once per level (`loadSkin`: the admitted GLB checked against
 * its row's rig and declared cost, scope-owned) and becomes an ordinary engine `SpeciesLook`: a custom rig whose hull is
 * the skin's geometry and joints, drawn with the binding's family material, and whose `animate` samples the skin's clips
 * from the creature's state — the same state the platform brain writes into the bound view (alive, attack phase, hit
 * flinch, gait). One-shots (attack, hit, die) run from their trigger and hold their last frame; loops (idle, walk,
 * idle.graze) carry their numeric pose layers, compiled once per skin and shared by every instance.
 *
 *   const skins = await loadClientSkins(source, assets, compile, scope);   // world stage (the phone tier loads a look's phone skin)
 *   clientSpeciesLooks(rows, recipes, materials, skins);                   // kit stage
 */
import { macrotask } from '@wildshard/engine/boot/plan';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { buildTier, type Tier } from '@wildshard/engine/core/tier';
import { BufferAttribute, DoubleSide, Euler, InterpolateLinear, Matrix4, Quaternion, Vector3, MeshStandardMaterial, MeshLambertMaterial, type AnimationClip, type Bone, type BufferGeometry, type Material, type KeyframeTrack, type Interpolant } from 'three';
import { is } from 'valibot';
import type { ClipName } from '@wildshard/engine/anim/rig';
import type { RunningAbility } from '@wildshard/engine/ai/strikes';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import { BipedRigPose } from '@wildshard/engine/entities/animalRig';
import type { AnimalSpecies, BoneDef, RigAnimCtx } from '@wildshard/engine/entities/species/registry';
import { NO_FUR } from '@wildshard/engine/entities/species/rigs';
import { prepareCookedSkinUv } from '@wildshard/engine/render/cookedSkinUv';
import { Gunfire } from '@wildshard/engine/fx/gunfire';
import { holdQuestRewards } from '../quest/reward';
import { loadSkin } from './skinPlayback';
import { compileSkinPoseLayers, bindSkinPoseLayers, type CompiledSkinPoseLayers } from './skinLayerPlayback';
import { resolveSkinLookTier, skinLookParameters } from '@wildshard/format/skinAssets';
import { SkinClipNameSchema, type CreatureSkinClipName } from '@wildshard/format/skinData';
import { SKIN_LOOK_RECIPE, type SkinClipMap, type SkinClipState } from '@wildshard/format/skins';
import { skinTextureRefsOn } from '../../../shared/game/shardfile/tableTextureRefs';
import { CREATURE_SKELETONS, skeletonBones, trailBoneNames } from '@wildshard/format/creatureSkeletons';
import type { CreatureBody } from '@wildshard/format/creatureLayers';
import type { ShardRows } from '@wildshard/format/rows';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { creatureClipName } from '../../../shared/game/shardfile/creatureClipChoice';
import { bodyContract } from '../../../shared/game/shardfile/creatureContract';

interface SampledTrack { bone: string; property: 'position' | 'quaternion' | 'scale'; interpolant: Interpolant }
interface SampledClip { duration: number; tracks: readonly SampledTrack[]; layers: CompiledSkinPoseLayers | null }
/** One loaded skin: the shared hull, its joints, sampled clips and the family material, all owned by the level scope. */
export interface ClientSkin {
  readonly id: string;
  readonly geometry: BufferGeometry;
  readonly doubleSided?: boolean;
  readonly bones: readonly BoneDef[];
  /** a fresh family material per rig (the hit flash writes its emissive), scope-owned like the loader's catalogue */
  readonly material: () => MeshStandardMaterial | MeshLambertMaterial;
  /** TE-ENG10: one fresh look material per mapped GLB material (geometry groups 1..n), per rig; none without a map */
  readonly parts: readonly (() => Material)[];
  readonly clips: ReadonlyMap<CreatureSkinClipName, SampledClip>;
  readonly skeleton: string;
  readonly sockets: readonly string[];
  readonly attackSpan: number;
  readonly clipMap?: SkinClipMap;
  /** Exact authored variant ids; entries share the admitted rig/material contract. */
  readonly variants?: ReadonlyMap<string, ClientSkin>;
}

const PROPERTIES = new Set(['position', 'quaternion', 'scale']);
function sampled(clip: AnimationClip, joints: readonly Bone[]): SampledClip['tracks'] {
  const names = new Map(joints.map(bone => [bone.uuid, bone.name]));
  return clip.tracks.map((track: KeyframeTrack) => {
    const dot = track.name.lastIndexOf('.'), target = track.name.slice(0, dot), bone = names.get(target) ?? target, property = track.name.slice(dot + 1);
    if (dot <= 0 || !PROPERTIES.has(property)) throw new Error(`skin clip ${clip.name}: unsupported track ${track.name}`);
    if (track.getInterpolation() !== InterpolateLinear) throw new Error(`skin clip ${clip.name}: sampled tracks are linear`);
    // a quaternion track's linear factory slerps (QuaternionLinearInterpolant)
    return { bone, property: property as SampledTrack['property'], interpolant: track.InterpolantFactoryMethodLinear() };
  });
}
/** The hull's rest joints from its inverse binds; a factory skeleton is position-only, so a rotated or scaled bind is refused. */
function restBones(bones: readonly Bone[], inverses: readonly Matrix4[], id: string): BoneDef[] {
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), world = new Matrix4();
  return bones.map((bone, i) => {
    const inverse = inverses[i]; if (inverse === undefined) throw new Error(`skin ${id}: missing inverse bind`);
    world.copy(inverse).invert().decompose(position, rotation, scale);
    if (Math.abs(Math.abs(rotation.w) - 1) > 1e-5 || Math.abs(scale.x - 1) + Math.abs(scale.y - 1) + Math.abs(scale.z - 1) > 1e-5) throw new Error(`skin ${id}: the bind pose must be unrotated and unscaled`);
    const parent = bones.find((candidate) => candidate === bone.parent);
    return { name: bone.name, parent: parent?.name ?? null, pos: [position.x, position.y, position.z] };
  });
}

/** Future instances need the family entry, not the parsed binding's consumed pose tables. */
function materialFactory(compile: (entry: unknown) => Material, entry: unknown): () => MeshStandardMaterial | MeshLambertMaterial {
  return () => {
    const compiled = compile(entry);
    if (!(compiled instanceof MeshStandardMaterial) && !(compiled instanceof MeshLambertMaterial)) throw new Error('Creature surface requires a lit platform material');
    return compiled;
  };
}

/**
 * Load every skin look of `source` from admitted bytes (`assets`, the library closure) with its binding's family
 * material (`compile`, the loader's material compiler). Keyed by look row id; everything is disposed with `scope`.
 */
export async function loadClientSkins(source: Pick<Shardfile, 'rows' | 'files' | 'look'>, assets: ReadonlyMap<string, Uint8Array>, compile: (entry: unknown) => Material, scope: Scope, tier: Tier = buildTier()): Promise<ReadonlyMap<string, ClientSkin>> {
  const skins = new Map<string, ClientSkin>();
  for (const look of source.rows.looks) {
    if (look.recipe !== SKIN_LOOK_RECIPE) continue;
    if (skins.size > 0) await macrotask(); // SF67: a skin a task (the template's two were one 124-132 ms task at 4x CPU)
    // ONE-FORMAT CC51b, OF23f: the phone tier draws the look's lighter phone skin and, on a variant look, its phone
    // variant table (same rig, clips, sockets and material); tier selection never fetches the desktop skins there
    const parameters = skinLookParameters(look), resolved = resolveSkinLookTier(source, look, { assets, tier });
    const loaded = new Map<string, ClientSkin>();
    for (const file of [resolved.skin, ...(resolved.variants?.values() ?? [])]) {
      if (!loaded.has(file.hash)) loaded.set(file.hash, await loadClientSkin(file, {
        source, assets, compile, scope, lookId: look.id, attackSpan: parameters.attackSpan,
        ...(parameters.clipMap === undefined ? {} : { clipMap: parameters.clipMap }),
      }));
    }
    const skin = loaded.get(resolved.skin.hash); if (skin === undefined) throw new Error(`skin look ${look.id}: unloaded default`);
    const variants = resolved.variants === undefined ? undefined : new Map([...resolved.variants].map(([id, file]) => {
      const value = loaded.get(file.hash); if (value === undefined) throw new Error(`skin look ${look.id}: unloaded variant ${id}`);
      return [id, value] as const;
    }));
    skins.set(look.id, variants === undefined ? skin : { ...skin, variants });
  }
  return skins;
}

/**
 * ONE-FORMAT OF27b5: a skin material that reads vertex colours (the painterly family's default) over a GLB with no
 * COLOR_0 needs a white colour channel before its first draw. The family's own draw-time fallback comes too late for a
 * skin: three has already cached the mesh's buffers without it, and the skin draws black from then on.
 */
export function colourForVertexMaterial(geometry: BufferGeometry, material: Material): void {
  if (!('vertexColors' in material) || !material.vertexColors || geometry.hasAttribute('color')) return;
  const white = ownedArray(Uint8Array, geometry.getAttribute('position').count * 3, { owner: 'game/skins', asset: 'skin-colour' }).fill(255);
  geometry.setAttribute('color', new BufferAttribute(white, 3, true));
}

interface SkinLoadContext { source: Pick<Shardfile, 'look'>; assets: ReadonlyMap<string, Uint8Array>; compile: (entry: unknown) => Material; scope: Scope; lookId: string; attackSpan: number; clipMap?: SkinClipMap }
async function loadClientSkin({ row, binding }: ReturnType<typeof resolveSkinLookTier>['skin'], { source, assets, compile, scope, lookId, attackSpan, clipMap }: SkinLoadContext): Promise<ClientSkin> {
    const glb = assets.get(row.file); if (glb === undefined) throw new Error(`skin look ${lookId}: missing admitted skin GLB`);
    const material = materialFactory(compile, binding.material);
    // TE-ENG10: the binding's GLB material name -> look.materials id, as props.materials maps a prop's; each mapped part
    // one more draw per rig (and one more shadow draw where the rig casts)
    const mapped = Object.entries(binding.materials ?? {});
    const parts = mapped.map(([, id]) => {
      const entry = source.look.materials[id]; if (entry === undefined) throw new Error(`skin look ${lookId}: no look material ${id}`);
      return (): Material => compile(entry);
    });
    const drawn = material();
    const player = await loadSkin(glb, row, binding, drawn, scope, mapped.map(([name]) => name));
    await macrotask(); // the GLB's parse and the clips' sampling a task apart
    const geometry = player.mesh.geometry, joints = player.mesh.skeleton.bones;
    colourForVertexMaterial(geometry, drawn);
    if (parts.length === 0) { geometry.clearGroups(); geometry.addGroup(0, geometry.index?.count ?? geometry.getAttribute('position').count, 0); }
    // animated limbs and the corpse never leave this (the factory's margin for procedural creatures)
    geometry.computeBoundingSphere(); if (geometry.boundingSphere !== null) geometry.boundingSphere.radius += 0.6;
    const clips = new Map<CreatureSkinClipName, SampledClip>();
    for (const [name, clip] of player.rig.clips) {
      const layers = binding.poseLayers?.[name];
      clips.set(name, { duration: clip.duration, tracks: sampled(clip, joints), layers: layers === undefined ? null : compileSkinPoseLayers(layers, joints.map((bone) => bone.name)) });
    }
    // Instances use sampled tracks; the temporary player's mixer never plays.
    // Keep its mesh/skeleton scope-owned, but release unused actions/bindings.
    player.machine.dispose();
    return { id: row.id, geometry, ...(drawn.side === DoubleSide ? { doubleSided: true } : {}), bones: restBones(joints, player.mesh.skeleton.boneInverses, row.id), material, parts, clips,
      skeleton: row.rig.skeleton, sockets: row.rig.sockets, attackSpan, ...(clipMap === undefined ? {} : { clipMap }) };
}

/** The part of the engine's per-frame rig context a skin's clip choice reads. */
export type SkinDriveState = Pick<RigAnimCtx, 'dt' | 't' | 'alive' | 'flinch' | 'attack' | 'speed' | 'strafe' | 'scale' | 'phase' | 'state'>;
const _q = new Quaternion();
const BIPED_BONES = skeletonBones(CREATURE_SKELETONS.biped);
/** A shot's follow-through, played as the round leaves (QA 11-19 row 42); a skin without it keeps its old choice. */
const FIRE_CLIP = 'attack.fire' as CreatureSkinClipName;
/** The attack progress a windup must reach before its end counts as a shot (a stagger cancels it earlier). */
const RELEASE = 0.75;
/** The clip states plus the shot's follow-through. */
type DriverClip = SkinClipState | 'fire';
/** The bone a gun-carrying skin fires from. */
const MUZZLE = 'muzzle';
const _muzzle = new Vector3();
const _pitch = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);
/**
 * ONE-FORMAT CC58b2: a contract's forward pitch on its bone (a horizontal biped's spine), applied over whatever the skin
 * driver posed this frame. A driver that leaves the bone alone would compound it, so each frame first takes off the
 * pitch it put on (a driver that rewrote the bone already dropped it).
 */
export class SkinPitch {
  private readonly pitched = new WeakMap<Bone, Quaternion>();
  private readonly pitch: { readonly bone: string; readonly angle: number };
  constructor(pitch: { readonly bone: string; readonly angle: number }) {
    this.pitch = pitch;}
  /** Before the driver: undo last frame's pitch where the bone still carries it. */
  before(bones: Record<string, Bone>): void {
    const bone = bones[this.pitch.bone], last = bone === undefined ? undefined : this.pitched.get(bone);
    if (bone !== undefined && last !== undefined && bone.quaternion.equals(last)) bone.quaternion.premultiply(_pitch.setFromAxisAngle(_xAxis, -this.pitch.angle));
  }
  /** After the driver: lean the bone by the pitch in its parent's frame. */
  after(bones: Record<string, Bone>): void {
    const bone = bones[this.pitch.bone]; if (bone === undefined) return;
    bone.quaternion.premultiply(_pitch.setFromAxisAngle(_xAxis, this.pitch.angle));
    const seen = this.pitched.get(bone);
    if (seen === undefined) this.pitched.set(bone, bone.quaternion.clone()); else seen.copy(bone.quaternion);
  }
}
/** One creature's playback (one per rig's bone record): which clip, from when, and its pose layers bound to this instance's bones. */
export class SkinDriver {
  private readonly skin: ClientSkin;
  private readonly bones: Record<string, Bone>;
  private readonly biped: BipedRigPose | undefined;
  private readonly layers = new Map<CreatureSkinClipName, ReturnType<typeof bindSkinPoseLayers>>();
  private active: ReturnType<typeof bindSkinPoseLayers> | undefined;
  private state: DriverClip | null = null;
  /** seconds since the current clip began */
  private since = 0;
  private flinch = 0;
  /** seconds into the hit reaction, -1 when none is playing */
  private hitT = -1;
  /** the attack progress seen last frame, to catch the windup's end */
  private lastAttack = -1;
  /** seconds into the shot's follow-through (`attack.fire`), -1 when none is playing */
  private fireT = -1;
  /**
   * QA 11-19 row 42: true on the frame a windup runs out with the creature alive (the strike runner cancels the attack
   * phase as its active window opens): the moment a gun's round leaves. The look draws the muzzle's flash and tracer.
   */
  released = false;
  constructor(skin: ClientSkin, bones: Record<string, Bone>, skeleton?: CreatureBody['skeleton']) {
    this.skin = skin; this.bones = bones;
    this.biped = skeleton === 'biped' && BIPED_BONES.every(name => Object.hasOwn(bones, name)) ? new BipedRigPose(bones) : undefined;
    const ordered = skin.bones.map((def) => { const bone = bones[def.name]; if (bone === undefined) throw new Error(`skin ${skin.id}: missing joint ${def.name}`); return bone; });
    for (const [name, clip] of skin.clips) if (clip.layers !== null) this.layers.set(name, bindSkinPoseLayers(clip.layers, ordered));
  }
  /** The clip the creature's state asks for: death, then the attack, the hit reaction, the gait, idle (grazing when it grazes). */
  private choose(c: SkinDriveState, ability?: RunningAbility): DriverClip | null {
    // a new blow raises the flinch (Animal.stagger / applyDamage); the reaction plays once from its start
    if (c.alive && c.flinch > this.flinch + 0.05) this.hitT = 0; else if (this.hitT >= 0) this.hitT += c.dt;
    this.flinch = c.flinch;
    if (this.hitT >= (this.skin.clips.get(this.name('hit'))?.duration ?? 0)) this.hitT = -1;
    // the windup ran out (not cut short by a stagger): the round leaves and the follow-through plays from its start
    const progress = ability?.progress ?? c.attack;
    this.released = c.alive && ability === undefined && progress < 0 && this.lastAttack >= RELEASE;
    this.lastAttack = progress;
    if (this.released) this.fireT = 0; else if (this.fireT >= 0) this.fireT += c.dt;
    if (!c.alive || this.fireT >= (this.skin.clips.get(FIRE_CLIP)?.duration ?? 0)) this.fireT = -1;
    if (!c.alive) return this.skin.clips.has(this.name('die')) ? 'die' : null;
    if (progress >= 0 && this.skin.clips.has(this.name('attack', ability))) return 'attack';
    if (this.fireT >= 0) return 'fire';
    if (this.hitT >= 0 && this.skin.clips.has(this.name('hit'))) return 'hit';
    if (Math.hypot(c.speed, c.strafe) / c.scale > 0.15 && this.skin.clips.has(this.name('walk'))) return 'walk';
    if (c.state === 'graze' && this.skin.clips.has(this.name('idle.graze'))) return 'idle.graze';
    return this.skin.clips.has(this.name('idle')) ? 'idle' : null;
  }
  private name(state: DriverClip, ability?: RunningAbility): CreatureSkinClipName {
    return state === 'fire' ? FIRE_CLIP : creatureClipName(state, this.skin.clipMap, this.skin.clips, ability);
  }
  /** Pose this instance's bones for the frame. */
  step(c: SkinDriveState, freshBase = false, ability?: RunningAbility): void {
    this.biped?.reset();
    const state = this.choose(c, ability);
    if (state === null) {
      if (this.biped !== undefined && c.alive) this.biped.walk(c.phase, Math.hypot(c.speed, c.strafe) / c.scale);
      return;
    }
    const name = this.name(state, ability), clip = this.skin.clips.get(name); if (clip === undefined) return;
    this.since = state === this.state ? this.since + c.dt : 0; this.state = state;
    // one-shots from their trigger (the export sampled each from it), the walk from the gait phase, idles on the clock
    const time = state === 'die' ? this.since : state === 'attack' ? (ability?.progress ?? c.attack) * this.skin.attackSpan : state === 'hit' ? this.hitT
      : state === 'fire' ? this.fireT : state === 'walk' ? c.phase * clip.duration : c.t;
    const looping = state === 'walk' || state.startsWith('idle'), at = looping ? time % clip.duration : Math.min(time, clip.duration);
    // A native poser already rebuilt this frame's base; restoring last frame's
    // cached layer base here would freeze its otherwise untracked gait joints.
    if (!freshBase && this.biped === undefined) this.active?.restore();
    const tracks = clip.tracks;
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index]; if (track === undefined) throw new Error('Missing skin track');
      const bone = this.bones[track.bone]; if (bone === undefined) continue;
      const value = track.interpolant.evaluate(at);
      if (track.property === 'quaternion') bone.quaternion.copy(_q.fromArray(value)); else bone[track.property].fromArray(value);
    }
    this.active = this.layers.get(name); this.active?.apply(time);
  }
}

/**
 * ONE-FORMAT OF27b: the textures this tier's skin files name (each skin file's dependencies after its GLB): the look's
 * skin and its variants', or on the phone tier its phone skin's and phone variants' where it has them, as `loadClientSkins`
 * draws them.
 */
export function skinTextureRefs(source: Pick<Shardfile, 'rows' | 'files'>, tier: Tier = buildTier()): string[] {
  // SF28: one list with the admission's and the cook's (`tableTextureRefs`)
  return skinTextureRefsOn(source, tier);
}

/** Select once for every creature view owner, including entered grid cells. */
export function clientVariantSkin(skin: ClientSkin, id: string): ClientSkin {
  if (skin.variants === undefined) return skin;
  const selected = skin.variants.get(id);
  if (selected === undefined) throw new Error(`skin ${skin.id}: unknown variant ${id}`);
  return selected;
}

/**
 * QA 11-19 row 42 (Jake: "They're clearly shooting at me, but there's no particle effects ... There's no bullets"): a
 * skin with a `muzzle` bone fires a visible round as its windup runs out (the flash, a puff of smoke and an enemy tracer
 * past the eye). Call after the driver's step, on any page that draws the skin.
 */
export function creatureGunfire(driver: SkinDriver, bones: Record<string, Bone>): void {
  const muzzle = bones[MUZZLE];
  if (!driver.released || muzzle === undefined) return;
  muzzle.updateWorldMatrix(true, false);
  Gunfire.current()?.enemyRound(muzzle.getWorldPosition(_muzzle));
}

/** s: the thrash, when the body starts to sink, how long it takes to go under, and when the loot bursts from the hole */
const THRASH_SECONDS = 1.6, SINK_AT = 0.9, SINK_SECONDS = 2.6, LOOT_AT = 1.5;
/** m the body sinks (a leap's arch included), and rad of the thrash's swing at each trail bone */
const SINK_DEPTH = 14, THRASH_SWING = 0.2;
const _ground = new Vector3(), _thrash = new Quaternion(), _euler = new Euler();
/**
 * QA 11-19 row 44 (Jake on the Dust Wyrm: "It has zero satisfying death animation"): a serpent's death, played over the
 * trail its body lies on. It thrashes (a whip down the trail that dies away), a burst of sand and a jolt of the view as
 * it goes, then sinks back under the sand along its whole length, dust rising where it goes down, and its loot bursts
 * out of the hole. The quest card waits for it (`holdQuestRewards`). Alive again (a retry, a respawn), it resets.
 *
 *   const death = new SerpentDeath(trailBoneNames(count));
 *   death.step(alive, dt, bones, rootY, rootScale);   // after the trail is laid, every frame
 */
export class SerpentDeath {
  private t = -1;
  private nextDust = 0;
  private dusted = 0;
  /** the trail's pose as it died: each frame starts from it, since a dead body's bones are not posed again */
  private readonly rest = new Map<Bone, { readonly position: Vector3; readonly quaternion: Quaternion }>();
  private readonly trail: readonly string[];
  constructor(trail: readonly string[]) {
    this.trail = trail;}
  step(alive: boolean, dt: number, bones: Record<string, Bone>, groundY: number, scale: number): void {
    if (alive) { this.t = -1; this.dusted = 0; this.rest.clear(); return; }
    const head = bones[this.trail[0] ?? '']; if (head === undefined) return;
    const fire = Gunfire.current(), last = this.t;
    this.t = last < 0 ? 0 : last + dt;
    for (const name of this.trail) {
      const bone = bones[name]; if (bone === undefined) continue;
      const rest = this.rest.get(bone);
      if (rest === undefined) this.rest.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
      else { bone.position.copy(rest.position); bone.quaternion.copy(rest.quaternion); }
    }
    const t = this.t, crossed = (at: number): boolean => last < at && t >= at;
    // the whip: each bone swings a little out of step with the one ahead, so the body writhes along its length
    const swing = THRASH_SWING * Math.max(0, 1 - t / THRASH_SECONDS);
    if (swing > 0) for (let k = 1; k < this.trail.length; k++) {
      const bone = bones[this.trail[k] ?? '']; if (bone === undefined) continue;
      const wave = Math.sin(t * 14 - k * 0.8);
      bone.quaternion.multiply(_thrash.setFromEuler(_euler.set(0.35 * swing * Math.cos(t * 11 - k * 0.6), swing * wave, 0)));
    }
    // under: the head (every bone hangs from it) goes down; a body lying high (the leap's arch) goes with it
    const u = Math.min(1, Math.max(0, (t - SINK_AT) / SINK_SECONDS)), sink = SINK_DEPTH * u * u * (3 - 2 * u);
    head.position.y -= sink / scale;
    if (fire === null) return;
    const at = (bone: Bone | undefined): Vector3 => {
      if (bone === undefined) return _ground.set(0, groundY, 0);
      bone.updateWorldMatrix(true, false); bone.getWorldPosition(_ground); _ground.y = groundY; return _ground;
    };
    if (last < 0) {
      holdQuestRewards(SINK_AT + SINK_SECONDS + 0.8);
      fire.dust(at(head), 5, 12); fire.quake(_ground, 0.7);
    }
    if (crossed(SINK_AT)) {
      for (let k = 0; k < this.trail.length; k += 3) fire.dust(at(bones[this.trail[k] ?? '']), 2.5, 4);
      fire.quake(at(head), 0.45);
    }
    if (crossed(LOOT_AT)) fire.shower(at(head).setY(groundY + 0.6));
    if (u > 0 && u < 1 && t >= this.nextDust) {
      this.nextDust = t + 0.3;
      fire.dust(at(bones[this.trail[(this.dusted++ * 5) % this.trail.length] ?? '']), 2, 3);
    }
  }
}

/** A custom-rig engine look over a loaded skin; the platform brain's state drives the clip choice per instance. */
export function skinSpeciesLook(row: ShardRows['looks'][number], species: ShardRows['species'][number], skin: ClientSkin, lendCoat = false): SpeciesLook {
  const drivers = new WeakMap<Record<string, Bone>, SkinDriver>();
  if (lendCoat) {
    prepareCookedSkinUv(skin.geometry);
    for (const variant of skin.variants?.values() ?? []) prepareCookedSkinUv(variant.geometry);
  }
  // fresh joint and dims records per call: the factory owns what it is handed
  const select = (id: string): ClientSkin => clientVariantSkin(skin, id);
  const coats = lendCoat ? new Map<ClientSkin, ReturnType<ClientSkin['material']>['map']>() : null;
  const coat = (selected: ClientSkin): ReturnType<ClientSkin['material']>['map'] => {
    if (coats === null) return null;
    const known = coats.get(selected);
    if (known !== undefined) return known;
    const material = selected.material(), texture = material.map;
    coats.set(selected, texture); material.dispose();
    return texture;
  };
  const bones = (selected: ClientSkin): BoneDef[] => selected.bones.map((bone): BoneDef => ({ name: bone.name, parent: bone.parent, pos: [bone.pos[0], bone.pos[1], bone.pos[2]] }));
  const dims = (): AnimalSpecies['dims'] => ({ ...species.dims, feet: species.dims.feet.map(([x, z]): [number, number] => [x, z]) });
  const quadruped = species.body?.skeleton === 'quadruped';
  // CC58b2: a horizontal biped leans its spine and lays its tail on the trail its volumes ride
  const contract = species.body === undefined ? undefined : bodyContract(species.body);
  const pitch = contract?.pitch === undefined ? undefined : new SkinPitch(contract.pitch), trail = contract?.trail ?? [];
  const deaths = species.body?.skeleton === 'serpent' && species.body.trail !== undefined ? new WeakMap<Record<string, Bone>, SerpentDeath>() : undefined;
  const serpentBones = species.body?.trail === undefined ? [] : trailBoneNames(species.body.trail.count);
  // QA 11-19 row 44: the death plays on whichever path posed the body this frame (a dead Wyrm's came by the clip path)
  const serpentDeath = (c: RigAnimCtx): void => {
    if (deaths === undefined) return;
    let death = deaths.get(c.bones);
    if (death === undefined) { death = new SerpentDeath(serpentBones); deaths.set(c.bones, death); }
    death.step(c.alive, c.dt, c.bones, c.position.y, c.scale);
  };
  const animate = (c: RigAnimCtx): void => {
    const pose = c.animal.hitVolumes;
    if (pose?.joint !== undefined) {
      for (const [name, bone] of Object.entries(c.bones)) if (!pose.joint(name, bone.position, bone.quaternion, bone.scale)) throw new Error(`Missing authoritative skin joint ${name}`);
      serpentDeath(c);
      return;
    }
    let driver = drivers.get(c.bones);
    if (driver === undefined) {
      driver = new SkinDriver(select(c.animal.variant), c.bones, species.body?.skeleton);
      drivers.set(c.bones, driver);
    }
    pitch?.before(c.bones);
    driver.step(c, quadruped, c.animal.runningAbility);
    pitch?.after(c.bones);
    creatureGunfire(driver, c.bones);
    if (pose?.trailJoint !== undefined) for (const name of trail) {
      const bone = c.bones[name]; if (bone !== undefined) pose.trailJoint(name, bone.position, bone.quaternion, bone.scale);
    }
    serpentDeath(c);
  };
  return { id: row.id, species: species.id, kind: species.kind, rig: quadruped ? 'quadruped' : 'custom', fur: NO_FUR,
    rigContract: { skeleton: quadruped ? 'kit.quadruped' : skin.skeleton, sockets: [...skin.sockets],
      clips: [...skin.clips.keys()].filter((name): name is ClipName => is(SkinClipNameSchema, name)) },
    // the procedural stand-in is the hull itself (the factory swaps in `skin`'s shared geometry before any rig is made)
    build: (variant) => { const selected = select(variant.id); return { bones: bones(selected), furParts: [], hardParts: [selected.geometry.clone()], eyeParts: [], dims: dims() }; },
    // OF27b: each variant wears its own coat (its skin file's material: maps, sheen, rim, glow)
    material: (_sky, _glow, _intensity, variant) => (variant === undefined ? skin : select(variant.id)).material(),
    ...(skin.parts.length === 0 ? {} : { partMaterials: () => skin.parts.map((part) => part()) }),
    skin: (variant) => {
      const selected = select(variant.id);
      return { geometry: selected.geometry, ...(selected.doubleSided === true ? { doubleSided: true } : {}), map: coat(selected), normalMap: null, bones: bones(selected), overgrown: false };
    },
    ...(quadruped ? { postPose: animate } : { animate }),
  };
}

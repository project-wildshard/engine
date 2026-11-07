/**
 * Exported skins as the client's creature views (SHARD-PLATFORM SF16, the render half of the creature seam). Each
 * `platform.skin` look row (`./skins`) loads its SF9c skin once per level (`loadSkin`: the admitted GLB checked against
 * its row's rig and declared cost, scope-owned) and becomes an ordinary engine `SpeciesLook`: a custom rig whose hull is
 * the skin's geometry and joints, drawn with the binding's family material, and whose `animate` samples the skin's clips
 * from the creature's state — the same state the platform brain writes into the bound view (alive, attack phase, hit
 * flinch, gait). One-shots (attack, hit, die) run from their trigger and hold their last frame; loops (idle, walk,
 * idle.graze) carry their numeric pose layers, compiled once per skin and shared by every instance.
 *
 *   const skins = await loadClientSkins(source, assets, compile, scope);   // world stage
 *   clientSpeciesLooks(rows, recipes, materials, skins);                   // kit stage
 */
import { macrotask } from '@wildshard/engine/boot/plan';
import { InterpolateLinear, Matrix4, Quaternion, Vector3, MeshStandardMaterial, MeshLambertMaterial, type AnimationClip, type Bone, type BufferGeometry, type Material, type KeyframeTrack, type Interpolant } from 'three';
import type { ClipName } from '@wildshard/engine/anim/rig';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import type { AnimalSpecies, BoneDef, RigAnimCtx } from '@wildshard/engine/entities/species/registry';
import { NO_FUR } from '@wildshard/engine/entities/species/rigs';
import { loadSkin } from './skinPlayback';
import { compileSkinPoseLayers, bindSkinPoseLayers, type CompiledSkinPoseLayers } from './skinLayerPlayback';
import { parseSkinFile, skinLookParameters } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import type { ShardRows } from '@wildshard/format/rows';
import type { Shardfile } from '@wildshard/format/shardSchema';

interface SampledTrack { bone: string; property: 'position' | 'quaternion' | 'scale'; interpolant: Interpolant }
interface SampledClip { duration: number; tracks: readonly SampledTrack[]; layers: CompiledSkinPoseLayers | null }
/** One loaded skin: the shared hull, its joints, sampled clips and the family material, all owned by the level scope. */
export interface ClientSkin {
  readonly id: string;
  readonly geometry: BufferGeometry;
  readonly bones: readonly BoneDef[];
  /** a fresh family material per rig (the hit flash writes its emissive), scope-owned like the loader's catalogue */
  readonly material: () => MeshStandardMaterial | MeshLambertMaterial;
  readonly clips: ReadonlyMap<ClipName, SampledClip>;
  readonly skeleton: string;
  readonly sockets: readonly string[];
  readonly attackSpan: number;
}

const PROPERTIES = new Set(['position', 'quaternion', 'scale']);
function sampled(clip: AnimationClip): SampledClip['tracks'] {
  return clip.tracks.map((track: KeyframeTrack) => {
    const dot = track.name.lastIndexOf('.'), bone = track.name.slice(0, dot), property = track.name.slice(dot + 1);
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
export async function loadClientSkins(source: Pick<Shardfile, 'rows' | 'files'>, assets: ReadonlyMap<string, Uint8Array>, compile: (entry: unknown) => Material, scope: Scope): Promise<ReadonlyMap<string, ClientSkin>> {
  const skins = new Map<string, ClientSkin>();
  for (const look of source.rows.looks) {
    if (look.recipe !== SKIN_LOOK_RECIPE) continue;
    if (skins.size > 0) await macrotask(); // SF67: a skin a task (the template's two were one 124-132 ms task at 4x CPU)
    const parameters = skinLookParameters(look), json = assets.get(parameters.skin); if (json === undefined) throw new Error(`skin look ${look.id}: missing admitted skin file`);
    const { row, binding } = parseSkinFile(json), declared = source.files.find((file) => file.hash === parameters.skin);
    if (declared?.dependencies.length !== 1 || declared.dependencies[0] !== row.file) throw new Error(`skin look ${look.id}: the skin file must depend on exactly its GLB`);
    const glb = assets.get(row.file); if (glb === undefined) throw new Error(`skin look ${look.id}: missing admitted skin GLB`);
    const material = materialFactory(compile, binding.material);
    const player = await loadSkin(glb, row, binding, material(), scope);
    await macrotask(); // the GLB's parse and the clips' sampling a task apart
    const geometry = player.mesh.geometry, joints = player.mesh.skeleton.bones;
    geometry.clearGroups(); geometry.addGroup(0, geometry.index?.count ?? geometry.getAttribute('position').count, 0);
    // animated limbs and the corpse never leave this (the factory's margin for procedural creatures)
    geometry.computeBoundingSphere(); if (geometry.boundingSphere !== null) geometry.boundingSphere.radius += 0.6;
    const clips = new Map<ClipName, SampledClip>();
    for (const [name, clip] of player.rig.clips) {
      const layers = binding.poseLayers?.[name];
      clips.set(name, { duration: clip.duration, tracks: sampled(clip), layers: layers === undefined ? null : compileSkinPoseLayers(layers, joints.map((bone) => bone.name)) });
    }
    // Instances use sampled tracks; the temporary player's mixer never plays.
    // Keep its mesh/skeleton scope-owned, but release unused actions/bindings.
    player.machine.dispose();
    skins.set(look.id, { id: row.id, geometry, bones: restBones(joints, player.mesh.skeleton.boneInverses, row.id), material, clips, skeleton: row.rig.skeleton, sockets: row.rig.sockets, attackSpan: parameters.attackSpan });
  }
  return skins;
}

/** The part of the engine's per-frame rig context a skin's clip choice reads. */
export type SkinDriveState = Pick<RigAnimCtx, 'dt' | 't' | 'alive' | 'flinch' | 'attack' | 'speed' | 'strafe' | 'scale' | 'phase' | 'state'>;
const _q = new Quaternion();
/** One creature's playback (one per rig's bone record): which clip, from when, and its pose layers bound to this instance's bones. */
export class SkinDriver {
  private readonly skin: ClientSkin;
  private readonly bones: Record<string, Bone>;
  private readonly layers = new Map<ClipName, ReturnType<typeof bindSkinPoseLayers>>();
  private active: ReturnType<typeof bindSkinPoseLayers> | undefined;
  private clip: ClipName | null = null;
  /** seconds since the current clip began */
  private since = 0;
  private flinch = 0;
  /** seconds into the hit reaction, -1 when none is playing */
  private hitT = -1;
  constructor(skin: ClientSkin, bones: Record<string, Bone>) {
    this.skin = skin; this.bones = bones;
    const ordered = skin.bones.map((def) => { const bone = bones[def.name]; if (bone === undefined) throw new Error(`skin ${skin.id}: missing joint ${def.name}`); return bone; });
    for (const [name, clip] of skin.clips) if (clip.layers !== null) this.layers.set(name, bindSkinPoseLayers(clip.layers, ordered));
  }
  /** The clip the creature's state asks for: death, then the attack, the hit reaction, the gait, idle (grazing when it grazes). */
  private choose(c: SkinDriveState): ClipName | null {
    // a new blow raises the flinch (Animal.stagger / applyDamage); the reaction plays once from its start
    if (c.alive && c.flinch > this.flinch + 0.05) this.hitT = 0; else if (this.hitT >= 0) this.hitT += c.dt;
    this.flinch = c.flinch;
    if (this.hitT >= (this.skin.clips.get('hit')?.duration ?? 0)) this.hitT = -1;
    if (!c.alive) return this.skin.clips.has('die') ? 'die' : null;
    if (c.attack >= 0 && this.skin.clips.has('attack')) return 'attack';
    if (this.hitT >= 0 && this.skin.clips.has('hit')) return 'hit';
    if (Math.hypot(c.speed, c.strafe) / c.scale > 0.15 && this.skin.clips.has('walk')) return 'walk';
    if (c.state === 'graze' && this.skin.clips.has('idle.graze')) return 'idle.graze';
    return this.skin.clips.has('idle') ? 'idle' : null;
  }
  /** Pose this instance's bones for the frame. */
  step(c: SkinDriveState): void {
    const name = this.choose(c); if (name === null) return;
    const clip = this.skin.clips.get(name); if (clip === undefined) return;
    this.since = name === this.clip ? this.since + c.dt : 0; this.clip = name;
    // one-shots from their trigger (the export sampled each from it), the walk from the gait phase, idles on the clock
    const time = name === 'die' ? this.since : name === 'attack' ? c.attack * this.skin.attackSpan : name === 'hit' ? this.hitT : name === 'walk' ? c.phase * clip.duration : c.t;
    const looping = name === 'walk' || name.startsWith('idle'), at = looping ? time % clip.duration : Math.min(time, clip.duration);
    this.active?.restore();
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

/** A custom-rig engine look over a loaded skin; the platform brain's state drives the clip choice per instance. */
export function skinSpeciesLook(row: ShardRows['looks'][number], species: ShardRows['species'][number], skin: ClientSkin): SpeciesLook {
  const drivers = new WeakMap<Record<string, Bone>, SkinDriver>();
  // fresh joint and dims records per call: the factory owns what it is handed
  const bones = (): BoneDef[] => skin.bones.map((bone): BoneDef => ({ name: bone.name, parent: bone.parent, pos: [bone.pos[0], bone.pos[1], bone.pos[2]] }));
  const dims = (): AnimalSpecies['dims'] => ({ ...species.dims, feet: species.dims.feet.map(([x, z]): [number, number] => [x, z]) });
  return { id: row.id, species: species.id, kind: species.kind, rig: 'custom', fur: NO_FUR,
    rigContract: { skeleton: skin.skeleton, sockets: [...skin.sockets], clips: [...skin.clips.keys()] },
    // the procedural stand-in is the hull itself (the factory swaps in `skin`'s shared geometry before any rig is made)
    build: () => ({ bones: bones(), furParts: [], hardParts: [skin.geometry.clone()], eyeParts: [], dims: dims() }),
    material: () => skin.material(),
    skin: () => ({ geometry: skin.geometry, map: null, normalMap: null, bones: bones(), overgrown: false }),
    animate: (c) => { let driver = drivers.get(c.bones); if (driver === undefined) { driver = new SkinDriver(skin, c.bones); drivers.set(c.bones, driver); } driver.step(c); },
  };
}

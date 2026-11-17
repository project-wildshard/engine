import * as THREE from 'three';
import { BakedHerd, GaitRecorder } from './bakedHerd';
import { HerdSprites } from './herdSprites';
import type { SpriteViews } from '../render/spriteViews';

/**
 * ONE-FORMAT CC54b / CC55b: what draws a far creature, per model, by distance (the tier's rows):
 *
 *   rig (posed live) ── animalBakedDist ── baked herd (one draw) ── animalHideDist ── cards (one draw) ── animalSpriteDist
 *
 * The baked herd's gait is recorded from the model's own rigs while they walk inside animalBakedDist (GaitRecorder: one
 * slot per gait phase), so a far animal shows the pose its poser gives it at its own phase; until the recording is
 * whole, far animals stay rigs as before. A rig a herd draws does not pose its bones (posesLive) and draws nothing of
 * its own (the caller hides it). Corpses, fading and pinned bodies (a boss) are always rigs. 0 turns a band off.
 */
export interface LodTier {
  readonly baked: number;
  readonly hide: number;
  readonly sprite: number;
}

/** what the bands read from an animal */
export interface LodRig {
  readonly mesh: THREE.SkinnedMesh;
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly scale: number;
  readonly alive: boolean;
  readonly fading: boolean;
  readonly drawPinned: boolean;
  readonly speed: number;
  readonly gaitPhase: number;
  /** this frame's update left the bones as they were (the pose cadence skipped it): nothing new to record */
  readonly poseFrozen: boolean;
}

/** what the bands need from a model: its rig geometry, a fresh body material, its views (null: that band stays off) */
export interface LodSource<M> {
  geometry: (model: M) => THREE.BufferGeometry;
  material: (model: M) => THREE.Material | null;
  views: (model: M) => SpriteViews | null;
}

/** gait slots recorded per model; the copies one herd (and one card set) holds */
export const LOD_FRAMES = 32, LOD_CAPACITY = 64;
/** a rig records only while it walks: below this it stands, and its phase stands with it */
const WALKING = 0.3;
/** cards fade out over the last share of the card band, as rigs did at animalHideDist (E117: no pop) */
const CARD_FADE = 0.15;

interface ModelBands {
  recorder: GaitRecorder | null;
  herd: BakedHerd | null;
  /** undefined until first asked for; null when the model has no views */
  cards: HerdSprites | null | undefined;
  herdCount: number;
  cardCount: number;
  /** the herd held every copy last frame: the rest stay rigs, and pose */
  full: boolean;
  /** the model's look has no herd material: never record it again */
  refused: boolean;
}

export type LodDraw = 'rig' | 'baked' | 'card' | 'none';

const _p = new THREE.Vector3();

export class CreatureLods<M extends object> {
  readonly group: THREE.Group = new THREE.Group();
  private readonly models = new Map<M, ModelBands>();
  private readonly source: LodSource<M>;

  constructor(source: LodSource<M>) {
    this.source = source;
    this.group.name = 'creature-lods';
  }

  private bands(model: M): ModelBands {
    let b = this.models.get(model);
    if (b === undefined) { b = { recorder: null, herd: null, cards: undefined, herdCount: 0, cardCount: 0, full: false, refused: false }; this.models.set(model, b); }
    return b;
  }

  begin(): void { for (const b of this.models.values()) { b.herdCount = 0; b.cardCount = 0; } }

  /** whether the model's herd is baked (the rig may stop posing in its band) */
  baked(model: M): boolean { const b = this.models.get(model); return b !== undefined && b.herd !== null && !b.full; }

  /** Whether `a`'s rig must pose its bones this frame: not while its model's herd or cards draw it. */
  posesLive(a: LodRig, model: M, d2: number, tier: LodTier): boolean {
    if (!a.alive || a.fading || a.drawPinned) return true;
    if (tier.baked > 0 && d2 >= tier.baked * tier.baked && d2 < tier.hide * tier.hide) return !this.baked(model);
    return !(tier.sprite > tier.hide && d2 >= tier.hide * tier.hide);
  }

  /** What draws `a` this frame at `d2` m² from the camera; 'baked' and 'card' took a copy, 'none' is past every band. */
  draw(a: LodRig, model: M, d2: number, tier: LodTier, tint?: THREE.Color): LodDraw {
    if (!a.alive || a.fading || a.drawPinned) return 'rig';
    const b = this.bands(model);
    if (tier.baked > 0 && d2 < tier.baked * tier.baked) { this.record(a, model, b); return 'rig'; }
    if (d2 < tier.hide * tier.hide) {
      if (tier.baked <= 0 || b.herd === null || b.herdCount >= b.herd.capacity) return 'rig';
      a.mesh.updateMatrix();
      b.herd.placeMatrix(b.herdCount++, a.mesh.matrix, a.gaitPhase, 0, tint);
      return 'baked';
    }
    if (tier.sprite <= tier.hide || d2 >= tier.sprite * tier.sprite) return 'none';
    if (b.cards === undefined) {
      const views = this.source.views(model);
      b.cards = views === null ? null : new HerdSprites(views, LOD_CAPACITY);
      if (b.cards !== null) this.group.add(b.cards.mesh);
    }
    if (b.cards === null || b.cardCount >= LOD_CAPACITY) return 'none';
    const d = Math.sqrt(d2), fade = Math.min(1, (tier.sprite - d) / (tier.sprite * CARD_FADE));
    b.cards.place(b.cardCount++, _p.copy(a.position), a.yaw, a.scale * fade * fade * (3 - 2 * fade));
    return 'card';
  }

  /** a walking rig inside the live band fills its model's gait slot for its phase, once */
  private record(a: LodRig, model: M, b: ModelBands): void {
    if (b.herd !== null || b.refused || a.poseFrozen || Math.abs(a.speed) < WALKING) return;
    const recorder = b.recorder ??= new GaitRecorder(a.mesh.skeleton.bones.length, LOD_FRAMES);
    if (a.mesh.skeleton.bones.length !== recorder.bones || !recorder.wants(a.gaitPhase)) return;
    a.mesh.updateMatrixWorld(true);
    if (!recorder.record(a.mesh, a.mesh, a.gaitPhase)) return;
    const material = this.source.material(model);
    b.recorder = null;
    if (material === null) { b.refused = true; return; }
    b.herd = new BakedHerd(this.source.geometry(model), recorder.bake(), LOD_CAPACITY, material);
    this.group.add(b.herd.mesh);
  }

  /** the copies taken this frame are drawn; the rest are not */
  end(): void {
    for (const b of this.models.values()) {
      if (b.herd !== null) { b.full = b.herdCount >= b.herd.capacity; b.herd.setCount(b.herdCount); b.herd.mesh.visible = b.herdCount > 0; b.herd.update(0); }
      if (b.cards !== undefined && b.cards !== null) { b.cards.setCount(b.cardCount); b.cards.mesh.visible = b.cardCount > 0; b.cards.update(); }
    }
  }

  dispose(): void {
    for (const b of this.models.values()) { b.herd?.dispose(); b.cards?.dispose(); }
    this.models.clear();
    this.group.clear();
  }
}

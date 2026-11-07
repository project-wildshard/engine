/**
 * The world registry (PHYSICS.md P2b, ENGINE-FIT E1): one `add(piece)` per built thing, and everything that needs the
 * list of built things listens here instead of being wired by hand in main.ts — the scene, the physics world (the
 * piece's `ColliderDesc`s become Rapier colliders in src/shared/engine/physics/pieces.ts), the player's floors while the P2 bridge
 * lasts, the ocean's foam rings — and Explore World (X10): a piece with `model` is a model in the Model Explorer's
 * catalog, and `models()` / `picks` are what src/client/engine/explore/registry.ts serves. One list: a built thing is registered once
 * and is drawn, collides and is explorable from that one `add`.
 *
 * E306 / E315 (project/archive/2026-09-30-model-architecture.md): models move onto the model contract, src/client/engine/models/model.ts. There
 * `place(model, placements, …)` makes the `add` — one piece per call, and the model's one catalog entry — and `sets`
 * holds the named groups of placements. A hand-written `model` on a piece is the old way; M6 removes it.
 *
 * `ColliderDesc` is engine-neutral data: builders emit it beside the geometry they draw and never import Rapier.
 */
import type * as THREE from 'three';
import type { Material } from '../../../shared/engine/physics/surface';
import type { Tier } from '../core/tier';
import type { Animal } from '../entities/AnimalView';
import { app } from '../app/runtime';
import { currentOwner, enteredOwner } from '../../../shared/engine/app/ownership';
import type { Scope } from '../../../shared/engine/app/scope';
import type { PlayerMode } from '../../../shared/engine/combat/health';
import { labelObjectTree } from '../render/gpuLabels';

interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }

/** How a collider is placed: a centre, and either a turn about +Y (three's convention) or a full rotation. */
interface Placed { x: number; y: number; z: number; yaw?: number; rot?: Quat; surface?: Material }

export type ColliderDesc =
  /** a box: half-extents along its own axes */
  | Placed & { kind: 'box'; hx: number; hy: number; hz: number }
  /** an upright capsule (or tilted by `rot`): the straight part's half-height, the radius */
  | Placed & { kind: 'capsule'; halfHeight: number; radius: number }
  | Placed & { kind: 'ball'; radius: number }
  /** a convex hull of points given relative to (x, y, z) */
  | Placed & { kind: 'hull'; points: Float32Array }
  /** a triangle mesh relative to (x, y, z) — only where you walk inside or over irregular geometry */
  | Placed & { kind: 'trimesh'; vertices: Float32Array; indices: Uint32Array }
  /**
   * a stair: `count` boxes rising `rise` each from `from` (the foot of the first tread) toward `to` (the top edge,
   * at from.y + count × rise), `width` across — built as treads, never as a ramp (PHYSICS.md: autostep climbs them).
   */
  | { kind: 'treads'; from: Vec3; to: Vec3; width: number; count: number; surface?: Material };

export type PieceCategory = 'buildings' | 'nature' | 'props' | 'creatures' | 'people' | 'gear' | 'ground';

/** Explore's catalog tabs (E315 M5: People — the crowd, camp people, NPCs — apart from Creatures; Gear, what the player holds) */
export type ModelCategory = 'buildings' | 'nature' | 'creatures' | 'people' | 'gear' | 'props';

/**
 * How a model is made (E306): the Model Explorer card's badge. `code` is procedural three.js; `blender` a Blender
 * script's GLB; `trellis` / `hunyuan` the image-to-3D generators (scripts/img2mesh/); `cc0` a downloaded CC0 file.
 */
export type Pipeline = 'code' | 'blender' | 'trellis' | 'hunyuan' | 'cc0';

/**
 * How a model's copies are drawn (E306): `single` one object per copy; `merged` the copies welded into one mesh
 * (per cell); `instanced` one InstancedMesh per part; `batched` one BatchedMesh per material (multi-draw); `skinned` a
 * rig (bones).
 */
export type DrawnAs = 'single' | 'merged' | 'instanced' | 'batched' | 'skinned';

/** The facts a catalog card shows about a model (E306 M0a); each is optional and read from the object when absent. */
export interface ModelFacts {
  /** how it's made (a camp built in code and dressed with TRELLIS props lists both) */
  pipeline?: Pipeline | readonly Pipeline[];
  /** how many copies this shard draws */
  copies?: number;
  /** how they're drawn */
  drawnAs?: DrawnAs;
  /** VIEW IN WORLD: the world box of the real copy nearest `near` (default: the catalog object's own box) */
  worldBox?: (near: THREE.Vector3) => THREE.Box3 | null;
  /**
   * A creature on the species rigs (src/engine/entities/species/, E315 M5): the AnimalManager kind the Model Explorer stands up
   * on its turntable as an Animal, so its clip row plays the species' own gaits (idle · walk · trot · charge · hit · die)
   */
  species?: string;
  /** a creature's dressing: what its live code adds to a copy, put on the turntable's Animal too (the Antler King's lanterns) */
  dress?: (animal: Animal) => void;
}

/** A piece as a model in Explore's catalog: what `place` / `listModel` (src/client/engine/models/) register, the model's one entry. */
export interface ModelEntry extends ModelFacts {
  /** the model's id (`<slug>/<name>`, `shared/<name>`): one catalog entry per id, whatever piece carries it */
  id: string;
  category: ModelCategory;
  /** true: `object()` is already in the scene (the Model Explorer isolates it in place); false: it builds one on first view */
  live: boolean;
  object: () => THREE.Object3D;
  /** Retire a view-scoped catalogue build without changing live world copies. */
  release?: () => void;
  ready?: () => Promise<void>;
  /** a batch member's builder at a given detail tier (DETAIL TIERS); absent → one build for every tier */
  buildAt?: (tier: Tier) => THREE.Object3D;
  /** Material or skin variants shown on the same turntable card. */
  variants?: readonly { id: string; label: string }[];
  /** Rebuild the displayed specimen in place when a variant is selected. */
  rebuild?: (variant?: string) => void;
  /** false for a model-only specimen that has no sensible World Explorer landing point. */
  worldView?: boolean;
}

/** a model in Explore's catalog, as it reads it (`WorldRegistry.models()`) */
export interface RegisteredModel extends ModelFacts {
  id: string;
  name: string;
  category: ModelCategory;
  /** the source module an agent edits for this model */
  file: string;
  /** true: `object()` is already in the scene (the Model Explorer isolates it in place) */
  live: boolean;
  object: () => THREE.Object3D;
  release?: () => void;
  ready?: () => Promise<void>;
  buildAt?: (tier: Tier) => THREE.Object3D;
  variants?: readonly { id: string; label: string }[];
  rebuild?: (variant?: string) => void;
  worldView?: boolean;
}

/**
 * A set (E306 / E315 M7): a named group of placements — a camp, a market square, a kurgan field — explorable as one
 * thing between single models and the whole world. It owns no geometry: its members are placed models.
 */
export interface RegisteredSet {
  id: string;
  name: string;
  /** the module that composes it */
  file: string;
  /** each member model (its catalog id) and how many copies of it the set places */
  members: readonly { model: string; copies: number }[];
  /** where it stands, world space */
  bounds: THREE.Box3;
  /** what draws it: each member `place` call as it was made (the Sets explorer frames, outlines and measures the set by these) */
  placed?: readonly SetPlacement[];
  /** the named place it is (`<slug>/<id>` in its shard's list of named places, M12) */
  place?: string;
  /** the place's models not on the contract yet (held by another lane): their ids */
  pending?: readonly string[];
}

/** one `place` call in a set, as Explore reads it (a `Placed`, src/client/engine/models/place.ts) */
export interface SetPlacement {
  readonly model: string;
  /** what draws its copies (shared by several members when they are drawn into one kit) */
  readonly object: THREE.Object3D;
  readonly copies: number;
  /** copy i's world box */
  copyBox: (i: number, target: THREE.Box3) => THREE.Box3;
}

/** a tap target that is not a registered model's own object: a batch mesh (one palm out of all of them) */
export interface RegisteredPick {
  object: THREE.Object3D;
  /** the registered model a hit on it opens */
  entry: string;
  /** the selection box for a hit at `point`; default: the object's box */
  boxAt?: (point: THREE.Vector3) => THREE.Box3;
  /**
   * The copy under a hit at `point`, or null when the point is on none of the entry's copies (E323): an object several
   * things are drawn into (a Nine Dragon kit, a Nalati place's painted mesh) is a model's only where its copy stands; the
   * rest of it is the world's. Absent: every hit on the object is the entry's.
   */
  claim?: (point: THREE.Vector3) => THREE.Box3 | null;
  /**
   * The nearest of its copies' boxes the ray enters before `far` metres (not one it starts inside): a tap that threads a
   * copy's open shape (between a table's legs, beside a laundry line) and lands on the world behind it is still that
   * copy's (E323). Only for objects copies are drawn into, with `claim`.
   */
  boxHit?: (ray: THREE.Ray, far: number) => { readonly box: THREE.Box3; readonly distance: number } | null;
}

export interface Piece {
  id: string;
  name: string;
  category: PieceCategory;
  /** the source module an agent edits for it */
  file: string;
  /** what's drawn; added to the scene by the registry's scene listener */
  object?: THREE.Object3D;
  /** where it stands (Explore's VIEW IN WORLD); defaults to the object's bounds' centre */
  anchor?: THREE.Vector3;
  /** static collision, in world space */
  colliders?: ColliderDesc[];
  /** what the colliders are made of, unless a desc says otherwise */
  surface?: Material;
  /**
   * The stable id its colliders answer to in physics queries (`tagOf(collider).owner`), in place of the piece itself:
   * a level whose static floors are also declared data (a collider row a traversal binds by id, `canStandAt`'s
   * `floorOwner`) registers them under that id. Absent: the piece is the owner.
   */
  colliderOwner?: string;
  /**
   * The piece's floor as a function (decks, terraces, stairs as a ramp): placement (quest props, spawns) and footsteps
   * read it through `registry.floorAt`. Unless `solidFloor`, the player also stands on it (the P2 bridge).
   */
  floor?: (x: number, z: number) => number | undefined;
  /** the floor is in `colliders` as real geometry (P4 / P3): the player walks on those, not on `floor` */
  solidFloor?: boolean;
  /**
   * A piece that moves (the boat on the swell): its `colliders` are given in `follows`'s LOCAL frame and ride a
   * kinematic body posed from `follows`'s world transform every fixed step; a character standing on it is carried.
   */
  follows?: THREE.Object3D;
  /** Translate with the object while keeping the collider's authored world orientation (standing NPC boxes). */
  followRotation?: boolean;
  /** Collide only while this says so (a door mid-swing is let through, never pins anyone). */
  active?: () => boolean;
  /**
   * Collide only in this player mode (SF34: a hover-only deck is `mode: 'board'`, solid under the hoverboard and air on
   * foot): `add` turns it into `active`, read from the level's player (`app.player.mode`). Never both with `active`.
   */
  mode?: PlayerMode;
  /** the model's catalog entry (`models()`), set only by `place` / `listModel` (src/client/engine/models/): check-models rule 6 fails any other */
  model?: ModelEntry;
}

export class WorldRegistry {
  readonly pieces: Piece[] = [];
  /** E357 F2: preserve the existing public pieces array used by maps and model tools. */
  pieceList(): readonly Piece[] { return this.pieces; }
  /** Explore's tap targets on batch meshes */
  readonly picks: RegisteredPick[] = [];
  /** the sets placed on this shard (E306 M7: explored between single models and the world) */
  readonly sets: RegisteredSet[] = [];
  private readonly listeners: ((p: Piece) => void)[] = [];
  private readonly retirers = new Set<() => void>();
  private retiredAt = false;
  /**
   * The object whose space this world's content stands in (SF63): a grid region's view root, at the cell's render offset.
   * `place`'s cullers measure the camera from it (`FrameCamera`), as its copies' boxes are in that space. null: the scene's.
   */
  frame: THREE.Object3D | null = null;
  /**
   * The lifetime of the world this registry describes, when it has one of its own (a grid region's view scope). A
   * registration made outside any `withOwner` section (after an `await` in a resident's build) then belongs to it, not to
   * the page's ambient owner (SF57). null: the ambient owner, as a standalone page's registry.
   */
  scope: Scope | null = null;

  /** true once `retire` ran: the world this registry describes has left */
  get retired(): boolean { return this.retiredAt; }
  /**
   * Run `fn` when this registry retires (SF57: what `place` recorded and the cullers it started for this world go with it);
   * at once when it already has. Returns a forget.
   */
  onRetire(fn: () => void): () => void {
    if (this.retiredAt) { fn(); return () => undefined; }
    this.retirers.add(fn);
    return () => { this.retirers.delete(fn); };
  }
  /** The world this registry describes has left (a grid region's view disposing): every `onRetire`, once, in the order added. */
  retire(): void {
    if (this.retiredAt) return;
    this.retiredAt = true;
    const fns = [...this.retirers];
    this.retirers.clear();
    for (const fn of fns) fn();
  }

  /**
   * `remove` runs when the current owner disposes. SF57: the owner a registration sees after an `await` in a resident shard's
   * build is the page's scope, not the shard's — so the owner's hold on `remove` (and the piece it closes over) is dropped
   * when this registry retires, or every shard visit's pieces would live as long as the page.
   */
  private untilOwnerOrRetire(remove: () => void): void {
    const owner = this.scope === null ? currentOwner() : enteredOwner() ?? this.scope;
    if (owner === null) return;
    if (owner.disposed) { remove(); return; } // (as a disposed scope's onDispose: at once)
    const hold = { forgetRetire: (): void => undefined };
    const forget = owner.capture('disposers', () => { hold.forgetRetire(); remove(); });
    hold.forgetRetire = this.onRetire(forget);
  }

  /** Register a built thing: every listener sees it now; later listeners see it on subscribe. */
  add<P extends Piece>(piece: P): P {
    const mode = piece.mode;
    if (mode !== undefined) {
      if (piece.active !== undefined) throw new Error(`Piece ${piece.id} sets both mode and active`);
      piece.active = () => app.player?.mode === mode;
    }
    if (piece.object) labelObjectTree(piece.object, piece.id, `${piece.file}#${piece.name}`);
    this.pieces.push(piece);
    this.untilOwnerOrRetire(() => { const i = this.pieces.indexOf(piece); if (i !== -1) this.pieces.splice(i, 1); });
    for (const l of this.listeners) l(piece);
    return piece;
  }

  /** Called for every piece already added and every one added after. */
  onAdd(fn: (p: Piece) => void): void {
    this.listeners.push(fn);
    this.untilOwnerOrRetire(() => { const i = this.listeners.indexOf(fn); if (i !== -1) this.listeners.splice(i, 1); });
    for (const p of this.pieces) fn(p);
  }

  get(id: string): Piece | undefined { return this.pieces.find((p) => p.id === id); }

  /** Explore's catalog: every piece with a `model`, once per catalog id (a later registration replaces an earlier one in place). */
  models(): RegisteredModel[] {
    const out: RegisteredModel[] = [], at = new Map<string, number>();
    for (const p of this.pieces) {
      const m = p.model;
      if (!m) continue;
      const { id, category, object } = m;
      const e: RegisteredModel = {
        ...(m.release === undefined ? {} : { release: m.release }), ...(m.ready === undefined ? {} : { ready: m.ready }),
        id, name: p.name, category, file: p.file, live: m.live, object, ...(m.buildAt ? { buildAt: m.buildAt } : {}), ...(m.variants ? { variants: m.variants } : {}), ...(m.rebuild ? { rebuild: m.rebuild } : {}), ...(m.worldView === false ? { worldView: false } : {}),
        ...(m.pipeline === undefined ? {} : { pipeline: m.pipeline }), ...(m.copies === undefined ? {} : { copies: m.copies }), ...(m.drawnAs === undefined ? {} : { drawnAs: m.drawnAs }), ...(m.worldBox === undefined ? {} : { worldBox: m.worldBox }),
        ...(m.species === undefined ? {} : { species: m.species }), ...(m.dress === undefined ? {} : { dress: m.dress }),
      };
      const i = at.get(id);
      if (i === undefined) { at.set(id, out.length); out.push(e); } else out[i] = e;
    }
    return out;
  }

  addPick(p: RegisteredPick): void {
    this.picks.push(p);
    // SF57: a tap target leaves with its owner, as its piece does (a re-entered borrowed home picks again)
    this.untilOwnerOrRetire(() => { const i = this.picks.indexOf(p); if (i !== -1) this.picks.splice(i, 1); });
  }

  /** Register a set; a later one with the same id replaces it in place. */
  addSet(s: RegisteredSet): void {
    const i = this.sets.findIndex((x) => x.id === s.id);
    if (i === -1) this.sets.push(s); else this.sets[i] = s;
  }

  /** The highest piece floor at (x, z), for placement; undefined off every piece. */
  floorAt(x: number, z: number): number | undefined {
    let best: number | undefined;
    for (const p of this.pieces) { const y = p.floor?.(x, z); if (y !== undefined && (best === undefined || y > best)) best = y; }
    return best;
  }
}

/** Install the registry service: the session does, before it builds a level; a test's setup does (E434: no module installs
 *  a service by being imported — with no barrel loading every module, that would hang on import order). */
export function installWorldRegistry(): void { app.registryFactory ??= () => new WorldRegistry(); }
/** The running game's registry (bootstrap takes it); one is made on first use (a test, a tool). */
export function activeRegistry(): WorldRegistry { return app.registry; }

/** A hand-made `Collider` box (Y-rotated by −rot, with yTop / yBottom, the P2-era format) as a `ColliderDesc`. */
export function boxDesc(c: { x: number; z: number; hw: number; hd: number; rot: number; yTop: number; yBottom: number }, surface?: Material): Extract<ColliderDesc, { kind: 'box' }> {
  return { kind: 'box', x: c.x, y: (c.yTop + c.yBottom) / 2, z: c.z, hx: c.hw, hy: Math.max(0.005, (c.yTop - c.yBottom) / 2), hz: c.hd, yaw: -c.rot, ...(surface === undefined ? {} : { surface }) };
}

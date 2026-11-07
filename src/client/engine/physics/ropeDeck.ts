/**
 * A rope deck as drawn (G571): the bones, skinned deck and live floor read that follow a RopeChain's interpolated
 * segment poses. The chain itself (bodies and joints, no renderer) is `ropeChain.ts`.
 */
import { Bone, Group, Matrix4, Skeleton, SkinnedMesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import type { RopeChainSpec } from '../../../shared/engine/physics/ropeChain';

interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }

/** what poses a deck's segments: a RopeChain (or anything with its `pose`) */
export interface RopeDeckPoses { pose: (i: number, alpha: number, p: Vec3, q: Quat) => void }
const _p = { x: 0, y: 0, z: 0 }, _q = { x: 0, y: 0, z: 0, w: 1 }, _top = new Vector3();

/**
 * A rope deck as drawn: one holder (a bone) per segment, posed in the deck's own space (world minus `origin`) from a
 * chain interpolated at `alpha`, or at rest without one; and the deck's live top-centre height at each joint (segment
 * k's start edge, the last segment's end edge), world space, for the deck's floor read.
 */
export class RopeDeckView {
  private readonly live: Float32Array;
  private readonly rest: RopeChainSpec['segments'];
  private readonly halfY: number;
  private readonly origin: Vec3;
  private readonly holders: readonly Object3D[];
  constructor(rest: RopeChainSpec['segments'], halfY: number, origin: Vec3, holders: readonly Object3D[]) {
    if (holders.length < rest.length) throw new Error('Rope deck needs a holder per segment');
    this.rest = rest; this.halfY = halfY; this.origin = origin; this.holders = holders; this.live = new Float32Array(rest.length + 1);
  }

  pose(chain: RopeDeckPoses | null, alpha: number): void {
    const n = this.rest.length, o = this.origin;
    for (let i = 0; i < n; i++) {
      const sg = this.rest[i], h = this.holders[i];
      if (sg === undefined || h === undefined) continue;
      if (chain) chain.pose(i, alpha, _p, _q);
      else { _p.x = sg.x; _p.y = sg.y; _p.z = sg.z; _q.x = sg.rot.x; _q.y = sg.rot.y; _q.z = sg.rot.z; _q.w = sg.rot.w; }
      h.position.set(_p.x - o.x, _p.y - o.y, _p.z - o.z); h.quaternion.set(_q.x, _q.y, _q.z, _q.w); h.updateMatrix();
      h.matrixWorldNeedsUpdate = true;
    }
    for (let k = 0; k <= n; k++) {
      const i = Math.min(k, n - 1), sg = this.rest[i], h = this.holders[i];
      if (sg && h) this.live[k] = _top.set(0, this.halfY, k < n ? -sg.hz : sg.hz).applyMatrix4(h.matrix).y + o.y;
    }
  }

  /** the live deck height a fraction `t` (0 → 1) along the span, between the two joints either side */
  heightAt(t: number): number {
    const n = this.rest.length, k = Math.min(1, Math.max(0, t)) * n, i = Math.min(n - 1, Math.floor(k)), f = k - i;
    return (this.live[i] ?? 0) * (1 - f) + (this.live[i + 1] ?? 0) * f;
  }
}

/**
 * A drawn rope deck (G571): one holder bone per rest segment plus the posts' still anchor, a skinned deck draw bound to
 * them as they stand at rest, the deck's RopeChain spec (its holders the hit owners, so a bolt stuck in the deck rides
 * it) and the deck's floor over its span. The chain (engine/physics/ropeChain) hangs the segments; `setPoses` carries
 * their interpolated poses into the holders; `floorHeightAt` reads the live joint heights where (x, z) is over the deck.
 */
export interface RopeDeckFacts {
  /** the deck's own-space origin in the world (end a on the ground) */
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly segments: RopeChainSpec['segments'];
  /** the span's start (end a, world xz), its unit direction, its length and the deck's width (m) */
  readonly start: readonly [number, number]; readonly direction: { readonly x: number; readonly z: number };
  readonly len: number; readonly width: number;
}
export interface RopeDeckRows {
  /** a segment's half thickness (m) and weight (kg); the most segments a deck carries */
  readonly halfY: number; readonly mass: number; readonly maxSegments: number;
  /** the hit owner each segment reports, and the margin (m) the floor and the chain's width extend past the deck */
  readonly owner: { readonly id: string; readonly name: string }; readonly margin: number;
}

export class RopeDeck {
  readonly group: Group = new Group();
  private readonly holders: Bone[];
  private readonly view: RopeDeckView;
  private readonly facts: RopeDeckFacts;
  private readonly rows: RopeDeckRows;

  constructor(name: string, facts: RopeDeckFacts, draw: { readonly geometry: BufferGeometry; readonly material: Material }, rows: RopeDeckRows) {
    if (facts.segments.length > rows.maxSegments) throw new Error('Rope deck exceeds its segment bound');
    this.facts = facts; this.rows = rows; this.group.name = name;
    this.holders = Array.from({ length: facts.segments.length + 1 }, () => { const h = new Bone(); h.matrixAutoUpdate = false; this.group.add(h); return h; });
    this.view = new RopeDeckView(facts.segments, rows.halfY, facts.origin, this.holders);
    this.view.pose(null, 1);
    // one draw skinned to the holders as they stand at rest (a graph's skinning binds one skeleton: the material is its own)
    const deck = new SkinnedMesh(draw.geometry, draw.material);
    deck.castShadow = true; deck.receiveShadow = true; deck.frustumCulled = false; // it moves, and it spans its gully
    deck.bind(new Skeleton(this.holders, this.holders.map(h => h.matrix.clone().invert())), new Matrix4());
    this.group.add(deck);
  }

  /** the chain's spec: the rest segments, their size and weight, their holders as owners */
  chainSpec(): RopeChainSpec & { owners: { id: string; name: string; follows: Bone }[] } {
    const { facts, rows } = this;
    return { segments: facts.segments, hx: facts.width / 2 + rows.margin, hy: rows.halfY, mass: rows.mass,
      owners: this.holders.slice(0, facts.segments.length).map(follows => ({ id: rows.owner.id, name: rows.owner.name, follows })) };
  }

  /** Pose the holders from `chain` (interpolated by `alpha`), or at rest when null. */
  setPoses(chain: RopeDeckPoses | null, alpha: number): void { this.view.pose(chain, alpha); }

  /** the plank height under world (x, z) when over the span (the live deck while a chain poses it), else undefined */
  floorHeightAt(x: number, z: number): number | undefined {
    const { start, direction: d, len, width } = this.facts, m = this.rows.margin, dx = x - start[0], dz = z - start[1];
    const along = dx * d.x + dz * d.z, across = -dx * d.z + dz * d.x;
    if (along < -0.3 || along > len + 0.3 || Math.abs(across) > width / 2 + m) return undefined;
    return this.view.heightAt(along / len);
  }
}

/**
 * G571: a walkable rope deck as a site model, from data (`RopeDeckSiteSchema`): its model card, the spans it has rest
 * facts for (each a baked rest plan: origin, direction, length, width, the deck's segments, its own-space colliders and
 * the ground they were baked over), the fixed draws of the specimen's and the world's skinned deck, and the deck's rows.
 * A span is built where it stands: its rest facts are admitted against the live ground (a moved ground refuses), its
 * deck is the engine's RopeDeck on a copy of its draw in the kit's still look, and a placement is one `single` copy at
 * the span's origin whose registry piece answers the live deck floor. Without a physics world (the Explorer) it is
 * drawn at rest; a cold specimen waits for its draws to load.
 */
import * as THREE from 'three';
import * as v from 'valibot';
import { loadingSpecimen } from '@wildshard/engine/models/gear';
import { readColliderRows } from '@wildshard/engine/models/colliders';
import { defineModel, modelContext, type ModelDef } from '@wildshard/engine/models/model';
import { place, type Placed } from '@wildshard/engine/models/place';
import type { OwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { RopeDeck, type RopeDeckPoses } from '@wildshard/engine/physics/ropeDeck';
import type { ColliderDesc, WorldRegistry } from '@wildshard/engine/world/registry';
import { lowPolyLookMaterial } from '@wildshard/engine/world/lowpolyKit';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { RopeDeckSiteSchema, RopeDeckRestKeySchema, type RopeDeckSpan, type RopeDeckRest, type RopeDeckSiteRows } from '@wildshard/format/ropeDeckSite';

export interface RopeDeckSiteParams { readonly span: RopeDeckSpan; readonly ground: (x: number, z: number) => number }
/** The fixed draws the deck borrows (a shard's island library): their one load, readiness and slot handles. */
export interface RopeDeckDraws { readonly ready: boolean; readonly draw: (slot: string) => OwnedGeometry; readonly load: () => Promise<void> }

/** One span's built deck: the drawn group, its own-space colliders, the chain spec, posing and the live floor. */
export class RopeDeckLayout {
  private readonly deck: RopeDeck;
  /** the site's origin (own space = world - origin): end a on the ground */
  readonly o: { readonly x: number; readonly y: number; readonly z: number };
  readonly descs: ColliderDesc[];
  constructor(sky: SkyRig, at: RopeDeckSpan, facts: RopeDeckRest, slot: string, site: RopeDeckSite) {
    const rows = site.rows.deck; this.o = { ...facts.origin };
    this.descs = site.collidersOf(facts);
    if (facts.segments.length > rows.maxSegments) throw new Error('Rope deck bake exceeds its segment or collider bound');
    const geometry = site.draws.draw(slot).copy();
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(geometry.getAttribute('skinIndex').array, 4)); // the graph skins integer joints
    this.deck = new RopeDeck(site.rows.model.id.slice(site.rows.model.id.lastIndexOf('/') + 1), { origin: this.o, segments: structuredClone(facts.segments), start: at.a,
      direction: facts.direction, len: facts.len, width: facts.width }, { geometry, material: lowPolyLookMaterial(sky, 'still').clone() },
    { halfY: rows.halfY, mass: rows.mass, maxSegments: rows.maxSegments, owner: rows.owner, margin: rows.margin });
  }
  /** the skinned deck and its bones: one holder per deck segment, then the posts' still anchor */
  get mesh(): THREE.Group { return this.deck.group; }
  chainSpec(): ReturnType<RopeDeck['chainSpec']> { return this.deck.chainSpec(); }
  setPoses(poses: RopeDeckPoses | null, alpha: number): void { this.deck.setPoses(poses, alpha); }
  floorHeightAt(x: number, z: number): number | undefined { return this.deck.floorHeightAt(x, z); }
}

/** A shard's rope deck site (see the module note). */
export class RopeDeckSite {
  readonly rows: RopeDeckSiteRows;
  /** the specimen's span, read back from its bake key (its ends, width and sag) */
  readonly specimen: RopeDeckSpan;
  readonly model: ModelDef<RopeDeckSiteParams>;
  /** each world span's layout (a `place` builds it for its group; its colliders and the world's chain read the same one) */
  private readonly built = new WeakMap<RopeDeckSpan, RopeDeckLayout>();

  constructor(input: unknown, readonly draws: RopeDeckDraws) {
    this.rows = v.parse(RopeDeckSiteSchema, input);
    const baked = this.rows.spans[this.rows.specimen];
    if (baked === undefined) throw new Error('Rope deck specimen has no baked span');
    const [a, b, width, sag] = v.parse(RopeDeckRestKeySchema, JSON.parse(baked.key));
    const specimen: RopeDeckSpan = { a, b, width, sag }, flat = (): number => 0;
    this.specimen = specimen;
    const { surface, ...card } = this.rows.model;
    this.model = defineModel<RopeDeckSiteParams>({ ...card, ...(surface === undefined ? {} : { surface }), defaults: { span: specimen, ground: flat },
      // the world's copy: the layout its placement made (it drives that group's deck); a specimen: a fresh one, which waits
      // for the draws when the Explorer opens it before the world loaded them
      build: (ctx, p) => p.span !== this.specimen ? this.layout(ctx.sky, p, false).mesh : this.draws.ready ? this.layout(ctx.sky, p, true).mesh
        : loadingSpecimen(card.id, this.rows.loading, async () => { await this.draws.load(); return this.layout(ctx.sky, p, true).mesh; }),
      // the colliders read the rest plan only
      colliders: (p) => this.built.get(p.span)?.descs ?? this.restColliders(p) });
  }

  /** a span's bake key (its ends, width and sag) */
  key(at: RopeDeckSpan): string { return JSON.stringify([at.a, at.b, at.width ?? this.rows.deck.width, at.sag ?? this.rows.deck.sag]); }
  /** Only baked spans have rest facts, and only over the ground they were baked on. Moving deck poses remain live. */
  facts(at: RopeDeckSpan, ground: (x: number, z: number) => number): RopeDeckRest {
    const key = this.key(at), row = this.rows.spans.find(candidate => candidate.key === key);
    if (row === undefined) throw new Error('Unbaked rope deck span');
    if (row.ground.some(p => { const y = ground(p.x, p.z); return !Number.isFinite(y) || Math.abs(y - p.y) > 1e-6; })) throw new Error('Rope deck terrain changed; regenerate rest facts');
    return row;
  }
  /** a span's own-space colliders from its rest plan alone (nothing drawn) */
  restColliders(p: RopeDeckSiteParams): ColliderDesc[] { return this.collidersOf(this.facts(p.span, p.ground)); }
  /** a rest plan's own-space colliders, bounded */
  collidersOf(facts: RopeDeckRest): ColliderDesc[] {
    const descs = readColliderRows(facts.ownDescs, { kinds: ['box', 'treads'], surfaces: [] });
    if (descs.length > this.rows.deck.maxColliders) throw new Error('Rope deck bake exceeds its segment or collider bound');
    return descs;
  }
  private fresh(sky: SkyRig, p: RopeDeckSiteParams): RopeDeckLayout {
    const facts = this.facts(p.span, p.ground);
    return new RopeDeckLayout(sky, p.span, facts, facts.key === this.key(this.specimen) ? this.rows.draws.specimen : this.rows.draws.world, this);
  }
  /** The deck on a span: its layout, built on the first ask (`fresh`: always a new one, as an Explorer specimen). */
  layout(sky: SkyRig, p: RopeDeckSiteParams, fresh: boolean): RopeDeckLayout {
    let b = this.built.get(p.span);
    // SF63: the span outlives a world, its group does not: a layout whose group was emptied (a grid region left and its
    // scene tree was cleared) is stale, and the next world builds its own
    if (b?.mesh.children.length === 0) b = undefined;
    if (b === undefined || fresh) { b = this.fresh(sky, p); if (p.span !== this.specimen) this.built.set(p.span, b); }
    return b;
  }
  /** Place the deck on its span over the live ground: one `single` copy at its origin, its piece answering the live floor. */
  place(sky: SkyRig, at: RopeDeckSpan, registry: WorldRegistry): Pick<RopeDeckLayout, 'chainSpec' | 'setPoses' | 'floorHeightAt'> & { placed: Placed } {
    const params = { span: at, ground: terrainHeight }, lay = this.layout(sky, params, false), o = lay.o;
    const placed = place(this.model, [{ x: o.x, y: o.y, z: o.z, params }], { ctx: modelContext(sky), draw: 'single', registry,
      piece: { id: this.rows.deck.piece, floor: (px, pz) => lay.floorHeightAt(px, pz), solidFloor: true } });
    return { placed, chainSpec: () => lay.chainSpec(), setPoses: (poses, alpha) => { lay.setPoses(poses, alpha); }, floorHeightAt: (x, z) => lay.floorHeightAt(x, z) };
  }
}

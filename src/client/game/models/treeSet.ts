/** Client-only forest presentation of a baked tree set declared as rows (format/treeSetRows). */
import * as THREE from 'three';
import { resourceScope } from '@wildshard/engine/app/resources';
import { loadTexture, loadPBRArray } from '@wildshard/engine/core/assets';
import { TIER_CONFIG } from '@wildshard/engine/core/tier';
import { defineModel, type ModelContext, type ModelDef, type ModelPart } from '@wildshard/engine/models/model';
import type { LookReplaceContext } from '@wildshard/engine/render/look';
import { FOREST_BANDS, trunkCapsule } from '@wildshard/engine/world/forest/Forest';
import { BARK_LAYERS, treeSetUrls } from '@wildshard/engine/world/forest/treeSet';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { TreeFactory, isTreeMaterial, type TreeMaterial } from '@wildshard/engine/world/TreeFactory';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import type { TreeSetRows } from '@wildshard/format/treeSetRows';
import { createModelLibrary } from '../plugin/geometry';
import { lookGraphMaterials } from '../plugin/shaderFamily';
import { lendLooks, type LentLooks } from '../shardfile/lentLooks';
import { firstPartyDescriptor, loadFirstPartyProduct } from '../shardfile/runtimeProduct';

/** A first-party product's tree set rows (its `world/trees` section). */
export async function productTreeSet(slug: string): Promise<TreeSetRows> {
  const product = await loadFirstPartyProduct(slug);
  return productTreePool(product, product.section('world/trees'));
}

/** A set whose rest pool the product names (GR6: a built pool ships as a product file) reads it by its content-addressed
 *  URL; any other pool URL loads as written. */
export function productTreePool(product: { readonly hasFile: (name: string) => boolean; readonly url: (name: string) => string }, rows: TreeSetRows): TreeSetRows {
  return product.hasFile(rows.geometry.url) ? { ...rows, geometry: { ...rows.geometry, url: product.url(rows.geometry.url) } } : rows;
}

/**
 * The set's tree factory: its geometry pool, nothing baked at launch, and four materials in the forest's LOD slots:
 * painterly vertex-coloured surfaces on the page sky, or the set's look.materials graphs compiled on the page renderer
 * with its card and impostor atlases and bark array lent (the bark tiles the bark array by its per-vertex layer).
 */
export class TreeSetFactory extends TreeFactory {
  private looks: LentLooks | null = null;
  constructor(private readonly renderer: LookReplaceContext['renderer'], private readonly rows: TreeSetRows, private readonly sky: SkyRig) { super(renderer); }

  /** Set a param of the compile these graph materials came from (a page's fade and viewer, once a frame); false for a
   *  painterly set. QF22: a lent look id can resolve to another live compile of the same graph under a frame's owner. */
  setLookParam(id: string, name: string, value: GraphLiteral): boolean {
    if (this.looks === null) return false;
    this.looks.setParam(id, name, value); return true;
  }

  override async build(): Promise<this> {
    const rows = this.rows, graphs = rows.looks;
    const library = createModelLibrary({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 1, geometryPools: [rows.geometry] }, '[trees]');
    this.tintBark = rows.tintBark;
    if (graphs.kind === 'painterly') {
      await library.preload();
      this.barkMaterial = painterlyMaterial(this.sky, graphs.bark); this.needleMaterial = painterlyMaterial(this.sky, graphs.needles);
      this.twigMaterial = painterlyMaterial(this.sky, graphs.twigs); this.farMaterial = painterlyMaterial(this.sky, graphs.far);
    } else await this.graphMaterials(library.preload(), graphs);
    for (const s of rows.variants) {
      const part = (name: string): THREE.BufferGeometry => {
        const geometry = library.geometry(`${s.name}__${name}`, { borrow: true });
        if (geometry === null) throw new Error(`[trees] the set has no ${s.name}__${name}`);
        return geometry;
      };
      const trunkLo = rows.geometry.parts.includes(`${s.name}__trunkLo`) ? { trunkLo: part('trunkLo') } : {};
      this.variants.push({ trunk: part('trunk'), ...trunkLo, cardsHi: part('hi'), cardsLo: part('lo'), twigs: part('twigs'), far: part('far'),
        height: s.height, trunkRadius: s.trunk, species: s.species, collider: s.collider });
    }
    return this;
  }

  /** The look.materials graphs with the set's atlases and bark array lent, once the pool is loaded. */
  private async graphMaterials(pool: Promise<unknown>, graphs: Extract<TreeSetRows['looks'], { kind: 'graphs' }>): Promise<void> {
    const rows = this.rows, U = treeSetUrls(rows.set);
    // the loader fences compressed maps before returning; choose the final sampler while mips exist
    const sampler = (anisotropy: number) => (texture: THREE.Texture): void => { texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.anisotropy = anisotropy; };
    const cards = sampler(graphs.anisotropy.cards), far = sampler(graphs.anisotropy.far);
    const [, cardAlbedo, cardNormal, cardArm, farAlbedo, farNormal, bark, looks] = await Promise.all([
      pool,
      loadTexture(U.cardsAlbedo, true, 1, undefined, cards), loadTexture(U.cardsNormal, false, 1, undefined, cards), loadTexture(U.cardsArm, false, 1, undefined, cards),
      loadTexture(U.farAlbedo, true, 1, undefined, far), loadTexture(U.farNormal, false, 1, undefined, far),
      loadPBRArray([...BARK_LAYERS], TIER_CONFIG.layerSize),
      firstPartyDescriptor(rows.product).then(source => lookGraphMaterials(resourceScope(), { renderer: this.renderer }, source, [graphs.bark, graphs.needles, graphs.twigs, graphs.far])),
    ]);
    lendLooks(resourceScope(), looks); this.looks = looks;
    const look = (id: string, lent: Readonly<Record<string, THREE.Texture>>): TreeMaterial => {
      for (const [name, texture] of Object.entries(lent)) looks.setTexture(id, name, texture);
      const m = looks.materials.get(id);
      if (m === undefined) throw new Error(`[trees] look.materials lacks ${id}`);
      if (!isTreeMaterial(m)) throw new Error(`[trees] ${id} has no base colour (not a standard-model graph)`);
      return m;
    };
    this.barkMaterial = look(graphs.bark, { barkMap: bark.map, barkNormal: bark.normalMap, barkArm: bark.armMap });
    const card = { cardMap: cardAlbedo, cardNormal, cardArm };
    this.needleMaterial = look(graphs.needles, card);
    this.twigMaterial = look(graphs.twigs, card);
    this.farMaterial = look(graphs.far, { farMap: farAlbedo, farNormal });
  }
}

/** A tree copy: its variant (the set's order), its placement's height, trunk radius and scale (0 height: no collider). */
export interface TreeSetParams { readonly v: number; readonly height: number; readonly r: number; readonly scale: number }

/**
 * The set as one model the forest draws (`place`, its LODs the forest's bands): near the trunk, the hi cards and the
 * twigs (only within `FOREST_BANDS.twig`), then the lo trunk and cards, then the impostor dissolving in. Every copy is
 * tinted (the bark only when the factory tints it); the needle cards sort front to back. Each trunk collides as the
 * forest's capsule in the copy's frame. `use(ctx, factory)` hands the built factory to the model's context.
 */
export function treeSetModel(rows: TreeSetRows): { readonly model: ModelDef<TreeSetParams>; readonly use: (ctx: ModelContext, factory: TreeFactory) => void } {
  const key = `${rows.model.id}:factory`;
  const factoryOf = (ctx: ModelContext): TreeFactory => ctx.once<TreeFactory>(key, () => { throw new Error(`[${rows.model.id}] no tree factory`); });
  // G639 (G669 DR9): past the near band a tree draws its species' first variant's shape at its own height, so each far /
  // impostor level is one draw a species (place.ts shares a level whose parts are the same geometries and materials, each
  // variant at its `scale`)
  const shapes = rows.variants.map((s) => {
    const first = rows.variants.findIndex((r) => r.species === s.species), height = rows.variants[first]?.height ?? s.height;
    return { first, scale: s.height / height };
  });
  const band = (ctx: ModelContext, i: number, level: 'near' | 'far' | 'impostor'): ModelPart[] => {
    const shape = level !== 'near' ? shapes[i] : undefined, f = factoryOf(ctx), t = f.variants[shape?.first ?? i];
    if (!t) return [];
    const scaled = shape === undefined || shape.scale === 1 ? {} : { scale: shape.scale };
    if (level === 'impostor') return [{ geometry: t.far, material: f.farMaterial, receiveShadow: true, ...scaled }];
    if (level === 'far') return [
      { geometry: t.trunkLo ?? t.trunk, material: f.barkMaterial, castShadow: TIER_CONFIG.loTreeShadows, receiveShadow: true, tint: f.tintBark, ...scaled },
      { geometry: t.cardsLo, material: f.needleMaterial, castShadow: TIER_CONFIG.loTreeShadows, receiveShadow: true, sortObjects: true, ...scaled },
    ];
    return [
      { geometry: t.trunk, material: f.barkMaterial, castShadow: true, receiveShadow: true, tint: f.tintBark },
      { geometry: t.cardsHi, material: f.needleMaterial, castShadow: true, receiveShadow: true, sortObjects: true },
      { geometry: t.twigs, material: f.twigMaterial, castShadow: true, receiveShadow: true, until: FOREST_BANDS.twig },
    ];
  };
  const model = defineModel<TreeSetParams>({
    id: rows.model.id, name: rows.model.name, category: 'nature', pipeline: 'blender', file: rows.model.file, surface: 'wood',
    defaults: { v: 0, height: 0, r: 0, scale: 1 },
    variants: rows.variants.map((s, i) => ({ id: s.name, label: s.label, params: { v: i } })),
    build: (ctx, p) => band(ctx, p.v, 'near'),
    colliders: (p) => {
      if (p.height <= 0) return [];
      const c = trunkCapsule(p), s = p.scale;
      return [{ kind: 'capsule', x: 0, y: c.y / s, z: 0, halfHeight: c.halfHeight / s, radius: c.radius / s }];
    },
    lods: [
      { get from() { return FOREST_BANDS.hi; }, build: (ctx, p) => band(ctx, p.v, 'far') },
      { get from() { return FOREST_BANDS.far; }, fade: FOREST_BANDS.fade, build: (ctx, p) => band(ctx, p.v, 'impostor') },
    ],
  });
  return { model, use: (ctx, factory) => { ctx.once(key, () => factory); } };
}

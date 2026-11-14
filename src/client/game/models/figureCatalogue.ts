import { GeometryPack } from '@wildshard/engine/models/geometryPack';
import { fetchDeflatedBytes as fetchDeflated } from '@wildshard/engine/core/deflate';
import { resourceScope } from '@wildshard/engine/app/resources';
import { loadFirstPartyFolder } from '../shardfile/runtimeFolder';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
/** Client-only product catalogue for fallback and baked figure rows. */
import * as THREE from 'three';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { TIER } from '@wildshard/engine/core/tier';
import { ResourceMemo } from '@wildshard/engine/app/cachedAssets';
import { defineModel, announceModelReady, type ModelDef } from '@wildshard/engine/models/model';
import { loadingSpecimen } from '@wildshard/engine/models/gear';
import { FigureCatalogueSchema, type FigureCatalogueRow, type FigureRow } from '@wildshard/format/figures';
import { FigureRows } from '../systems/npc/figureRows';
import { SceneHandles } from '../shardfile/sceneHandles';

const nobody = new THREE.Vector3(0, 0, 1e4);

/** Native quest timing, separate from serializable figure rows. The original
 * distance fence keeps a figure visible at entry on its immediate path. */
export interface FigureSkinTiming {
  readonly viewer: { readonly x: number; readonly z: number };
  readonly later: (id: string, at: { readonly x: number; readonly z: number }, run: () => Promise<void>) => Promise<boolean>;
}

/** Rows never execute shard code; named product data defines every card.
 * Each build gets a fresh publication namespace and owns async cancellation.
 */
export class FigureCatalogue {
  private data: FigureCatalogueRow | undefined;
  private geometry: SceneHandles | undefined;
  // A borrowed material may outlive this catalogue and its scene handles.
  // ResourceMemo's disposal listener owns only its independent memo.
  private readonly materials = new ResourceMemo<'base', THREE.MeshStandardMaterial>();
  private readonly glows = new ResourceMemo<'glow', THREE.MeshBasicMaterial>();
  /** Admit atomically; a failed load leaves the last complete catalogue intact. */
  async admit(input: unknown, geometry: SceneHandles, owner?: Scope): Promise<void> {
    const data = v.parse(FigureCatalogueSchema, input);
    for (const row of Object.values(data.figures)) {
      if (row.body !== undefined) geometry.geometry(String(row.body));
      if (row.glass !== undefined && row.glass !== null) geometry.geometry(String(row.glass));
    }
    await FigureRows.prepareSkins(Object.values(data.figures).flatMap(row => row[TIER].skin?.late === true ? [] : row[TIER].skin ?? []));
    if (owner?.disposed === true || owner?.disposing === true) throw new Error('Figure catalogue owner left');
    this.data = data; this.geometry = geometry;
  }
  /** Shared vertex-colour material for figures and row-compatible props. */
  material(resources: SceneHandles): THREE.MeshStandardMaterial {
    const sky = resources.sky;
    const row = this.data?.material;
    if (row === undefined) throw new Error('Figure catalogue is not admitted');
    return this.materials.acquire('base', () => {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: row.roughness, metalness: row.metalness });
      mat.name = row.name; sky.setupMaterial(mat);
      return mat;
    });
  }
  private row(id: string) {
    const row = this.data?.figures[id];
    if (row === undefined) throw new Error(`Figure catalogue is not admitted: ${id}`);
    return { row, geometry: this.geometry };
  }
  create(id: string, context: SceneHandles, feet: readonly [number, number, number], yaw: number, owner?: Scope, timing?: FigureSkinTiming): FigureRows {
    const { row, geometry } = this.row(id), spec = row[TIER], resources = new SceneHandles(context.sky), f = spec.fallback;
    if (f === undefined) return new FigureRows(context, spec, owner);
    if (geometry === undefined || row.body === undefined) throw new Error('Figure fallback requires its packed geometry');
    resources.publish(f.geometry, geometry.geometry(String(row.body)).clone()); resources.publish(f.material, this.material(resources));
    const glow = this.glows.acquire('glow', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: true }));
    resources.publish(f.glow, glow);
    if (f.glass !== null) {
      if (row.glass === null || row.glass === undefined) throw new Error('Figure glass requires its packed geometry');
      resources.publish(f.glass, geometry.geometry(String(row.glass)).clone());
    }
    const later = spec.skin?.late === true && timing !== undefined && Math.hypot(feet[0] - timing.viewer.x, feet[2] - timing.viewer.z) > spec.drawDistance
      ? (run: () => Promise<void>): Promise<boolean> => timing.later(`figure-skin:${id}`, { x: feet[0], z: feet[2] }, run) : undefined;
    const fig = new FigureRows(resources, { ...spec, feet: [...feet], yaw }, owner, later);
    return fig;
  }
  model(id: string): ModelDef<object> {
    const { row } = this.row(id);
    const card = row.card, skin = row[TIER].skin;
    if (card === undefined) throw new Error('Figure requires its declared Explorer card');
    const late = skin?.late === true;
    return defineModel<object>({ ...card, category: 'people', surface: 'flesh',
      defaults: {}, ...(late ? { specimenLifetime: 'view' as const }
        : { prepare: async () => { await FigureRows.prepareSkins(skin === undefined ? [] : [skin]); } }),
      build: ctx => {
        if (late) {
          const owner = ctx.specimenScope;
          if (owner === undefined) throw new Error('Late figure specimen requires its view owner');
          if (owner.disposed || owner.disposing) throw new Error('Figure specimen owner left');
          return loadingSpecimen(card.id, [1, 2, 1], async () => {
            await FigureRows.prepareSkins(skin === undefined ? [] : [skin]);
            if (owner.disposed || owner.disposing) throw new Error('Figure specimen owner left');
            const fig = owner.run(() => this.create(id, new SceneHandles(ctx.sky), [0, 0, 0], 0, owner));
            await fig.ready;
            if (owner.disposed || owner.disposing) throw new Error('Figure specimen owner left');
            fig.update(0, 0, nobody);
            return fig.group;
          }, owner);
        }
        const fig = this.create(id, new SceneHandles(ctx.sky), [0, 0, 0], 0);
        fig.update(0, 0, nobody);
        void fig.ready.then(() => { if (fig.active) { fig.update(0, 0, nobody); announceModelReady(card.id); } return undefined; });
        return fig.group;
      },
    });
  }
  /** Author rows, available only after the same admission as live figures. */
  rows(id: string): FigureRow { return this.row(id).row[TIER]; }
  /** The figure's kit rows (format/kitFigure), when it is built from kit meshes. */
  kit(id: string): unknown { const kit = this.row(id).row.kit; if (kit === undefined) throw new Error(`Figure ${id} has no kit`); return kit; }
}

const admitted = new WeakMap<ShardFolder, Map<string, { readonly catalogue: FolderFigureCatalogue; readonly owner: Scope }>>();

/** Admit existing product packs into the shared figure model owner.
 * Public callers supply product/file ids and resident scene handles only.
 */
export class FolderFigureCatalogue {
  /** Share the admitted catalogue; source `owner` is captured before reads and
   * retires its cache and geometry. Omitted owners use the construction scope. */
  static async fromFolder(product: ShardFolder, file: string, owner: Scope = resourceScope()): Promise<FolderFigureCatalogue> {
    if (owner.disposed || owner.disposing) throw new Error('Figure catalogue owner left');
    const ready = admitted.get(product)?.get(file); if (ready !== undefined && !ready.owner.disposed && !ready.owner.disposing) return ready.catalogue;
    const catalogue = new FolderFigureCatalogue(product.slug, file); await catalogue.admit(product, owner); return catalogue;
  }
  private readonly figures = new FigureCatalogue();
  private pending: Promise<void> | undefined;
  constructor(private readonly folderId: string, private readonly file: string) {}
  async admit(product: ShardFolder, owner: Scope = resourceScope(), allowPacked = true): Promise<void> {
    const check = (): void => { if (owner.disposed || owner.disposing) throw new Error('Figure catalogue owner left'); };
    check();
    const data = v.parse(FigureCatalogueSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await product.file(this.file))));
    // GR8: a skin the product names (a file name, not a /-rooted public URL) loads through the product's own URL for it
    const named = (url: string): string => url.startsWith('/') ? url : product.url(url);
    for (const row of Object.values(data.figures)) for (const skin of [row.phone.skin, row.desktop.skin]) {
      if (skin !== undefined) { skin.url = named(skin.url); skin.material = named(skin.material); }
    }
    check();
    if (!allowPacked && data.pack !== undefined) throw new Error('Resolved island figures require unpacked catalogue rows');
    const resources = new SceneHandles();
    if (data.pack !== undefined) {
      const bytes = await fetchDeflated(data.pack.url); check();
      const pack = new GeometryPack(bytes, data.pack.rows, this.file);
      check();
      const indices = new Set(Object.values(data.figures).flatMap(row => [row.body, row.glass]).filter(index => index !== undefined && index !== null));
      for (const index of indices) {
        const geometry = pack.geometry(index); resources.publish(String(index), geometry);
        owner.onDispose(() => { geometry.dispose(); });
      }
    }
    await owner.run(() => this.figures.admit(data, resources, owner)); check();
    const book = admitted.get(product) ?? new Map<string, { readonly catalogue: FolderFigureCatalogue; readonly owner: Scope }>();
    const admission = { catalogue: this, owner };
    book.set(this.file, admission); admitted.set(product, book);
    owner.onDispose(() => { if (book.get(this.file) === admission) book.delete(this.file); });
  }
  prepare(): Promise<void> {
    this.pending ??= (async () => {
      try { await this.admit(await loadFirstPartyFolder(this.folderId)); }
      catch (error: unknown) { this.pending = undefined; throw error; }
    })();
    return this.pending;
  }
  material(resources: SceneHandles): THREE.MeshStandardMaterial { return this.figures.material(resources); }
  create(id: string, resources: SceneHandles, feet: readonly [number, number, number], yaw: number, owner?: Scope, timing?: FigureSkinTiming): FigureRows { return this.figures.create(id, resources, feet, yaw, owner, timing); }
  model(id: string): ModelDef<object> { return this.figures.model(id); }
  rows(id: string): FigureRow { return this.figures.rows(id); }
  kit(id: string): unknown { return this.figures.kit(id); }
}

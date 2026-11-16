import * as v from 'valibot';
/** Client-only collection presentation over existing game/save owners. */
import * as THREE from 'three';
import { defineModel, modelContext, seedOf, type ModelContext, type ModelDef } from '@wildshard/engine/models/model';
import { Rng } from '@wildshard/engine/core/rng';
import { resourceScope } from '@wildshard/engine/app/resources';
import { SlotGeometry } from '@wildshard/engine/models/slots';
import { lowPolyLookMaterial } from '@wildshard/engine/world/lowpolyKit';
import type { OwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { parseCollectionCard, CollectionDisplaysSchema, type CollectionModelRow } from '@wildshard/format/collectionDisplay';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { loadFirstPartyFolder } from '../shardfile/runtimeFolder';

/** Collection model parameters stay data, including future shards' count and trophy names. */
export type CollectionParams = Record<string, number | boolean>;
/** Product-owned geometry and material capabilities, also used by cold Explorer cards. */
export interface CollectionModelPorts {
  prepare: () => Promise<void>;
  geometry: (key: string) => THREE.BufferGeometry;
  material: (ctx: ModelContext, still: boolean) => THREE.Material;
}

/** A baked collection display; reveals change only its index, preserving attributes, bounds and material. */
export class CollectionDisplay extends THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  private readonly slots: SlotGeometry;
  private n = 0;
  constructor(readonly row: CollectionModelRow, geometry: THREE.BufferGeometry, material: THREE.Material, params: CollectionParams) {
    const slots = new SlotGeometry(geometry, row.ranges);
    super(slots.geometry, material);
    this.slots = slots; this.name = row.objectName; this.castShadow = true; this.receiveShadow = true;
    if (row.count !== undefined) this.setCount(Number(params[row.count.parameter] ?? 0));
    for (const id of Object.keys(row.trophies?.full ?? {})) this.setFilled(id, params[id] === true);
  }
  get pieces(): number { return this.n; }
  setCount(n: number): void {
    const count = this.row.count;
    if (count === undefined) return;
    this.n = Math.max(0, Math.min(count.to - count.from, Math.floor(n)));
    this.slots.setRun(count.from, count.to, this.n);
  }
  filled(id: string): boolean { const slot = this.row.trophies?.full[id]; return slot !== undefined && this.slots.shown(slot); }
  setFilled(id: string, filled: boolean): void {
    const full = this.row.trophies?.full[id], empty = this.row.trophies?.empty[id];
    if (full === undefined || empty === undefined) throw new Error(`Unknown collection trophy: ${id}`);
    this.slots.set(full, filled); this.slots.set(empty, !filled);
  }
  trophyOnly(id: string): void {
    const trophies = this.row.trophies;
    if (trophies?.full[id] === undefined) throw new Error(`Unknown collection trophy: ${id}`);
    this.slots.set(trophies.base, false);
    for (const key of Object.keys(trophies.full)) {
      const empty = trophies.empty[key], full = trophies.full[key];
      if (empty !== undefined) this.slots.set(empty, false);
      if (full !== undefined) this.slots.set(full, key === id);
    }
  }
}

/** Define a cold-loadable Explorer card from product rows; the factory has no shard identity or constants. */
export function collectionModel(card: unknown,
  read: () => CollectionModelRow, ports: CollectionModelPorts): ModelDef<CollectionParams> {
  return defineModel<CollectionParams>({
    ...parseCollectionCard(card), category: 'props', pipeline: 'code', prepare: ports.prepare,
    build: (ctx, params) => { const value = read(); return new CollectionDisplay(value, ports.geometry(value.geometry), ports.material(ctx, value.still), params); },
  });
}

/** The same baked trophy, alone and recentered for the existing claimed-pickup orb. */
export function collectionTrophy(row: CollectionModelRow, ports: CollectionModelPorts, ctx: ModelContext, id: string): THREE.Group {
  const trophy = row.trophies, offset = trophy?.dropOffsets[id];
  if (trophy === undefined || offset === undefined) throw new Error(`Missing collection drop: ${id}`);
  const mesh = new CollectionDisplay(row, ports.geometry(trophy.dropGeometry), ports.material(ctx, row.still), {});
  mesh.trophyOnly(id); mesh.position.set(...offset);
  const group = new THREE.Group(); group.name = `trophy-${id}`; group.add(mesh); return group;
}

/** Borrow an existing cosmetic model through its full contract, including part-array builders.
 * A fresh build context keeps each pickup/wardrobe copy independently owned, as its original native factory did. */
export function collectionCosmetic<P extends object>(model: ModelDef<P>, ctx: ModelContext): THREE.Object3D {
  const built = model.build(modelContext(ctx.sky), model.defaults, new Rng(seedOf(model)));
  if (built instanceof THREE.Object3D) return built;
  const meshes = built.map(part => {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = part.castShadow ?? false; mesh.receiveShadow = part.receiveShadow ?? false; return mesh;
  });
  const [single] = meshes;
  const root = meshes.length === 1 && single !== undefined ? single : new THREE.Group().add(...meshes);
  root.name = model.id.slice(model.id.lastIndexOf('/') + 1); return root;
}

/** Product-backed catalogue over existing owned geometry handles; the legacy borrow is tracked by G482. */
export class CollectionCatalogue {
  private entries: Readonly<Record<string, ModelDef<CollectionParams>>> = {};
  get models(): Readonly<Record<string, ModelDef<CollectionParams>>> { return this.entries; }
  private rows: Readonly<Record<string, CollectionModelRow>> | undefined;
  private pending: Promise<void> | undefined;
  private readonly ports: CollectionModelPorts;
  constructor(private readonly slug: string, private readonly geometry: ReadonlyMap<string, OwnedGeometry>, private readonly pinnedFolder?: ShardFolder) {
    if (pinnedFolder !== undefined && !Object.is(pinnedFolder.slug, slug)) throw new Error('Collection product identity differs');
    this.ports = { prepare: () => this.prepare(), geometry: key => {
      const handle = this.geometry.get(key); if (handle === undefined) throw new Error(`Missing collection geometry: ${key}`); return handle.copy();
    }, material: (ctx, still) => lowPolyLookMaterial(ctx.sky, still ? 'still' : 'default') };
  }
  private row(key: string): CollectionModelRow {
    const row = this.rows?.[key]; if (row === undefined) throw new Error(`Collection is not prepared: ${key}`); return row;
  }
  /** Prepare the shared handles and admitted rows. A resolved book pins its
   * original product; only the compatible legacy path opens a first-party one. */
  prepare(): Promise<void> {
    const owner = resourceScope(), pinned = this.pinnedFolder;
    const check = (): void => { if (pinned !== undefined && (owner.disposed || owner.disposing)) throw new Error('Collection owner left during preparation'); };
    check();
    this.pending ??= (async () => {
      try {
        await Promise.all([...this.geometry.values()].map(handle => handle.load()));
        check();
        const product = pinned ?? await loadFirstPartyFolder(this.slug, owner); check();
        const rows = v.parse(CollectionDisplaysSchema, product.section('collections/displays')).models;
        const entries = Object.fromEntries(Object.entries(rows).map(([key, row]) => {
          const { id, name, file, surface, defaults, variants } = row;
          return [key, collectionModel({ id, name, file, surface, defaults, variants }, () => this.row(key), this.ports)];
        }));
        check(); this.rows = rows; this.entries = entries;
      } catch (error: unknown) { this.pending = undefined; throw error; }
    })();
    return this.pending;
  }
  /** A named model is a strict reference, including cold Explorer preparation. */
  model(key: string): ModelDef<CollectionParams> {
    const model = this.models[key]; if (model === undefined) throw new Error(`Missing collection card: ${key}`); return model;
  }
  trophy(key: string, id: string, ctx: ModelContext): THREE.Group { return collectionTrophy(this.row(key), this.ports, ctx, id); }
}

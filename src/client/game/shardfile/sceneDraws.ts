import { clientPreparationBatch } from './preparationTiming';
import { Mesh, type BufferGeometry, type Object3D, type Material, type Group } from 'three';
import * as v from 'valibot';
import { SceneDrawsSchema } from '@wildshard/format/sceneDraws';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { sceneModelSource } from './sceneSources';
import { admitSceneBuffers, prepareSceneBufferDraws, type SceneBufferReuse, type SceneBufferDrawer } from './sceneBuffers';
import { parseSceneBuffers, type SceneBuffers } from '@wildshard/format/sceneBuffers';
import { TIER } from '@wildshard/engine/core/tier';

const books = new WeakMap<Scope, WeakMap<ShardProduct, Map<string, BufferGeometry>>>();
const drawBooks = new WeakMap<Scope, WeakMap<ShardProduct, Map<string, SceneBufferDrawer>>>();
const buffers = new WeakMap<ShardProduct, Map<string, { row: SceneBuffers; files: ReadonlyMap<string, Uint8Array>; content: string }>>();

/** Admit named draw bytes before any material or geometry allocation. Missing files refuse, with no runtime fallback. */
export async function prepareSceneDrawRows(product: ShardProduct, input: unknown): Promise<void> {
  const rows = v.parse(SceneDrawsSchema, input);
  let prepared = buffers.get(product); if (prepared === undefined) { prepared = new Map(); buffers.set(product, prepared); }
  for (const row of rows) {
    if (row.kind !== 'buffered' || prepared.has(row.file) || (row.tier !== undefined && row.tier !== TIER)) continue;
    if (!product.hasFile(row.file)) throw new Error(`Missing scene draw buffer file: ${row.file}`);
    const source = parseSceneBuffers(await product.json<unknown>(row.file)), files = new Map<string, Uint8Array>();
    const names = new Set<string>();
    for (const buffer of source.buffers) {
      if (buffer.file === undefined || names.has(buffer.file)) continue;
      if (!product.hasFile(buffer.file)) throw new Error(`Missing scene buffer binary file: ${buffer.file}`);
      names.add(buffer.file);
    }
    const ordered = [...names];
    // Independent verified reads overlap, but drain every started read before a
    // refusal can release the caller's input lease. Publish only a complete row.
    for (let i = 0; i < ordered.length; i += 4) {
      const batch = ordered.slice(i, i + 4);
      const loaded = await Promise.allSettled(batch.map(async name => { const bytes = await product.file(name); return bytes; }));
      for (const [index, result] of loaded.entries()) {
        if (result.status === 'rejected') throw result.reason;
        const name = batch[index];
        if (name === undefined) throw new Error('Missing scene buffer read identity');
        files.set(name, result.value);
      }
    }
    const content = JSON.stringify([product.url(row.file), [...files.keys()].map(file => product.url(file))]);
    prepared.set(row.file, { row: admitSceneBuffers(source, files), files, content });
  }
}

/** Client-only draw construction shared by specimen and resident emitters.
 * The lifetime and already-compiled material book belong to the caller. Fixed buffer builds are shared only
 * within that scope and admitted product. Draw objects and material bindings remain private. */
export function drawSceneRows(product: ShardProduct, input: unknown, parent: Object3D, scope: Scope, materials: ReadonlyMap<string, Material>, onBuffered?: (root: Group, rows: SceneBuffers) => void, assets?: SceneBufferReuse['assets']): void {
  const rows = v.parse(SceneDrawsSchema, input);
  let products = books.get(scope); if (products === undefined) { products = new WeakMap(); books.set(scope, products); }
  let geometries = products.get(product); if (geometries === undefined) { geometries = new Map(); products.set(product, geometries); }
  if (scope.disposed || scope.disposing) throw new Error('Scene draw scope is disposed or retiring');
  let buffered = drawBooks.get(scope); if (buffered === undefined) { buffered = new WeakMap(); drawBooks.set(scope, buffered); }
  let drawers = buffered.get(product);
  if (drawers === undefined) { drawers = new Map(); buffered.set(product, drawers); const held = drawers; scope.onDispose(() => { held.clear(); }); }
  for (const row of rows) {
    const material = materials.get(row.material); if (material === undefined) throw new Error('Missing scene draw material');
    if (row.kind === 'buffered') {
      if (row.tier !== undefined && row.tier !== TIER) continue;
      const source = buffers.get(product)?.get(row.file);
      if (source === undefined) throw new Error('Scene draw buffers were not admitted');
      const key = JSON.stringify([source.content, TIER, assets === undefined ? 'private' : 'revisit']);
      let draw = drawers.get(key);
      if (draw === undefined) {
        const trace = clientPreparationBatch(product.slug, 'scene.buffered', ['build', 'hit', 'miss', 'private']);
        const make = (): SceneBufferDrawer => prepareSceneBufferDraws(source.row, scope, product.shardfile.plumbing, source.files,
          assets === undefined ? undefined : { content: source.content, assets, revisit: true });
        try {
          draw = trace === undefined ? make() : trace.sync('build', make);
          trace?.sync(draw.cache, () => undefined); drawers.set(key, draw);
        } finally { trace?.finish(); }
      }
      const group = draw(material);
      group.scale.setScalar(row.scale); group.position.y = row.y; parent.add(group);
      if (row.order !== undefined) for (const mesh of group.children) mesh.renderOrder = row.order;
      onBuffered?.(group, source.row);
    } else {
      const key = JSON.stringify([row.geometry.library, row.geometry.model]); let geometry = geometries.get(key);
      if (geometry === undefined) { const source = sceneModelSource(product, row.geometry.library).geometry(row.geometry.model);
        if (source === null) throw new Error('Missing scene draw geometry'); geometry = scope.own(source); geometries.set(key, geometry); }
      const mesh = new Mesh(geometry, material); mesh.frustumCulled = false;
      if (row.kind === 'card') { mesh.name = row.name; mesh.renderOrder = row.order; mesh.position.set(...row.at);
        if (typeof row.scale === 'number') mesh.scale.setScalar(row.scale); else mesh.scale.set(...row.scale); }
      parent.add(mesh); scope.onDispose(() => { mesh.removeFromParent(); });
    }
  }
}

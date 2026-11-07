import * as THREE from 'three';
import * as v from 'valibot';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import { HeldFinishesSchema, type HeldFinishesRows } from '@wildshard/format/heldFinishes';
import type { Scope } from '@wildshard/engine/app/scope';
import { GeometryPack } from '@wildshard/engine/models/geometryPack';
import { packedRows } from '@wildshard/format/geometryPack';
import { fetchDeflatedBytes } from '@wildshard/engine/core/deflate';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

const admitted = new Map<string, HeldFinishes>();

/** Client-only presentation for row-authored held finishes. Ownership and worn state remain in the existing SkinLocker save service. */
export class HeldFinishes {
  readonly cards: HeldFinishesRows['cards'];
  private readonly definitions = new Map<string, SkinDef>();
  private constructor(private readonly product: ShardProduct, readonly rows: HeldFinishesRows, geometry: ReadonlyMap<number, THREE.BufferGeometry>) {
    this.cards = rows.cards;
    for (const id of rows.order) {
      const row = rows.rows[id]; if (row === undefined) throw new Error('Held finish order has an invalid identity');
      const extras = rows.extras[id];
      this.definitions.set(id, extras === undefined ? row : { ...row, extras: (root, material) => extras.flatMap(extra => {
        const look = extra.materials.map(name => material(name)).find(value => value !== undefined);
        const part = geometry.get(extra.geometry);
        if (look === undefined || part === undefined) return [];
        const mesh = new THREE.Mesh(part.clone(), look); mesh.name = extra.name; root.add(mesh); return [mesh];
      }) });
    }
  }
  /** Admit atomically: malformed identities or a failed geometry loan leave the previous catalogue intact. */
  static async prepare(product: ShardProduct, scope: Scope): Promise<HeldFinishes> {
    const ready = admitted.get(product.slug); if (ready?.product === product) return ready;
    const rows = v.parse(HeldFinishesSchema, product.section('held/finishes'));
    for (const [id, row] of Object.entries(rows.rows)) if (id !== row.id) throw new Error('Held finish key differs from its identity');
    const cards = new Set<string>();
    for (const card of rows.cards) {
      if (cards.has(card.id) || rows.rows[card.id] === undefined) throw new Error('Held finish card has an invalid identity');
      cards.add(card.id);
    }
    if (cards.size !== Object.keys(rows.rows).length) throw new Error('Held finish roster differs from its cards');
    if (rows.order.length !== cards.size || rows.order.some(id => !cards.has(id))) throw new Error('Held finish order differs from its cards');
    for (const id of Object.keys(rows.extras)) if (rows.rows[id] === undefined) throw new Error('Held finish extra has an invalid identity');
    const indices = [...new Set(Object.values(rows.extras).flatMap(extras => extras.map(extra => extra.geometry)))];
    const source = rows.source;
    if (source === undefined) throw new Error('Missing declared finish geometry');
    if (scope.disposed) throw new Error('Held finish owner is disposed');
    const bytes = await fetchDeflatedBytes(source.url);
    const pack = new GeometryPack(bytes, packedRows(source.rows), 'held finishes'), parts = indices.map(index => pack.geometry(index));
    const geometry = new Map(indices.map((index, at) => { const part = parts[at]; if (part === undefined) throw new Error('Missing held finish geometry'); return [index, part] as const; }));
    const host = new HeldFinishes(product, rows, geometry); admitted.set(product.slug, host); return host;
  }
  /** Refuse access before preparation; missing rows never become an empty/default finish. */
  static current(slug: string): HeldFinishes { const host = admitted.get(slug); if (host === undefined) throw new Error(`Held finishes are not admitted: ${slug}`); return host; }
  /** Resolve a registered identity before building a pickup, locker or Explorer variant. */
  get(id: string): SkinDef { const row = this.definitions.get(id); if (row === undefined) throw new Error(`Unknown held finish: ${id}`); return row; }
  /** Test registration without mutating ownership or choosing a fallback finish. */
  has(id: string): boolean { return this.definitions.has(id); }
  /** Material definitions in their original authored table order. */
  list(): SkinDef[] { return [...this.definitions.values()]; }
}

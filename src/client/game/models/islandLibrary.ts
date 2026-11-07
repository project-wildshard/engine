import { ResolvedIslandLibrarySchema } from '@wildshard/format/islandLibrary';
/**
 * G586: a shard's Blender-built island library, declared as data (`IslandLibrarySchema`): its fixed draws (the complete platform
 * section root, `FixedDrawRowsSchema`), their named groups file, the figure catalogue that shares their intake
 * and the collection cards drawn from its slots. One library per declaration, made on its first use: the page's resident
 * loader admits the product and loads every slot from the world's whole-geometry assembly; a cold Explorer card opens the
 * product itself and loads the same slots by file. Handles are inert until that one load settles. Client-only.
 */
import * as v from 'valibot';
import type { BufferGeometry } from 'three';
import type { OwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { resourceScope } from '@wildshard/engine/app/resources';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import type { readWholeGeometry } from '../plugin/geometry';
import { fixedDraws, type FixedDraws } from './fixedDraws';
import { ProductFigureCatalogue } from './figureCatalogue';
import { CollectionCatalogue } from './collectionDisplay';
import { timeClientPreparation } from '../shardfile/preparationTiming';

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
export const IslandLibrarySchema: v.GenericSchema<BoundedIslandLibraryInput, BoundedIslandLibrary> = v.strictObject({
  product: id,
  /** The complete fixed-draw platform root. */
  draws: v.strictObject({ section: v.literal('models/island-library'), field: v.literal('draws') }),
  /** the named JSON of the draws' groups, and the figure catalogue admitted with them */
  groups: id, figures: id,
  /** each collection card's key and fixed draw slot */
  collections: v.pipe(v.record(id, id), v.maxEntries(16)),
});

/** One shard's island library (see the module note); `Groups` is its groups file's generated type. */
export class IslandLibrary<Groups> {
  private readonly rows: BoundedIslandLibrary;
  private readonly resolved: v.InferOutput<typeof ResolvedIslandLibrarySchema> | undefined;
  private admitted: ShardProduct | null = null;
  private intake: Promise<void> | undefined;
  private inventoryRead: Promise<Groups> | undefined;
  private geometryRead: { readonly owner: Parameters<typeof readWholeGeometry>[0]; readonly sourceOwner: Scope; readonly pending: ReturnType<typeof readWholeGeometry> } | undefined;
  private figureAdmission: { readonly owner: Scope; readonly construction: boolean; readonly pending: Promise<void> } | undefined;
  private library: FixedDraws | null = null;
  private inventory: Groups | null = null;
  readonly figures: ProductFigureCatalogue;
  readonly collections: CollectionCatalogue;

  constructor(input: unknown, product?: ShardProduct) {
    this.resolved = product === undefined ? undefined : v.parse(ResolvedIslandLibrarySchema, input);
    this.rows = this.resolved === undefined ? v.parse(IslandLibrarySchema, input) : {
      product: product?.slug ?? '', draws: { section: 'models/island-library', field: 'draws' },
      groups: this.resolved.groups, figures: this.resolved.figures, collections: this.resolved.collections,
    };
    this.admitted = product ?? null;
    this.figures = new ProductFigureCatalogue(this.rows.product, this.rows.figures);
    this.collections = new CollectionCatalogue(this.rows.product, new Map(Object.entries(this.rows.collections).map(([key, slot]) => [key, this.draw(slot)])), product);
  }

  /** The page's (or a cold view's) product, for the shard's readers that hold none. */
  admit(product: ShardProduct): void {
    if (this.resolved !== undefined && product !== this.admitted) throw new Error('Resolved island product identity differs');
    this.admitted = product;
  }
  get product(): ShardProduct {
    if (this.admitted === null) throw new Error(`${this.rows.product} reads its product before its product is admitted`);
    return this.admitted;
  }
  /** Open and admit the first-party product outside a page (renderer services stay behind this explicit load). */
  async open(owner: Scope = resourceScope()): Promise<ShardProduct> {
    if (owner.disposed || owner.disposing) throw new Error('Island library owner left');
    if (this.resolved !== undefined) return this.product;
    const { loadFirstPartyProduct } = await import('../shardfile/runtimeProduct');
    const product = await loadFirstPartyProduct(this.rows.product, owner);
    this.admit(product); return product;
  }

  private draws(): FixedDraws {
    this.library ??= fixedDraws(this.product, this.resolved?.draws ?? this.product.section('models/island-library').draws);
    return this.library;
  }
  /** A slot's inert owned handle: loading it before the library loads loads the whole library. */
  readonly draw = (slot: string): OwnedGeometry => ({ load: bytes => bytes === undefined && !this.ready ? this.load() : this.draws().handle(slot).load(bytes),
      adopt: geometry => { this.draws().handle(slot).adopt(geometry); }, copy: () => this.draws().handle(slot).copy(), take: () => this.draws().handle(slot).take() });
  /** The groups file, read with the one load. */
  readonly groups = (): Groups => {
    if (this.inventory === null) throw new Error(`Baked model was not loaded: ${this.rows.product} fixed geometry inventory`);
    return this.inventory;
  };
  /** Every slot's template has completed its intake. */
  get ready(): boolean { return this.library?.ready ?? false; }
  /** The loaded library itself (an entry-owner or figure loan); refuses before its one intake completed. */
  readonly loaded = (): FixedDraws => {
    if (this.library === null || !this.library.ready) throw new Error(`${this.rows.product} fixed draws are not loaded`);
    return this.library;
  };
  /** Start a construction's bounded whole intake beside its looks/scenes. The
   * returned drain must run even if those earlier stages fail. Templates and
   * figures still publish only at load's original admission cursor. */
  prepareGeometry(owner: Parameters<typeof readWholeGeometry>[0], sourceOwner: Scope): (() => Promise<void>) | undefined {
    if (this.resolved === undefined || this.intake !== undefined || this.geometryRead !== undefined) return undefined;
    if (owner.disposed || owner.disposing || sourceOwner.disposed || sourceOwner.disposing) throw new Error('Island library owner left');
    const temporary = owner.child('island-whole-intake');
    const forget = sourceOwner.capture('disposers', () => { temporary.dispose(); });
    const pending = timeClientPreparation(this.product.slug, 'fixed-draws:whole', async () => {
      const { readWholeGeometry } = await import('../plugin/geometry');
      if (temporary.disposed || sourceOwner.disposed || sourceOwner.disposing) throw new Error('Island library owner left');
      return readWholeGeometry(temporary, this.product.slug);
    });
    void pending.catch(() => undefined);
    const preparation = { owner, sourceOwner, pending };
    this.geometryRead = preparation;
    return async () => {
      // Earlier looks/scenes may refuse before load consumes this loan. Stop
      // further bounded decode work now, then drain its already-started read.
      if (this.geometryRead === preparation) { this.geometryRead = undefined; temporary.dispose(); }
      try { await Promise.allSettled([pending]); }
      finally { forget(); temporary.dispose(); }
    };
  }
  /** Load every slot: from `owner`'s whole-geometry assembly (the world build), a caller's named blobs (`bytes`), or,
   *  with neither, the opened product's files (a cold Explorer card). */
  readonly load = async (bytes?: ReadonlyMap<string, Uint8Array | BufferGeometry>, owner?: Parameters<typeof readWholeGeometry>[0], sourceOwner: Scope = resourceScope()): Promise<void> => {
    const live = (): void => { if (sourceOwner.disposed || sourceOwner.disposing) throw new Error('Island library owner left'); };
    live();
    const product = this.resolved !== undefined ? this.product : bytes === undefined && owner === undefined ? await this.open(sourceOwner) : this.product;
    live();
    if (this.resolved === undefined) {
      await this.figures.admit(product, sourceOwner); live();
      this.inventory ??= await product.json<Groups>(this.rows.groups); live();
      await this.draws().load(bytes, owner); live(); return;
    }
    // The immutable groups document has no figure/geometry owner dependency.
    // Read it during figure admission, but publish it only at the original
    // cursor. A figure refusal still wins and drains this started read.
    const inventoryRead = this.inventoryRead ??= (async () => { try { return await product.json<Groups>(this.rows.groups); } catch (error: unknown) { this.inventoryRead = undefined; throw error; } })();
    void inventoryRead.catch(() => undefined);
    try {
      const previous = this.figureAdmission;
      // A card borrows the live construction admission. A construction always
      // re-admits on its own concrete owner, even after a cold geometry intake.
      if (owner === undefined && bytes === undefined && previous?.construction === true && !previous.owner.disposed && !previous.owner.disposing) {
        await previous.pending;
      } else {
        const pending = (async () => {
          if (previous !== undefined) { try { await previous.pending; } catch { /* A retired card cannot poison construction. */ } }
          live(); await this.figures.admit(product, sourceOwner, false); live();
        })();
        const admission = { owner: sourceOwner, construction: owner !== undefined || bytes !== undefined, pending };
        this.figureAdmission = admission;
        sourceOwner.onDispose(() => { if (this.figureAdmission === admission) this.figureAdmission = undefined; });
        try { await pending; } catch (error) { if (this.figureAdmission === admission) this.figureAdmission = undefined; throw error; }
      }
      live();
    } catch (error) { await Promise.allSettled([inventoryRead]); throw error; }
    const inventory = await inventoryRead; live(); this.inventory = inventory;
    // Deduplicate templates only. Figure admission above never shares a retired
    // source owner and never parks packed resources on the page scope.
    const candidate = this.geometryRead;
    const prepared = bytes === undefined && candidate !== undefined && candidate.owner === owner && candidate.sourceOwner === sourceOwner ? candidate : undefined;
    if (prepared !== undefined) this.geometryRead = undefined;
    this.intake ??= (async () => { try {
      const whole = prepared === undefined ? undefined : timeClientPreparation(product.slug, 'fixed-draws:whole.join', () => prepared.pending);
      await this.draws().load(bytes, owner, whole);
    } catch (error: unknown) { this.intake = undefined; throw error; } })();
    await this.intake; live();
  };
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedIslandLibraryInput = BoundedIslandLibrary;
interface BoundedIslandLibraryFields {
    product: string;
    draws: {
        section: 'models/island-library';
        field: 'draws';
    };
    groups: string;
    figures: string;
    collections: Record<string, string>;
}
type BoundedIslandLibrary = { [Key in keyof BoundedIslandLibraryFields]: BoundedIslandLibraryFields[Key] };

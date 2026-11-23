/**
 * G571: a boss creature's card from rows (`SocketRigCreatureSchema`): its model card, its species kind (the hull book's
 * derived row, registered by `prepareHullBookKit`), its one coat (the spawn variant: label, weight, rarity, scale, hp,
 * tint, traits) and the product file whose socket rig rows dress it (`format/roamingCombat` projection, read by
 * `SocketRigCard`). The card is the engine's `creature(kind)` read from that coat, dressed by the fight's own socket rig on
 * the live copy and on the specimen alike. `prepareHullBookKit` is the page kit such a product needs before play: the hull
 * book's derived species, the declared species rows its looks name (ONE-FORMAT OF30: no species programme), the hull
 * looks, the held equipment and each card's socket rows.
 */
import * as v from 'valibot';
import { creature, type CreatureParams } from '@wildshard/engine/models/creature';
import { defineModel, type ModelDef } from '@wildshard/engine/models/model';
import type { VariantDef } from '@wildshard/engine/entities/species/registry';
import type { SpeciesRow } from '@wildshard/engine/ai/species';
import { SocketRigCreatureSchema } from '@wildshard/format/socketRigCreature';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { SocketRigCard } from '../boss/socketRig';
import { folderHullBook } from '../looks/speciesBook';
import { HeldEquipment } from '../plugin/heldEquipment';
import type { ShardContext } from '../plugin/context';

/** One boss creature card (see the module note). */
export class SocketRigCreature {
  readonly card: SocketRigCard;
  readonly model: ModelDef<CreatureParams>;
  constructor(input: unknown) {
    const rows = v.parse(SocketRigCreatureSchema, input), { surface, ...card } = rows.model;
    const { hp, tint, traits, ...base } = rows.coat;
    const variant: VariantDef = { ...base, ...(hp === undefined ? {} : { hp }), ...(tint === undefined ? {} : { tint }), ...(traits === undefined ? {} : { traits }) };
    const dressing = this.card = new SocketRigCard(rows.product, rows.sockets);
    this.model = defineModel<CreatureParams>({ ...card, ...creature(rows.kind, { species: { label: variant.label, variants: [variant] },
      dress: (animal, ctx) => { dressing.dress(animal, ctx); } }), ...(surface === undefined ? {} : { surface }) });
  }
}

/** The page kit a hull-book product needs before play (see the module note); `cards` preload their socket rows. */
export async function prepareHullBookKit(ctx: ShardContext, cards: readonly SocketRigCreature[]): Promise<void> {
  const live = (): void => { if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Hull book kit owner left'); };
  live();
  // OF30: the page's species are the declared rows the hull book draws, in the book's order (a spawn-only row, the thralls,
  // lends its variants to the server's roster and draws on its kind's look)
  const book = folderHullBook(ctx.product), declared = ctx.product.shardfile.rows.species;
  const page: SpeciesRow[] = [];
  for (const look of ctx.product.section('look/hull-book').rows) for (const row of declared) if (row.id === look.species && row.kind === look.kind) {
    const variants: SpeciesRow['variants'] = [];
    for (const variant of row.variants) variants.push({ ...variant, scale: [variant.scale[0], variant.scale[1]] });
    page.push({ ...row, harvest: row.harvest ?? [], variants });
  }
  book.install(ctx.rows, page);
  const held = await HeldEquipment.prepare(ctx.product); live();
  for (const card of cards) { await card.card.preload(); live(); }
  held.install(ctx);
}

/** ONE-FORMAT OF23e4: the hull book's kit for a native page whose species are its declared rows (no species programme, no
 *  hull book: Pine r10). The page registers those rows itself (`declarePageCreatures`); this keeps the rest of the kit: the
 *  held equipment and each socket card's rows. */
export async function prepareDeclaredNativeKit(ctx: ShardContext): Promise<void> {
  const live = (): void => { if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Declared native kit owner left'); };
  live();
  const held = ctx.product.has('held/equipment') ? await HeldEquipment.prepare(ctx.product) : undefined; live();
  const cards = ctx.product.has('explore/catalogue') ? declaredSocketRigCreatures(ctx.product) : [];
  for (const card of cards) { await card.card.preload(); live(); }
  held?.install(ctx);
}

const declaredCards = new WeakMap<ShardFolder, readonly SocketRigCreature[]>();
/** One product's immutable card definitions are shared by kit and Explorer. All references preflight before construction. */
export function declaredSocketRigCreatures(product: ShardFolder): readonly SocketRigCreature[] {
  const cached = declaredCards.get(product); if (cached !== undefined) return cached;
  const { slug: identity } = product;
  const rows = product.section('explore/catalogue').entries.flatMap(row => row.kind === 'socket-creature' ? [row.rows] : []);
  if (new Set(rows.map(row => row.model.id)).size !== rows.length) throw new Error('Repeated socket creature card');
  for (const row of rows) if (row.product !== identity || !product.hasFile(row.sockets)) throw new Error('Socket creature card requires its own admitted product source');
  const cards = rows.map(row => new SocketRigCreature(row)); declaredCards.set(product, cards); return cards;
}
/** The finite hull-book kit has no source path or factory row. Its cards are the admitted Explorer catalogue's cards. */
export async function prepareDeclaredHullBookKit(ctx: ShardContext): Promise<void> {
  if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Hull book kit owner left');
  const cards = declaredSocketRigCreatures(ctx.product);
  if (cards.length === 0) throw new Error('Hull book kit requires its declared socket cards');
  await prepareHullBookKit(ctx, cards);
}

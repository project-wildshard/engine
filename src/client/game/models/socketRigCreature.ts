/**
 * G571: a boss creature's card from rows (`SocketRigCreatureSchema`): its model card, its species kind (the hull book's
 * derived row, registered by `prepareHullBookKit`), its one coat (the spawn variant: label, weight, rarity, scale, hp,
 * tint, traits) and the product file whose socket rig rows dress it (`format/roamingCombat` projection, read by
 * `SocketRigCard`). The card is the engine's `creature(kind)` read from that coat, dressed by the fight's own socket rig on
 * the live copy and on the specimen alike. `prepareHullBookKit` is the page kit such a product needs before play: the hull
 * book's derived species, the species programs page, the hull looks, the declared spawn tables, the held equipment and
 * each card's socket rows.
 */
import * as v from 'valibot';
import { creature, type CreatureParams } from '@wildshard/engine/models/creature';
import { defineModel, type ModelDef } from '@wildshard/engine/models/model';
import { declaredSpawnTables } from '@wildshard/engine/ai/encounters';
import type { VariantDef } from '@wildshard/engine/entities/species/registry';
import { SocketRigCreatureSchema } from '@wildshard/format/socketRigCreature';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { SocketRigCard } from '../boss/socketRig';
import { productHullBook } from '../looks/speciesBook';
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
  const book = productHullBook(ctx.product), programs = ctx.product.section('actors/species-programs');
  book.registerDerived(); ctx.rows.species(programs.page);
  ctx.rows.speciesLook(book.looks);
  ctx.rows.spawnTable(declaredSpawnTables(programs.spawns));
  const held = await HeldEquipment.prepare(ctx.product); live();
  for (const card of cards) { await card.card.preload(); live(); }
  held.install(ctx);
}

const declaredCards = new WeakMap<ShardProduct, readonly SocketRigCreature[]>();
/** One product's immutable card definitions are shared by kit and Explorer. All references preflight before construction. */
export function declaredSocketRigCreatures(product: ShardProduct): readonly SocketRigCreature[] {
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

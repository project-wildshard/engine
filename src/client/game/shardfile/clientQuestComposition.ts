/** Finite entry preparation over the existing equipment and quest owners. */
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { QuestPageRows } from '@wildshard/format/questPageComposition';
import type { RangedPageRows } from '@wildshard/format/rangedPage';
import { pageModeValue } from '../shard/pagePolicy';
import { installRangedPage, rangedPage } from '../loadout/rangedPage';
import { prepareQuestPageComposition, installQuestPageComposition } from '../quest/pageComposition';
import { QuestPageReference } from '../quest/pageReference';
import { installQuestFigures } from '../quest/figures';
import { parseQuestFiguresDocument } from '@wildshard/format/questFigures';
import { FolderFigureCatalogue } from '../models/figureCatalogue';
import { defineWorldSceneCatalogue } from '../models/worldSceneCatalogue';
import type { ShardContext } from '../plugin/context';
import { entryOwner, publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { residentWorldScope } from './hybridPresentation';
import { installWorldScenes } from './worldScenes';

const ended = (ctx: ShardContext): boolean => ctx.scope.disposed || ctx.scope.disposing;

/** Install the stable places reader in world, before the play host captures it. */
export function installEntryQuestReference(ctx: ShardContext, id: string): void {
  const shell = ctx.game.runtime;
  if (shell === undefined || ended(ctx)) throw new Error('Quest reference requires its entered runtime');
  const reference = new QuestPageReference(ctx.scope);
  publishEntryOwner(ctx.scope, 'quest-reference', id, reference);
  ctx.scope.expose(shell.hooks, 'places', reference.places);
}
/** Equipment installation precedes composition and uses the authored mode row. */
export async function installEntryRangedPage(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'held.ranged-page' }>): Promise<void> {
  const input = await ctx.product.json<RangedPageRows>(row.file);
  if (ended(ctx)) throw new Error('Entry left during ranged admission');
  await installRangedPage(ctx, { ...input, shadowBatch: row.shadowBatch === undefined ? input.shadowBatch : pageModeValue(row.shadowBatch) });
}
/** One preparation owns placement and live figures; its completed composition
 * publishes only the concrete services that its entry actually declares. */
export async function installEntryQuestComposition(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'quest.composition' }>): Promise<void> {
  const figureRow = row.figures, equipmentRow = row.equipment;
  const reference = row.reference === undefined ? null : entryOwner(ctx.scope, 'quest-reference', row.reference);
  const draws = figureRow === undefined ? null : entryOwner(ctx.scope, 'fixed-draws', figureRow.draws);
  const check = (): void => {
    if (ended(ctx)) throw new Error('Entry left during quest admission');
    if (reference !== null && row.reference !== undefined && entryOwner(ctx.scope, 'quest-reference', row.reference) !== reference) throw new Error('Quest reference changed during admission');
    if (draws !== null && figureRow !== undefined && entryOwner(ctx.scope, 'fixed-draws', figureRow.draws) !== draws) throw new Error('Quest draw owner changed during admission');
  };
  check();
  const rows = await ctx.product.json<QuestPageRows>(row.file); check();
  if (rows.id !== row.id) throw new Error('Quest composition identity differs from its entry row');
  const equipment = equipmentRow === undefined ? null : (() => {
    const animals = ctx.game.runtime?.play?.animals;
    if (animals === undefined) throw new Error('Quest composition requires its entered animals');
    return { ids: equipmentRow, animals, page: rangedPage(ctx.scope, equipmentRow.ranged) };
  })();
  const figures = figureRow === undefined ? null : await (async () => {
    const input = figureRow.file === row.file ? rows : await ctx.product.json(figureRow.file); check();
    const catalogue = await FolderFigureCatalogue.fromFolder(ctx.product, 'people/catalogue.json', residentWorldScope(ctx)); check();
    const modelRows = await ctx.product.json('models/world-scenes.json'); check();
    return { input: parseQuestFiguresDocument(input), catalogue, models: defineWorldSceneCatalogue(modelRows) };
  })();
  const placement = await prepareQuestPageComposition(ctx, rows); check();
  if (figures !== null && draws !== null) {
    const resources = await installWorldScenes(ctx, ctx.product.section('world/scenes'), residentWorldScope(ctx)); check();
    installQuestFigures(ctx, figures.input, { placement, catalogue: figures.catalogue, models: figures.models, draws, resources });
  }
  const quest = await installQuestPageComposition(ctx, rows); check();
  publishEntryOwner(ctx.scope, 'quest', row.id, quest);
  reference?.publish(quest);
  if (equipment !== null) {
    publishEntryOwner(ctx.scope, 'animals', equipment.ids.animals, equipment.animals);
    publishEntryOwner(ctx.scope, 'sounds', equipment.ids.sounds, equipment.page.ambience.sfx);
  }
}

/** Entered quest presentation keeps its original host and starts before the other play features. */
export async function installEntryQuestViews(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'quest.views' }>): Promise<void> {
  const live = (): void => { if (ended(ctx)) throw new Error('Entry left during quest view admission'); };
  live();
  const input = await ctx.product.json(row.file); live();
  const { QuestPageViews } = await import('../quest/questPageViews'); live();
  await QuestPageViews.install(ctx, input);
}

/** Chapter presentation borrows the original entered arenas and riding owner. */
export async function installEntryChapterView(ctx: ShardContext, row: Extract<ClientFeatureRow, { kind: 'quest.chapter-view' }>): Promise<void> {
  const arena = entryOwner(ctx.scope, 'arena-room', row.arena), fight = entryOwner(ctx.scope, 'arena-room', row.fight);
  const taming = row.taming === undefined ? null : entryOwner(ctx.scope, 'taming', row.taming);
  await installQuestPageComposition(ctx, { chapterView: row.chapterView, story: row.story }, { arena, fight, taming });
}

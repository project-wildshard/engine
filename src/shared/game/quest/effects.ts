import type { parseQuestServiceActions } from '@wildshard/format/questSteps';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { SimHost } from '@wildshard/engine/sim';
import type { ShardContext } from '../../../client/game/plugin/context';
import { isItemId } from '../bag/itemCatalog';
import { creditNativeInventory, debitNativeInventory } from '../inventoryLaw';
import { boundQuestState } from './boundState';
import { boundChapter, readQuestObservation } from './chapterBindings';
import type { QuestStepEffect } from './steps';
import {presentQuestEffect,type QuestPresentationPorts} from './effectPresentation';

/** Framework-internal dispatch; shard APIs supply effect rows and owner ids only. */
function commit(effects: readonly QuestStepEffect[], flags: Flags,
  credit: (item: string, count: number) => void, debit: (item: string, count: number) => boolean, present?: (effect: Extract<QuestStepEffect, { kind: 'toast' | 'sting' | 'reading' }>) => void): void {
  for (const effect of effects) {
    if (effect.kind === 'flag') { if (effect.value === false) flags.clear(effect.flag); else flags.set(effect.flag); }
    else if (effect.kind === 'item') credit(effect.item, effect.count);
    else if (effect.kind === 'take') {
      if (!debit(effect.item, effect.count)) throw new Error('Quest delivery changed before commit');
    } else if (effect.kind === 'toast' || effect.kind === 'sting' || effect.kind === 'reading') {
      if (present === undefined) throw new Error('Quest presentation requires a page host');
      present(effect);
    } else throw new Error('Quest effect requires an admitted command or notice lane');
  }
}

/** Apply ordered rows at the existing event phase. Page contexts borrow the bound quest/play pack;
 * native hosts borrow their registered pack and flags. The page branch is client-only presentation. */
export function commitQuestEffects(context: Pick<ShardContext, 'scope' | 'game'> | SimHost, owner: string, effects: readonly QuestStepEffect[], nativePresentation?:QuestPresentationPorts): void {
  if ('game' in context) {
    const state = boundQuestState(context.scope, owner), play = context.game.runtime?.play;
    if (play === undefined || play === null) throw new Error('Quest effects require the play host');
    commit(effects, state.flags, (item, count) => {
      if (!isItemId(item)) throw new Error('Unknown quest inventory item');
      play.inventory.add(item, count);
    }, (item, count) => {
      if (!isItemId(item)) throw new Error('Unknown quest inventory item');
      return play.inventory.take(item, count);
    }, effect => {presentQuestEffect(effect,state.flags,{observe:source=>readQuestObservation(context,owner,source),
      reading:row=>boundChapter(context.scope,owner).reading(row),sting:name=>play.music.sting(name),toast:text=>play.hud.toast(text)});});
  } else commit(effects, context.flags, (item, count) => { creditNativeInventory(context, owner, { item, count }); },
    (item, count) => debitNativeInventory(context, owner, { item, count }),
    nativePresentation===undefined?undefined:effect=>{presentQuestEffect(effect,context.flags,nativePresentation);});
}

/** One player's effects on its own book and pack, as a room's other players run them; they have no presentation. */
export function commitSeatEffects(effects: readonly QuestStepEffect[], flags: Flags, pack: { readonly add: (item: string, count: number) => boolean; readonly take: (item: string, count: number) => boolean }): void {
  commit(effects, flags, (item, count) => { pack.add(item, count); }, (item, count) => pack.take(item, count), () => undefined);
}

/** Client-only named actions borrow existing services; parsing creates no state, listener or save owner. */
export async function readQuestServiceActions(ctx: Pick<ShardContext, 'scope' | 'game' | 'product'>, quest: string, file: string): Promise<{ readonly run: (id: string) => void }> {
  if (!ctx.product.shardfile.quests.quests.some(row => row.id === quest)) throw new Error('Quest service actions require a declared quest');
  const rows = await ctx.product.json<ReturnType<typeof parseQuestServiceActions>>(file);
  if (ctx.scope.disposed) throw new Error('Quest left while admitting service actions');
  const actions = new Map(rows.actions.map(row => [row.id, row.effects]));
  return { run: id => {
    const effects = actions.get(id); if (effects === undefined) throw new Error(`Unknown quest service action ${id}`);
    commitQuestEffects(ctx, quest, effects);
  } };
}

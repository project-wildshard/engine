import type { Scope } from '@wildshard/engine/app/scope';
import { parse as parseData } from 'valibot';
import { ClientQuestPageSchema } from '@wildshard/format/clientNative';
import type { ShardContext } from '../plugin/context';
import { installPersistedQuest, bindPageQuestStages } from '../plugin/ui';
import type { DirectorActionBinding } from '../../../shared/game/plugin/director';
import { bindRuntimeCoins } from '../../../shared/game/plugin/runtimeRows';
import { installRuntimeAudio } from '../plugin/audio';
import { installRuntimeLoot } from '../loot/runtime';
import { installBoundQuestFlags, publishQuestFacts } from '../../../shared/game/quest/boundState';
import { resolveSceneNpc } from '../models/sceneSpecimens';
import { productPainterLight } from '../looks/paintedLook';
import { clientNativeBook } from './clientNativeBook';
import { sceneMotion } from './sceneMotion';
import { bindDeclaredPage } from '../quest/declaredPage';
import { clientSceneHandles } from './clientSceneHandles';
import { clientPopulationActor } from './clientPopulation';
import { settleWeatherFields } from './weatherFields';

/** The compiled quest.page feature installs the original saved quest and NPC.
 * Its entered flag book is also the motion and weather presentation authority. */
export function installClientQuestPage(ctx: ShardContext, input: unknown, resident: Scope): void {
  const row = parseData(ClientQuestPageSchema, input), book = clientNativeBook(ctx);
  const runtime = ctx.game.runtime, world = runtime?.world;
  if (book.quest !== null || runtime === undefined || world === null || world === undefined) throw new Error('Quest page needs one actual entered world');
  const flags = installBoundQuestFlags(ctx.scope, row.rows.id, ctx.manifest.slug);
  const model = resolveSceneNpc(ctx.product, row.rows.npc);
  installRuntimeAudio(ctx, ctx.product.shardfile.audio);
  const loot = installRuntimeLoot(ctx, { gear: purse => ({ coins: purse.coins }), finds: null, marks: null,
    charted: () => false, chime: () => { runtime.play?.cues.cue('cue.swap'); } });
  const coins = bindRuntimeCoins(ctx, loot?.purse ?? null);
  const firstNpc = runtime.interactables.length;
  const quest = installPersistedQuest(ctx, ctx.product.shardfile, { ...row.rows, model: model.row }, {
    player: world.player.position, flags, coins, model: model.source,
    dress: group => {
      ctx.scope.ownPrimitives(group, { instances: true });
      if (ctx.product.section('look/painted').look.lightScope === 'material') productPainterLight(ctx.product, group, ctx.scope);
    },
  });
  book.quest = Object.assign(quest, { coins });
  const npcPrompts = runtime.interactables.slice(firstNpc);
  publishQuestFacts(ctx.scope, row.rows.id, quest.facts);
  if (row.progress) quest.persistence.bindProgress(runtime.play?.progress);
  sceneMotion(ctx).install(flags);
  const motion = sceneMotion(ctx), pageRows = ctx.product.shardfile.questHost?.page;
  if (pageRows === undefined || !('version' in pageRows)) throw new Error('Saved page requires its typed interaction rows');
  book.page = bindDeclaredPage(ctx, pageRows, { flags, handles: clientSceneHandles(ctx.product, resident), motion: motion.motion,
    channelPrompts: motion.prompts, get stages() { return book.stages ?? undefined; } });
  motion.bindPage(book.page);
  const primary = book.held;
  if (primary === null) throw new Error('Saved page requires its actual held contact owner');
  book.page.bindWorldTargets(primary);
  if (row.promptOrder === 'page-npc') {
    for (const prompt of npcPrompts) { const index = runtime.interactables.indexOf(prompt); if (index !== -1) runtime.interactables.splice(index, 1); }
    runtime.interactables.push(...npcPrompts);
  }
  const registered = new Set(book.page.prompts.values());
  runtime.interactables.push(...motion.channels.interactables.filter(prompt => !registered.has(prompt)));
  runtime.hooks.questFlags = () => quest.quest.isComplete ? [quest.quest.def.completeFlag] : [];
}

/** Stage installation follows the original held/spawned encounter boundary.
 * Captures invoke the same typed actions and native mover commands as play. */
export function finishClientQuestPage(ctx: ShardContext, input: unknown): void {
  const row = parseData(ClientQuestPageSchema, input), book = clientNativeBook(ctx), source = ctx.product.shardfile;
  const quest = book.quest, page = book.page, native = sceneMotion(ctx).motion, host = source.questHost;
  if (quest === null || page === null || native === undefined || host === undefined || host === null || book.stages !== null)
    throw new Error('Page stages require their actual quest, interactions and native motion');
  const bindings = new Map<string, DirectorActionBinding[]>();
  for (const request of host.summons) {
    const fight = book.fight;
    if (fight === null || request.target !== ctx.product.section('sim/runtime-plan').recipe.population.owner.actor) throw new Error('Quest summon requires its actual encounter');
    const actions = bindings.get(request.director) ?? [];
    actions.push({ action: { spawn: request.target }, run: fight.summon }); bindings.set(request.director, actions);
  }
  book.stages = bindPageQuestStages(ctx, source, { flags: quest.flags, actor: id => clientPopulationActor(ctx, id), bindings, motion: native });
  for (const endpoint of row.endpoints) {
    native.atEnd(endpoint.mover);
    if (!host.stages.some(stage => stage.row.id === endpoint.stage)) throw new Error('Unknown quest endpoint stage');
  }
  // C14: the server moves the mover and keeps the quest. Its rows reaching the end is the moment a player sees, once a raise: a
  // mover already at its end when this page first saw it (a save, another player's raise) makes no edge.
  if (row.endpoints.length > 0) ctx.system({ id: `${host.graph.step}.mover-endpoints`, phase: 'update', run: () => {
    for (const event of native.drainEndEvents()) {
      const endpoint = row.endpoints.find(entry => entry.mover === event.mover);
      if (endpoint !== undefined && event.atEnd && endpoint.toast !== undefined) ctx.game.runtime?.play?.hud.toast(endpoint.toast);
    }
  } });
  const captures = new Map(Object.entries(row.capture).map(([name, steps]) => [name, steps.map(step => {
    if ('flag' in step) { if (!source.quests.flags.includes(step.flag)) throw new Error('Unknown capture flag'); return () => { quest.flags.set(step.flag); }; }
    if ('action' in step) { if (!host.page?.actions.some(action => action.id === step.action)) throw new Error('Unknown capture action'); return () => { page.run(step.action); }; }
    if ('mover' in step) { native.atEnd(step.mover); return () => undefined; } // the server's mover: a capture only names it
    if ('finish' in step) return quest.finished;
    if (!ctx.product.section('client/plan').features.some(feature => feature.kind === 'weather.fields')) throw new Error('Capture requires its admitted weather fields');
    return () => { settleWeatherFields(source.identity.slug, quest.flags.all); };
  })]));
  book.capture = name => { for (const action of captures.get(name) ?? []) action(); };
}

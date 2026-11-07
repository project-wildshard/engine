import { Vector3 } from 'three';
import { test, type Flags } from '@wildshard/engine/world/interact/flags';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { parseDeclaredQuestPage } from '@wildshard/format/declaredQuestPage';
import type { ShardContext } from '../plugin/context';
import type { FollowedMovers } from '../plugin/followedMovers';
import type { SceneHandles } from '../shardfile/sceneHandles';
import { WorldTargetHost, type WorldTargetLanding } from '../../../shared/game/shardfile/worldTargets';
import { InteractionRules } from '../../../shared/game/quest/interactionRows';
import { commitQuestEffects } from '../../../shared/game/quest/effects';
import type { QuestEffect } from '@wildshard/format/questSteps';
import { lightEmitterPresentation } from '../shardfile/lightEmitters';
import { residentWorldScope } from '../shardfile/hybridPresentation';
import { readQuestObservation } from '../../../shared/game/quest/chapterBindings';
import type { PageQuestStages } from '../plugin/ui';

/** Original owners installed by the compiled client features, never shard callbacks. */
interface PageResources {
  readonly flags: Flags;
  readonly handles: SceneHandles;
  readonly motion?: Pick<FollowedMovers, 'atEnd' | 'field'> | undefined;
  readonly channelPrompts: ReadonlyMap<string, Interactable>;
  readonly stages?: PageQuestStages | undefined;
}
/** Entered page presentation retains no second story cursor or durable state. */
export interface DeclaredPage {
  readonly rules: InteractionRules;
  readonly prompts: ReadonlyMap<string, Interactable>;
  readonly run: (id: string) => boolean;
  readonly bindWorldTargets: (landing: WorldTargetLanding) => void;
}

/** Internal quest.page installation. All data and referenced resources preflight
 * before prompts are registered or saved presentation effects are applied. */
export function bindDeclaredPage(ctx: ShardContext, input: unknown, resources: PageResources): DeclaredPage {
  const rows = parseDeclaredQuestPage(input), source = ctx.product.shardfile;
  const interactables = ctx.game.runtime?.interactables;
  if (ctx.scope.disposed || interactables === undefined) throw new Error('Quest page requires its entered interactable owner');
  if (!source.quests.quests.some(row => row.id === rows.quest)) throw new Error('Page requires its declared quest');
  const rules = InteractionRules.fromDeclared(source, resources.flags);
  const observations = new Map(rows.observations.map(row => {
    const ref = row.source;
    if ('flag' in ref) {
      if (!source.quests.flags.includes(ref.flag)) throw new Error(`Unknown quest observation flag ${ref.flag}`);
      return [row.id, () => resources.flags.has(ref.flag)] as const;
    }
    if ('mark' in ref) {
      if (!rules.data.marks.some(mark => mark.id === ref.mark)) throw new Error(`Unknown quest observation mark ${ref.mark}`);
      return [row.id, () => rules.has(ref.mark)] as const;
    }
    if ('saved' in ref || 'quest' in ref) return [row.id, () => readQuestObservation(ctx, rows.quest, ref) !== 0] as const;
    const mover = source.movers.find(moverRow => moverRow.id === ref.mover);
    if (mover === undefined) throw new Error(`Unknown quest observation mover ${ref.mover}`);
    return [row.id, () => {
      const motion = resources.motion;
      if (motion === undefined) throw new Error('Quest mover observation requires its entered native owner');
      return ref.state === 'at-end' ? motion.atEnd(ref.mover) : motion.field(mover.id, 6) === 1;
    }] as const;
  }));
  const state = { has: (id: string): boolean => observations.get(id)?.() ?? rules.has(id) };
  const known = new Set([...source.quests.flags, ...rules.data.marks.map(row => row.id), ...observations.keys()]);
  const conditions = [...rows.initial.map(row => row.when), ...rows.actions.flatMap(row => row.needs),
    ...rows.prompts.flatMap(row => 'channel' in row ? [] : [row.when, ...row.labels.map(label => label.when)])];
  for (const condition of conditions) for (const id of [...condition?.all ?? [], ...condition?.any ?? [], ...condition?.none ?? []])
    if (!known.has(id)) throw new Error(`Unknown quest page condition ${id}`);
  const prompts = new Map<string, Interactable>();
  for (const row of rows.prompts) {
    if ('channel' in row) {
      const channel = resources.channelPrompts.get(row.channel);
      if (channel === undefined) throw new Error(`Missing quest channel prompt ${row.channel}`);
      // Keep its identity, moving position and native sight metadata intact.
      prompts.set(row.id, channel); continue;
    }
    const position = resources.handles.point(row.at, new Vector3());
    let label = row.label;
    prompts.set(row.id, {
      position,
      get label() { return row.labels.find(entry => test(state, entry.when))?.text ?? label; },
      set label(value) { label = value; },
      get radius() { return test(state, row.when) ? row.radius : 0; },
      onInteract: () => { throw new Error('Quest prompt is not bound'); },
    });
  }
  const scene = { handles: resources.handles, prompts, rules, get motion() { return resources.motion; } };
  const toast = (text: string): void => {
    const play = ctx.game.runtime?.play;
    if (play === undefined || play === null) throw new Error('Quest page requires the entered play host');
    play.hud.toast(text);
  };
  const actions = new Map(rows.actions.map(row => {
    if (row.interaction !== undefined) rules.row(row.interaction);
    const requests = source.questHost?.graph.actions.filter(action => action.row === row.interaction).map(action => {
      const request = source.questHost?.summons.find(summon => summon.target === action.summon);
      if (request === undefined || !source.questHost?.stages.some(stage => stage.row.id === request.director)) throw new Error('Quest graph requires its admitted page stage');
      return request.director;
    }) ?? [];
    const before = compileQuestEffects(ctx, rows.quest, row.before, scene), after = compileQuestEffects(ctx, rows.quest, row.after, scene);
    const refused = new Map(Object.entries(row.refused).map(([reason, effects]) => [reason, compileQuestEffects(ctx, rows.quest, effects, scene)]));
    const refuse = (reason: string): false => {
      const text = row.denied[reason]; if (text !== undefined) toast(text);
      refused.get(reason)?.(); return false;
    };
    return [row.id, (): boolean => {
      for (const need of row.needs) if (!test(state, need)) return refuse(need.else ?? 'refused');
      if (row.interaction === undefined) before();
      else { const result = rules.run(row.interaction, before); if (!result.ok) return refuse(result.reason); }
      after(); for (const id of requests) {
        const stages = resources.stages; if (stages === undefined) throw new Error('Quest stage has not entered play'); stages.advance(id);
      } return true;
    }] as const;
  }));
  const run = (id: string): boolean => {
    if (ctx.scope.disposed) throw new Error('Quest page owner is disposed');
    const action = actions.get(id); if (action === undefined) throw new Error(`Unknown quest page action ${id}`);
    return action();
  };
  const initial = rows.initial.map(row => ({ when: row.when, run: compileQuestEffects(ctx, rows.quest, row.effects, scene) }));
  const interactions = new Map<string, { run: () => boolean }>();
  for (const row of rules.data.rows) {
    const pageActions = rows.actions.filter(action => action.interaction === row.id);
    if (pageActions.length === 1) {
      const action = pageActions[0]; if (action !== undefined) interactions.set(row.id, { run: () => run(action.id) });
    }
  }
  const contacts = new WorldTargetHost(ctx.product.section('world/targets'), {
    flags: { has: id => rules.has(id), set: id => { resources.flags.set(id); } }, interactions, hints: { show: toast },
  });
  for (const row of rows.prompts) {
    const prompt = prompts.get(row.id); if (prompt === undefined) throw new Error('Missing admitted prompt');
    if ('channel' in row) prompt.label = row.label;
    prompt.wireId = rows.actions.find(action => action.id === row.action)?.interaction ?? row.id; // a server knows this one by its row or its spot, and judges it there
    prompt.onInteract = () => { run(row.action); };
  }
  for (const row of initial) if (test(state, row.when)) row.run();
  interactables.push(...prompts.values());
  ctx.scope.onDispose(() => { for (const prompt of prompts.values()) { const index = interactables.indexOf(prompt); if (index !== -1) interactables.splice(index, 1); } });
  return { rules, prompts, run, bindWorldTargets: landing => { landing.bindWorldTargets(contacts); } };
}

/** Framework-owned presentation resources; shards provide only admitted effect rows.
 * The page feature binds this table after scene and motion admission, before restore. */
interface QuestEffectScene {
  readonly handles: SceneHandles;
  readonly prompts: ReadonlyMap<string, Interactable>;
  readonly rules: InteractionRules;
  readonly motion?: Pick<FollowedMovers, 'atEnd' | 'field'> | undefined;
}

/** Compile client-only effects against the original owners. Every id resolves before
 * the first effect runs, so a bad restore cannot partially change the scene. */
function compileQuestEffects(ctx: Pick<ShardContext, 'scope' | 'game' | 'product'>, quest: string,
  rows: readonly QuestEffect[], scene: QuestEffectScene): () => void {
  const effects = rows.map(effect => {
    switch (effect.kind) {
      case 'visible': {
        const part = scene.handles.object(effect.part);
        return (): void => { part.visible = effect.value; };
      }
      case 'label': {
        const prompt = scene.prompts.get(effect.prompt);
        if (prompt === undefined) throw new Error(`Missing quest prompt ${effect.prompt}`);
        return (): void => { prompt.label = effect.text; };
      }
      case 'light': {
        const part = scene.handles.light(effect.part);
        return (): void => { part.intensity = effect.intensity; };
      }
      case 'mover': {
        if (!ctx.product.shardfile.movers.some(row => row.id === effect.id)) throw new Error(`Missing quest mover ${effect.id}`);
        const command = effect.command;
        if (command !== 1 && command !== 2 && command !== 3) throw new Error('Invalid quest mover command');
        return (): void => undefined; // a mover is the server's: a press went up by its row, and its rows come back
      }
      case 'emitter': {
        const emitters = lightEmitterPresentation(residentWorldScope(ctx), ctx.product.slug);
        if (!ctx.product.section('client/plan').features.some(feature => feature.kind === 'light.emitters' && feature.rows.rows.some(emitter => emitter.id === effect.target)))
          throw new Error(`Missing quest emitter ${effect.target}`);
        return (): void => { emitters.set(effect.target, effect.value); };
      }
      case 'mark': {
        if (!scene.rules.data.marks.some(row => row.id === effect.target)) throw new Error(`Missing quest mark ${effect.target}`);
        return (): void => { scene.rules.mark(effect.target, effect.value); };
      }
      case 'toast': return (): void => {
        if (effect.when !== undefined && readQuestObservation(ctx, quest, effect.when) === 0) return;
        const play = ctx.game.runtime?.play;
        if (play === undefined || play === null) throw new Error('Quest toast requires the entered play host');
        const progress = effect.progress;
        if (progress === undefined) { commitQuestEffects(ctx, quest, [effect]); return; }
        const count = progress.flags.filter(flag => scene.rules.has(flag)).length;
        play.hud.toast(count === progress.flags.length ? progress.complete : `${effect.text} · ${String(count)}/${String(progress.flags.length)}`);
      };
      case 'command': case 'notice': throw new Error('Quest effect requires an admitted command or notice lane');
      case 'reading': case 'flag': case 'item': case 'sting': return (): void => { commitQuestEffects(ctx, quest, [effect]); };
      default: throw new Error('Unknown quest effect');
    }
  });
  return () => { if (ctx.scope.disposed) throw new Error('Quest effect owner is disposed'); for (const effect of effects) effect(); };
}

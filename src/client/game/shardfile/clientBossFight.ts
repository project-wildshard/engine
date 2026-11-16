import { parse } from 'valibot';
import { ClientBossFightSchema } from '@wildshard/format/clientNative';
import type { ShardContext } from '../plugin/context';
import { bindDeclaredFight } from '../plugin/ui';
import { bindPageBoss } from '../../../shared/game/population/pageHomes';
import { pagePopulationRows } from '../../../shared/game/population/pageRows';
import { folderPainterLight } from '../looks/paintedLook';
import { clientNativeBook } from './clientNativeBook';
import { clientPopulationActor } from './clientPopulation';

/** Both browser encounter patterns borrow the original native plan, record,
 * body and controller. The registry fixes their distinct allocation phases. */
export function installClientBossFight(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientBossFightSchema, input), book = clientNativeBook(ctx), source = ctx.product.shardfile;
  const quest = book.quest, world = ctx.game.runtime?.world, plan = ctx.product.section('sim/runtime-plan');
  const owner = plan.recipe.population.owner;
  if (book.fight !== null || quest === null || world === undefined || world === null || owner.actor !== row.actor
    || (row.kind === 'boss.held') !== (owner.profile.pattern === 'held')) throw new Error('Encounter feature requires its actual saved page and native owner');
  if (typeof row.armed !== 'boolean' && !source.quests.flags.includes(row.armed.flag)) throw new Error('Encounter requires its declared armed flag');
  const common = { player: world.player.position, flags: quest.flags, facts: quest.facts,
    armed: typeof row.armed === 'boolean' ? row.armed : quest.flags.has(row.armed.flag) };
  const definition = { id: owner.actor, row: owner.step, definition: owner.definition, stages: owner.stages, profile: owner.profile, reward: owner.reward.amount,
    victory: { ...owner.victory, ...(row.again === undefined ? {} : { again: row.again }), ...(row.rewardLabel === undefined ? {} : { rewardLabel: row.rewardLabel }) } };
  if (row.kind === 'boss.held') {
    const record = quest.persistence.boss;
    if (record === null || book.population === null) throw new Error('Held encounter requires its actual body and saved record');
    book.fight = bindDeclaredFight(ctx, definition, { ...common, kind: 'held', held: clientPopulationActor(ctx, owner.actor),
      reward: quest.reward.spawn, record: { saved: record.read(), persist: record.write, read: record.read } });
  } else {
    const names = owner.record;
    const telegraph = ctx.product.section('client/plan').features.find(feature => feature.kind === 'boss.telegraph' && feature.actor === owner.actor);
    if (names === undefined || telegraph?.kind !== 'boss.telegraph' || telegraph.view.kind !== 'marked') throw new Error('Spawned encounter requires its original record and presentation');
    const materialScope = ctx.product.section('look/painted').look.lightScope === 'material';
    const body = bindPageBoss(ctx, pagePopulationRows(plan), owner.actor,
      animal => { if (materialScope) folderPainterLight(ctx.product, animal.mesh, ctx.scope); });
    book.fight = bindDeclaredFight(ctx, { ...definition, record: { kind: 'flags', actor: owner.actor, names }, presentation: telegraph.view.rows },
      { ...common, kind: 'spawned', source, body, coins: quest.coins });
  }
}

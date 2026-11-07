import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardContext } from '../../../client/game/plugin/context';
import { QuestState, type QuestMarker, type QuestStep } from '@wildshard/engine/quest/core';
import { installCableModes } from '@wildshard/engine/player/modes';
import { publishBoundQuest } from './boundState';
import { requireBound, runtimeBinds, type RuntimeFacts } from '../plugin/runtimeRows';
import type { Flags } from '@wildshard/engine/world/interact/flags';

/** Bind a declared quest to the actual flag/ledger owners. The caller chooses
 * its admitted mode rows; this function never constructs a runtime declaration. */
export function bindPageQuest(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile, id: string,
  ports: RuntimeQuestPorts, modes: typeof source.modes = source.modes): RuntimeQuest {
  const declared = source.quests.quests.find((row) => row.id === id);
  if (declared === undefined) throw new Error(`Undeclared quest ${id}`);
  const fact = declared.onComplete?.fact ?? null, facts = ports.facts;
  if (fact !== null && (facts === undefined || !source.ledger.some((rule) => rule.fact === fact))) throw new Error(`Quest ${id} completes with fact ${fact}, which needs the bound ledger`);
  const place = (marker: MarkerRow): QuestMarker => ({ ...marker, at: ports.place?.(marker) ?? marker.at });
  const steps = declared.steps.map((step): QuestStep => {
    const chip = ports.chip?.(step) ?? step.chip;
    return { ...step, ...(chip === undefined ? {} : { chip }), ...(step.markers === undefined ? {} : { markers: step.markers.map(place) }) };
  });
  const intro = declared.intro === undefined ? undefined : { ...declared.intro, ...(declared.intro.markers === undefined ? {} : { markers: declared.intro.markers.map(place) }) };
  const state = new QuestState({ id: declared.id, title: declared.title, completeFlag: declared.completeFlag, steps,
    ...(declared.startWhen === undefined ? {} : { startWhen: declared.startWhen }), ...(intro === undefined ? {} : { intro }) }, ports.flags, ctx.app.events, ctx.scope);
  if (fact !== null && facts !== undefined) {
    const witness = (): void => { facts(fact, declared.id); };
    if (state.isComplete) witness();
    ctx.scope.onDispose(state.observe({ complete: witness }));
  }
  const bound = { state, declared, cables: installCableModes(ctx.scope, modes?.traverse ?? [], ports.flags), reward: { coins: declared.onComplete?.coins ?? 0, fact } };
  publishBoundQuest(ctx.scope, state);
  return bound;
}

type QuestRow = Shardfile['quests']['quests'][number];
type MarkerRow = NonNullable<QuestRow['steps'][number]['markers']>[number];

/** What a runtime lends a declared quest: its flags, built marker positions and an optional trusted presentation override. */
export interface RuntimeQuestPorts {
  readonly flags: Flags;
  /** Required when the quest's `onComplete` names a fact. */
  readonly facts?: RuntimeFacts;
  /** The marker's spot on its built piece (the world decides its height); `undefined` keeps the declared spot. */
  readonly place?: (marker: MarkerRow) => QuestMarker['at'] | undefined;
  /** A chip for a step, overriding the declared one. */
  readonly chip?: (step: QuestRow['steps'][number]) => string | undefined;
}
/** A declared quest bound into the runtime's play scope. Coins are the runtime's to pay (its purse and its beat). */
export interface RuntimeQuest {
  /** The mode host's admitted cable owner, on this quest's existing scope and flags. */
  readonly cables: ReturnType<typeof installCableModes>;
  readonly state: QuestState;
  readonly declared: QuestRow;
  readonly reward: { readonly coins: number; readonly fact: string | null };
}

/**
 * Build one declared quest's state over the runtime's flags, scoped to its play scope. The `onComplete` fact is emitted
 * through the bound ledger when the quest completes, and once on bind for a save that finished it before facts existed.
 */
export function bindRuntimeQuest(ctx: Pick<ShardContext, 'app' | 'scope'> & Partial<Pick<ShardContext, 'product'>>, source: Shardfile, id: string, ports: RuntimeQuestPorts): RuntimeQuest {
  requireBound(source, 'quests');
  const modeSource = runtimeBinds(source).has('modes') ? ctx.product : null;
  if (modeSource === undefined) throw new Error('Runtime-bound modes require an admitted product');
  return bindPageQuest(ctx, source, id, ports, modeSource === null ? source.modes : modeSource.shardfile.modes);
}

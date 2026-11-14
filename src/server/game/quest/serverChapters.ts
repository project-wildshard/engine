/** J141, J106: a story its page used to run, on the server. A shard with a chapter view and no quest host (Nalati) has each player's
 *  chapters here: its decision program is asked on the page's own beat, its flags land in that player's book, a chapter's end files
 *  its fact, and a round of the carried prop (kokpar) runs per player. One program instance serves every player, so a seat costs a
 *  few projections a second and no script. A page shows what these say: `OWNED_ROW.said`, `OWNED_ROW.prop` and the flags. */
import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import { lineFor, QuestLine, type QuestDef, type QuestState } from '@wildshard/engine/quest/core';
import { questBooks, type QuestBook } from '@wildshard/engine/quest/players';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { encounterRows } from '@wildshard/engine/sim/encounterRows';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { AdventurePersistenceSchema } from '@wildshard/format/namedJsonContracts';
import type { ChapterViewRows } from '@wildshard/format/questPageComposition';
import { ClientRidingSessionSchema } from '@wildshard/format/riding';
import { parseCarriedQuest } from '@wildshard/format/questSteps';
import { parseChapterStoryPresentation } from '@wildshard/format/questStory';
import type { ObservationRef } from '@wildshard/format/sceneRefs';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { OWNED_ROW } from '../../../shared/game/loot/ownedRows';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { chapterDecide } from '../../../shared/game/quest/chapterDecision';
import { chapterFlow } from '../../../shared/game/quest/chapterFlow';
import { carriedRound, carriedRoundCarrying, carriedRoundDue, carriedRoundFrame, carriedRoundGoal, carriedRoundHome, carriedRoundOutputs, type CarriedRound } from '../../../shared/game/quest/carriedRound';
import { commitSeatEffects } from '../../../shared/game/quest/effects';
import { featOutcome, witnessSavedFeats, type FeatCounterPorts } from '../../../shared/game/quest/featCounters';
import { questObservation, type ObservedRecords } from '../../../shared/game/quest/questObservation';
import type { QuestStepEffect } from '../../../shared/game/quest/steps';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { mountedPlayerOf } from '../riding/native';
import { registerInstalled } from '../shardfile/installedSides';

/** The file that says a shard's story runs on its chapters. */
export const CHAPTER_CONTENT = 'quests/content.json';
const RIDING = 'riding/session.json', ENCOUNTER_ROW = 'encounter:';
/** How far past a talk's own reach a finished reading still counts: walking off closes it, a beat late. */
const TALK_SLACK = 2;
/** A feat's saved count, as a player's own flag: flags are what a world and a room already save, per player, with no new saved shape. */
const countFlag = (id: string, n: number): string => `feat:${id}:${String(n)}`;
const NOBODY_PACKS = { add: (): boolean => false, take: (): boolean => false };

type Decision = NonNullable<ReturnType<typeof parseChapterStoryPresentation>['decision']>;
type Effects = readonly QuestStepEffect[];
interface Figure { readonly row: { readonly feet: readonly [number, number, number] } }
/** One player at the story. */
interface ChapterSeat {
  readonly book: QuestBook; readonly line: QuestLine; readonly round: CarriedRound; readonly states: ReadonlyMap<string, QuestState>;
  readonly said: Map<string, number>; readonly feats: FeatCounterPorts; readonly flow: ReturnType<typeof chapterFlow>;
  /** Where the prop stands for this player: 0 home, 1 carried, 2 + a goal. */
  prop: number;
  readonly off: () => void;
}
/** A chapter as a state reads it. These stand beside the host's quests, which a world's save pins: a player's flags are what's kept, and these follow from them. */
const questDef = (row: Shardfile['quests']['quests'][number]): QuestDef => ({ id: row.id, title: row.title, completeFlag: row.completeFlag, steps: row.steps.map(({ markers: _markers, ...step }) => step),
  ...(row.startWhen === undefined ? {} : { startWhen: row.startWhen }) });
const presents = (effect: QuestStepEffect): boolean => effect.kind === 'toast' || effect.kind === 'sting' || effect.kind === 'reading';

/** Put a chapter story on `host`, for every player. False when this shard has none. */
export async function installServerChapters(host: SimHost, product: ShardFolder | undefined, shard: Shardfile, file: (fact: string, entity: string) => void): Promise<boolean> {
  if (product === undefined || !product.hasFile(CHAPTER_CONTENT) || (shard.questHost !== undefined && shard.questHost !== null)) return false;
  const content = await product.json<ChapterViewRows>(CHAPTER_CONTENT), view = content.view;
  const [storyInput, carriedInput, persistence, riding] = await Promise.all([product.json<unknown>(view.story), product.json<unknown>(view.carried), product.json<unknown>('quests/persistence.json'), product.hasFile(RIDING) ? product.json<unknown>(RIDING) : null]);
  const story = parseChapterStoryPresentation(storyInput), carried = parseCarriedQuest(carriedInput), saved = v.parse(AdventurePersistenceSchema, persistence), decision: Decision | undefined = story.decision;
  const counters = saved.counters, bondedFeat = riding === null ? null : v.parse(ClientRidingSessionSchema, riding).naming.bondedFeat;
  const defs = story.chapters.map(id => { const row = shard.quests.quests.find(entry => entry.id === id); if (row === undefined) throw new Error(`Undeclared chapter ${id}`); return questDef(row); });
  const declared = new Set(shard.quests.flags), books = questBooks(host), routes = actRoutes(host);
  const facts = new Map(shard.quests.quests.flatMap(row => row.onComplete?.fact === undefined ? [] : [[row.id, row.onComplete.fact] as const]));
  const brain = ReturnProgram.native(host, content.program), round = ReturnProgram.native(host, carried.program);
  books.claim(declared); books.show(declared);
  for (const feat of counters?.feats ?? []) books.claim(Array.from({ length: feat.count }, (_, n) => countFlag(feat.id, n + 1)));
  const channels = new Map<Effects, string>(Object.entries(decision?.actions ?? {}).map(([channel, effects]) => [effects, channel]));
  const npcs = new Map(story.talks.map(row => {
    const npc = content.npcs[row.id], figures = (content.figures as { readonly figures?: Readonly<Record<string, Figure>> } | undefined)?.figures, figure = figures?.[row.id] ?? figures?.[row.figure ?? row.id];
    if (npc === undefined || figure === undefined) throw new Error(`Missing chapter speaker ${row.id}`);
    return [npc.id, { npc, feet: figure.row.feet, reach: row.radius + TALK_SLACK }] as const;
  }));
  const seats = new Map<string, ChapterSeat>();
  const entity = (book: QuestBook, key: string): string => book === books.lead ? key : `${book.player}:${key}`;
  /** A talk lands before its tick does, so its facts wait for the step that can file them. */
  const owed: (readonly [string, string])[] = [];
  const fact = (book: QuestBook, name: string, key: string): void => { if (shard.ledger.some(row => row.fact === name)) owed.push([name, entity(book, key)]); };
  const countsOf = (flags: Flags): Record<string, number> => Object.fromEntries((counters?.feats ?? []).map(feat => { let n = 0; while (n < feat.count && flags.has(countFlag(feat.id, n + 1))) n++; return [feat.id, n]; }));
  /** What a fight's rows say of the records a story reads. The flags a chapter raises off them are what's kept. */
  const records = (): ObservedRecords => {
    const bosses: Record<string, { defeated: boolean; rewardTaken: boolean; kills: number }> = {}, elites: Record<string, { kills: number }> = {};
    for (const [wire, read] of encounterRows(host)) {
      const row = read(), id = wire.slice(ENCOUNTER_ROW.length);
      if (row.kind === 'boss' && row.state === 'victory') bosses[id] = { defeated: true, rewardTaken: false, kills: 1 };
      else if (row.kind === 'elite' && (row.state === 'dead' || row.state === 'retired')) elites[id] = { kills: 1 };
    }
    return { bosses: { read: () => bosses }, elites: { read: () => elites } };
  };
  const seatOf = (book: QuestBook): ChapterSeat => {
    const held = seats.get(book.player);
    if (held !== undefined) return held;
    const line = new QuestLine(defs, book.flags), states = new Map(line.chapters.map(state => [state.def.id, state]));
    const feats: FeatCounterPorts = { read: () => countsOf(book.flags), write: counts => { for (const [id, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) book.flags.set(countFlag(id, i)); }, fact: (name, key) => { fact(book, name, key); } };
    const flow = chapterFlow(line, story), feated = (): void => { if (counters !== undefined) for (const [event, count] of flow.feats(book.flags)) featOutcome(counters, feats, 'event', event, undefined, count); };
    const witness = (state: QuestState): void => { const name = facts.get(state.def.id); if (name !== undefined) fact(book, name, state.def.id); };
    for (const state of line.chapters) if (state.isComplete) witness(state);
    line.onComplete = witness;
    if (counters !== undefined) witnessSavedFeats(counters, feats);
    const unwatch = book.flags.onChange((_flag, on) => { if (on) feated(); });
    const seat: ChapterSeat = { book, line, states, round: carriedRound(carried), said: new Map(), feats, flow, prop: 0, off: () => { unwatch(); line.dispose(); } };
    seats.set(book.player, seat); feated();
    return seat;
  };
  const say = (seat: ChapterSeat, channel: string): void => { seat.said.set(channel, (seat.said.get(channel) ?? 0) + 1); };
  const observe = (seat: ChapterSeat, ref: ObservationRef, held: ObservedRecords): number => questObservation(ref, { flags: () => seat.book.flags,
    quest: id => { const state = seat.states.get(id); if (state === undefined) throw new Error(`Unknown chapter ${id}`); return state; }, active: () => seat.line.active, saved: () => held });
  /** A channel's rows on this player: their flags land, and what's for their eyes is said if it passes its own test. */
  const commit = (seat: ChapterSeat, effects: Effects, channel: string, held: ObservedRecords): void => {
    commitSeatEffects(effects.filter(effect => !presents(effect)), seat.book.flags, NOBODY_PACKS);
    if (effects.some(effect => presents(effect) && (effect.kind !== 'toast' || effect.when === undefined || observe(seat, effect.when, held) !== 0))) say(seat, channel);
  };
  const decide = (seat: ChapterSeat, signal: string, values: Readonly<Record<string, number>>, held: ObservedRecords): void => {
    chapterDecide(brain, decision, signal, values, source => observe(seat, source, held), effects => { commit(seat, effects, channels.get(effects) ?? '', held); });
  };
  const inputs = (seat: ChapterSeat): Readonly<Record<string, number>> => {
    const { flags, player } = seat.book, bondRows = saved.bond?.flags ?? [];
    const read: Readonly<Record<string, boolean>> = { 'taming.bonded': bondRows.some(row => row.equals === undefined && flags.has(row.flag)), 'taming.upgraded': bondRows.some(row => row.equals !== undefined && flags.has(row.flag)),
      'arena.inside': routes.inside?.(player) === true, 'arena.tied': routes.tied?.() === true };
    return Object.fromEntries(Object.entries(view.observations).map(([field, source]) => [field, Number(read[source] === true)]));
  };
  /** One beat of a player's round: the same projection a page ran, on the server's numbers. */
  const carry = (seat: ChapterSeat, dt: number, signal: string = carried.signals.step): void => {
    const body = host.players.get(seat.book.player), mount = mountedPlayerOf(host, seat.book.player);
    if (body === undefined || mount === undefined) return;
    const carrier = mount.horse, gait = mount.body.gait, state = seat.round;
    const out = round.project(signal, carriedRoundFrame(carried, state, dt, { playerX: body.position.x, playerZ: body.position.z, mounted: mount.mounted, carrier: carrier !== null, fast: gait === 'canter' || gait === 'gallop', practice: false, carrierX: carrier?.position.x ?? 0, carrierZ: carrier?.position.z ?? 0 }));
    const step = carriedRoundOutputs(carried, state, out), held = records();
    if (step.warning) commit(seat, carried.warning, 'carried.warning', held);
    if (step.reset) { carriedRoundHome(carried, state); seat.prop = 0; } else if (step.carry) seat.prop = 1;
    if (step.event > 0) { const action = carried.events.find(row => row.value === step.event); if (action === undefined) throw new Error('Missing carried quest effect'); commit(seat, action.effects, `carried.${String(step.event)}`, held); }
    const goal = carriedRoundGoal(carried, state, out);
    if (goal !== null) seat.prop = 2 + carried.goals.indexOf(carried.goals.find(row => row.x === goal.x && row.z === goal.z) ?? carried.goals[0] ?? goal);
    else if (!carriedRoundCarrying(carried, state) && seat.prop === 1) seat.prop = 0;
  };
  publishOwned(host, 'story', (player, out) => {
    const seat = seats.get(player);
    if (seat === undefined) return;
    out.set(OWNED_ROW.prop, seat.prop);
    for (const [channel, count] of seat.said) out.set(`${OWNED_ROW.said}${channel}`, count);
  });
  /** A reading a page finished raises the flags that talk offers this player, where they stand. */
  const spoke = (book: QuestBook, flag: string): boolean => {
    const body = host.players.get(book.player);
    if (body === undefined) return false;
    for (const { npc, feet, reach } of npcs.values()) {
      if (Math.hypot(body.position.x - feet[0], body.position.z - feet[2]) > reach) continue;
      if (lineFor(npc, book.flags)?.sets?.includes(flag) === true) return true;
    }
    return false;
  };
  routes.story = (player, flag) => { const book = books.of(player); if (declared.has(flag) && spoke(book, flag)) book.flags.set(flag); };
  routes.bonded = (player, value) => {
    const seat = seatOf(books.of(player));
    for (const row of saved.bond?.flags ?? []) if (row.equals === undefined || row.equals === value) seat.book.flags.set(row.flag);
    if (counters !== undefined && bondedFeat !== null) featOutcome(counters, seat.feats, 'event', bondedFeat);
  };
  for (const id of npcs.keys()) routes.claims.set(`${id}.talk`, () => undefined); // the talk opens on the page, and what it raises comes as `story`
  const seated = (): readonly ChapterSeat[] => {
    const all = books.each();
    for (const [player, seat] of seats) if (!host.players.has(player)) { seat.off(); seats.delete(player); }
    return all.map(seatOf);
  };
  let now = 0, slow = 0, pulse = -1e9;
  host.events.on('actor.died', ({ actor }) => {
    const body = [...host.entities.values()].find(candidate => candidate.combatActor() === actor);
    if (body === undefined) return;
    const held = records(); // the death names no killer: it counts for the room, as a contract's does
    for (const seat of seated()) {
      if (counters !== undefined) featOutcome(counters, seat.feats, 'kill', body.kind, body.variant);
      if (body.kind === view.death.kind) decide(seat, view.death.signal, { [view.timeField]: now }, held);
    }
  }, host.scope);
  host.onStep('story.chapters', dt => {
    now += dt;
    const all = seated();
    for (const [name, key] of owed.splice(0)) file(name, key);
    for (const seat of all) { const elapsed = carriedRoundDue(carried, seat.round, dt); if (elapsed !== null) carry(seat, elapsed); }
    if (now - slow <= view.interval) return;
    slow = now;
    const held = records(), beat = now - pulse > view.pulse.interval;
    if (beat) pulse = now;
    for (const seat of all) {
      decide(seat, view.signal, { [view.timeField]: now, ...inputs(seat) }, held);
      if (beat) decide(seat, view.pulse.signal, { [view.timeField]: now }, held);
    }
  });
  host.scope.onDispose(() => { for (const seat of seats.values()) seat.off(); seats.clear(); });
  // SS3b: `state.adventure`'s server half: the same quests/persistence.json rows, each player's feat counts and bond kept as
  // their own book's flags (saved with the room), where the page keeps one device's records
  if (counters !== undefined || saved.bond !== undefined) registerInstalled(host, 'saves');
  return true;
}

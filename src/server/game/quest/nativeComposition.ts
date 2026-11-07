import { skinSave } from '../../../shared/game/saves';
import { isJsonData } from '@wildshard/format/json';
import { parseNativeQuestComposition, type NativeQuestCompositionRows } from '@wildshard/format/nativeQuestComposition';
import { nativeQuestChannels } from './nativeInputs';
import { prepareNativeQuestEntry } from './nativeEntry';
import { nativeStageLane, type readDirectorProduct } from '../../../shared/game/plugin/director';
import { mixedPopulation } from '../population/mixedRoster';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { InteractTable } from '@wildshard/engine/world/interact/types';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import type { NativeCableRider } from '@wildshard/engine/sim/cableTraversal';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { NpcDialogueRow } from '@wildshard/format/npcs';
import type { ContractCatalogue } from '@wildshard/format/contracts';
import type { AchievementCounterData } from '@wildshard/format/achievementCounters';
import { QuestRewardController, installNativeQuestProps, createReadingRoster, bindQuestDeathEffects, type QuestReadingRows } from '../../../shared/game/plugin/quests';
import { nativeMeleeItem, otherCombatFrame, readNativeRangedItem, seatedBolt, type NativeBoltItem } from '../plugin/nativeItems';
import { nativeHeldAmmunition, NativeAmmunitionSavedSchema } from '../loadout/nativeAmmunition';
import { nativeInventorySchema, type NativeInventory } from '../../../shared/game/inventoryLaw';
import { cableModes } from '@wildshard/engine/player/modes';
import { NpcReading } from '@wildshard/engine/quest/dialogueClock';
import { bindHeadlessPrompts, parsePromptRegistrations, type PromptRegistration, type HeadlessPrompt } from '../../../shared/game/quest/interactionRows';
import { ContractBoard, CONTRACT_ACTION } from '../../../shared/game/quest/contractBoard';
import { contractKill } from '../../../shared/game/quest/contracts';
import { Exchange } from '../../../shared/game/loot/exchange';
import { QuestStepRunner } from '../../../shared/game/quest/steps';
import { commitQuestEffects, commitSeatEffects } from '../../../shared/game/quest/effects';
import { questBenchPose } from '../../../shared/game/quest/storyLaw';
import { installNativeChapterDirector } from './nativeChapter';
import { takeNativeBossReward } from '../boss/native';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { questBooks } from '@wildshard/engine/quest/players';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { boardLines, OWNED_ROW } from '../../../shared/game/loot/ownedRows';

const promptLoans = new WeakMap<SimHost, Map<string, readonly HeadlessPrompt[]>>();
/** Borrow the actual bound roster, including unhosted prompts and live reach. */
/** The owner of a quest's pack on a world's owned rows. */
export const QUEST_OWNED = 'quest';
export function nativeQuestPromptRoster(host: SimHost, id: string): readonly HeadlessPrompt[] {
  const roster = promptLoans.get(host)?.get(id);
  if (host.scope.disposed || roster === undefined) throw new Error('Missing native quest prompt roster');
  return roster;
}
const MAX_BODIES = 64;
const finite = v.pipe(v.number(), v.finite()), xyz = { x: finite, y: finite, z: finite };
const Row = v.strictObject({ id: v.string(), kind: v.string(), ...xyz, yaw: finite, prompt: v.optional(v.strictObject(xyz)),
  collider: v.optional(v.strictObject({ x: finite, z: finite, hw: finite, hd: finite, rot: finite, yTop: finite, yBottom: finite })) });
const Prompt = v.strictObject({ label: v.string(), ...xyz, radius: finite });
const Spots: v.GenericSchema<unknown, NativeQuestSpotRows> = v.object({ version: v.literal(1), rows: v.array(Row), talk: Prompt, sword: Prompt,
  reward: v.strictObject({ ...xyz, yaw: finite, pitch: finite, phase: finite }), promptRegistrations: v.unknown(),
  zipline: v.strictObject({ top: v.strictObject(xyz), bottom: v.strictObject(xyz), sag: finite, prompt: v.strictObject({ ...xyz, radius: finite }) }) });
const Fast = v.strictObject({ from: finite, span: finite, t: finite, dur: finite, to: finite });
const CableSaved = v.nullable(v.strictObject({ s: finite, v: finite }));
const Watch = v.strictObject({ lost: finite, wedge: finite, from: v.strictObject(xyz) });
const BarrelSaved = v.nullable(v.strictObject({ handle: v.pipe(finite, v.minValue(0)), watch: Watch, decision: v.exactOptional(v.string()) }));
const countsSaved = v.record(v.string(), v.pipe(finite, v.integer(), v.minValue(0)));

type Point = Readonly<{ x: number; y: number; z: number }>;
type QuestPrompt = Point & { readonly radius: number };
interface NativeQuestPlaces {
  readonly rows: readonly (Point & { readonly id: string; readonly kind: string; readonly yaw: number; readonly prompt?: Point | null | undefined })[];
  readonly people?: readonly { readonly kind: string; readonly at: Point; readonly prompt: QuestPrompt }[];
  readonly board?: QuestPrompt; readonly pickup?: QuestPrompt; readonly signals?: Readonly<Record<string, QuestPrompt>>;
  readonly talk?: QuestPrompt; readonly sword?: QuestPrompt;
  readonly reward?: Point & { readonly yaw: number; readonly pitch: number; readonly phase: number };
  readonly cable: { readonly top: Point; readonly bottom: Point; readonly sag?: number; readonly prompt: QuestPrompt };
  readonly promptRegistrations?: readonly PromptRegistration[];
}
interface NativePoint { x: number; y: number; z: number }
interface NativeSpotPrompt extends NativePoint { label: string; radius: number }
/** The admitted spot file, spelled out for the declaration boundary. */
interface NativeQuestSpotRows {
  version: 1; talk: NativeSpotPrompt; sword: NativeSpotPrompt; promptRegistrations: unknown;
  rows: (NativePoint & { id: string; kind: string; yaw: number; prompt?: NativePoint | undefined;
    collider?: { x: number; z: number; hw: number; hd: number; rot: number; yTop: number; yBottom: number } | undefined })[];
  reward: NativePoint & { yaw: number; pitch: number; phase: number };
  zipline: { top: NativePoint; bottom: NativePoint; sag: number; prompt: NativePoint & { radius: number } };
}
export type NativeQuestSpots = Omit<NativeQuestSpotRows, 'promptRegistrations'> & NativeQuestPlaces;
/** Existing authored world placements, with one borrowed cable view for the shared frame. */
export function readNativeQuestSpots(input: unknown): NativeQuestSpots {
  const spots = v.parse(Spots, input);
  return { ...spots, cable: spots.zipline, promptRegistrations: parsePromptRegistrations(spots.promptRegistrations) };
}
/** All executable mechanics are native owners. Author input supplies only rows,
 * captured placements, admitted programs and a prepared platform director. */
export interface NativeQuestCompositionInput {
  readonly rows: NativeQuestCompositionRows; readonly counters: AchievementCounterData;
  readonly source: Shardfile; readonly table: InteractTable; readonly spots: NativeQuestPlaces;
  readonly props?: unknown; readonly restoring?: boolean;
  readonly steps?: unknown; readonly deaths?: unknown;
  readonly readings?: QuestReadingRows<NpcDialogueRow>; readonly contracts?: ContractCatalogue; readonly trades?: unknown;
  readonly lead?: { readonly program: unknown; readonly path: readonly (readonly [number, number])[] };
  readonly director?: Awaited<ReturnType<typeof readDirectorProduct>>;
}

const SeatGearSaved = v.strictObject({ iron: v.boolean(), rewardOwned: v.boolean(), skins: v.array(v.string()) });

/** One frame, command graph and saved adapter for the declared native facets.
 * State/scheduling rows keep the existing owner wire without a shard mode. */
export function installNativeQuestComposition(host: SimHost, ports: NativeQuestCompositionInput): {
  readonly quests: ReturnType<ReturnType<typeof prepareNativeQuestEntry>['install']>['quests'];
  readonly pack: NativeInventory<string>; readonly cables: ReturnType<typeof cableModes>;
  readonly lead: NativeLeadSaved | null; readonly board: ContractBoard | null; readonly trader: Exchange | null;
  readonly riding: () => boolean; readonly talking: () => boolean;
  readonly ownsFinish: (skin: string) => boolean; readonly ownsBoardFinish: () => boolean; readonly takePickup: () => boolean;
} {
  if (!isJsonData({ rows: ports.rows, table: ports.table, spots: ports.spots, counters: ports.counters, props: ports.props ?? null,
    steps: ports.steps ?? null, deaths: ports.deaths ?? null, readings: ports.readings ?? null, contracts: ports.contracts ?? null, trades: ports.trades ?? null, lead: ports.lead ?? null }))
    throw new Error('Native quest composition requires JSON rows');
  const rows = parseNativeQuestComposition(ports.rows), spots = ports.spots, flags = host.flags;
  const need = <T>(value: T | undefined, name: string): T => { if (value === undefined) throw new Error(`Missing native quest ${name}`); return value; };
  const entry = prepareNativeQuestEntry(host, ports.source, ports.table, spots.rows, rows.bounds, rows.saved.names);
  const { input, pack } = entry, rules = [...entry.rules.values()], indexed = entry.rules, books = questBooks(host);
  const traveller = need(host.players.get(books.lead.player), 'first player');
  let promptRoster: readonly HeadlessPrompt[] | undefined;
  let seatRoster: ((owned: typeof rules, player: string) => readonly HeadlessPrompt[]) | undefined;
  /** What carries one traveller: their body, ride, board, trader, reward and held gear. */
  interface SeatGear {
    readonly body: PlayerSim; readonly board: ContractBoard | null; readonly trader: Exchange | null; readonly reward: QuestRewardController | null;
    readonly ammunition: ReturnType<typeof nativeHeldAmmunition> | null; readonly state: { iron: boolean; rewardOwned: boolean };
    readonly skins: ReadonlySet<string>; readonly claim: (value: number) => void; readonly riding: () => boolean; readonly seen: Flags;
  }
  /** One player's place at the composition. The lead's are the composition's own owners. */
  interface QuestSeat {
    readonly rules: ReadonlyMap<string, typeof rules[number]>; readonly transitions: ReturnType<typeof entry.transitions>;
    readonly dialogue: ReturnType<typeof readingRoster>; readonly roster: readonly HeadlessPrompt[] | undefined; readonly gear: SeatGear;
  }
  const seats = new Map<string, QuestSeat>();
  const seatOf = (player: string): QuestSeat => { books.of(player); return need(seats.get(player), 'player seat'); };
  const gearOf = (player: string): SeatGear => seatOf(player).gear;
  const state = { iron: false, pickup: false, rewardOwned: false }; let finishes = new Set(skinSave.read(ports.source.identity.slug).owned.filter(id => rows.board?.ids.includes(id)));
  const purchases = new Map<string, Map<number, number>>();
  const population = rows.acquisition === undefined ? null : mixedPopulation(host, rows.acquisition.population);
  const equipment = rows.acquisition === undefined ? null : nativeMeleeItem(host, rows.acquisition.equipment);
  const finale = rows.reward === undefined ? null : nativeStageLane(host, rows.reward.director);
  const channels = rows.reward === undefined ? null : nativeQuestChannels(host, rows.reward.channels);
  const props = rows.props === undefined ? null : installNativeQuestProps(host, ports.props, ports.restoring ?? false);
  const ammunition = rows.ammunition === undefined ? null : nativeHeldAmmunition(host);
  const launcher = rows.ammunition === undefined ? null : readNativeRangedItem(host, rows.ammunition.launcher);
  if (launcher !== null && launcher.kind !== 'bolt') throw new Error('Story launcher requires a bolt item');
  const bench = rows.bench === undefined ? null : need(indexed.get(rows.bench.id), 'bench');
  if (bench !== null && (bench.d.kind !== 'bench' || bench.spot.prompt === null || bench.spot.prompt === undefined)) throw new Error('Story bench requires its prompt');
  const cables = cableModes(host.scope), cableId = rows.cable;
  cables.state(cableId);
  const rider = rows.reward === undefined ? null : cables.nativeRider(cableId);
  if (rider !== null) {
    const cable = cables.declaration(cableId);
    if (JSON.stringify(cable.top) !== JSON.stringify(spots.cable.top) || JSON.stringify(cable.bottom) !== JSON.stringify(spots.cable.bottom) || cable.sag !== spots.cable.sag)
      throw new Error('Native quest cable row does not match the real native spots');
    holdCarried(traveller, rider, flags);
  }
  /** While carried, the ride owns the body; the look stays the player's until the reward is seen. */
  function holdCarried(body: PlayerSim, ride: NativeCableRider, book: Flags): void {
    const rewardFlag = need(rows.reward, 'reward').seen;
    body.useDriver({ input: command => {
      if (!ride.carried) return false;
      if (command !== undefined && !book.has(rewardFlag)) body.yaw = command.yaw;
      body.impulse.set(0, 0, 0); ride.velocity.set(0, 0, 0); body.fall.grounded = false; return true;
    }, step: () => undefined });
  }
  /** One traveller's reward beat. Only the first player's moves the shared day. */
  const rewardFor = (ride: NativeCableRider, day: typeof host.dayClock, book: Flags): QuestRewardController => new QuestRewardController(ride, day, {
    at: new Vector3(need(spots.reward, 'reward pose').x, need(spots.reward, 'reward pose').y, need(spots.reward, 'reward pose').z),
    yaw: need(spots.reward, 'reward pose').yaw, pitch: need(spots.reward, 'reward pose').pitch, phase: need(spots.reward, 'reward pose').phase,
    when: () => channels?.[need(rows.reward, 'reward').field] === true || channels?.[need(rows.reward, 'reward').field] === 1,
    finish: () => { const flag = need(rows.reward, 'reward').complete; if (book.has(flag)) return false; book.set(flag); return true; },
  });
  if (rows.reward !== undefined) books.claim([rows.reward.complete]);
  const reward = rows.reward === undefined || rider === null ? null : rewardFor(rider, host.dayClock, flags);
  if (reward !== null) host.scope.onDispose(() => { reward.dispose(); });
  const keyPrompt = { x: 0, y: 0, z: 0 }, walked = { x: 0, z: 0 }, eye = new Vector3(), at = new Vector3();
  const promptOf = (rule: typeof rules[number]): Point | undefined => {
    const key = rows.props === undefined ? null : props?.dropAt(rows.props.drop.id);
    if (rule.d.kind !== 'key' || key === null || key === undefined) return rule.spot.prompt ?? undefined;
    keyPrompt.x = key.x; keyPrompt.y = key.y + need(rows.props, 'props').promptHeight; keyPrompt.z = key.z; return keyPrompt;
  };
  const guarded = (): boolean => {
    if (population === null || rows.acquisition === undefined) return false;
    const bodies = population.bodies();
    for (let i = 0; i < MAX_BODIES; i++) { const body = bodies[i]; if (body === undefined) break; if (body.kind === rows.acquisition.kind && body.actor?.alive === true) return true; }
    return false;
  };
  const bound = rows.bounds?.rows;
  if (bound !== undefined && (ports.counters.feats.length > bound || ports.counters.feats.some(feat => feat.count > bound))) throw new RangeError('Native quest feats exceed their finite bound');
  const earlyCounters = rows.counts === 'declared' ? entry.achievements(ports.counters, Object.fromEntries(ports.counters.feats.map(feat => [feat.id, 0]))) : null;
  const graph = entry.install(commandOwners());
  // Every prompt with an act answers a client by name: a sword or a cable is a command too, not only the graph's rows.
  publishOwned(host, QUEST_OWNED, (player, out) => {
    for (const [good, count] of purchases.get(player) ?? []) out.set(`${OWNED_ROW.purchase}${String(good)}`, count);
    if (player === books.lead.player) for (const [id, count] of Object.entries(pack.snapshot().counts)) out.set(`${OWNED_ROW.item}${id}`, count);
    const gear = seats.get(player)?.gear;
    if (gear !== undefined) { for (const id of gear.skins) out.set(`${OWNED_ROW.finish}${id}`, 1); if (gear.state.rewardOwned && rows.board !== undefined) out.set(`${OWNED_ROW.finish}${rows.board.finish}`, 1); }
    const owner = gear?.board; if (owner !== null && owner !== undefined) boardLines(owner.current, out);
  });
  if (rows.board !== undefined) actRoutes(host).board = (player, op, slot) => {
    const gear = gearOf(player), reach = { x: gear.body.position.x, y: gear.body.position.y + rows.eye, z: gear.body.position.z };
    gear.board?.use(CONTRACT_ACTION.open, reach); eye.set(reach.x, reach.y, reach.z); gear.claim((op === 'claim' ? CONTRACT_ACTION.claim0 : CONTRACT_ACTION.tear0) + slot); gear.board?.use(CONTRACT_ACTION.close, reach);
  };
  if (rows.trade !== undefined) actRoutes(host).buy = (player, good) => {
    const { trader: seat } = gearOf(player); if (seat === null) return;
    seat.open();
    try { if (seat.use(good)) { const bought = purchases.get(player) ?? new Map<number, number>(); bought.set(good, (bought.get(good) ?? 0) + 1); purchases.set(player, bought); } }
    finally { seat.close(); }
  };
  const interactions = actRoutes(host).interactions, promptActor = ports.source.questHost?.graph.actor;
  if (promptActor !== undefined) for (const prompt of promptRoster ?? []) if (typeof prompt.id === 'string' && prompt.act !== null && !interactions.has(prompt.id)) interactions.set(prompt.id, { actorId: promptActor, value: prompt.act });
  // A page names its cable by mode: that's the id both sides read from their own rows.
  const cableRoute = rows.prompts === undefined ? undefined : interactions.get(rows.prompts.cable.id);
  if (cableRoute !== undefined) interactions.set(cableId, cableRoute);
  const quests = graph.quests, chapter = quests.quests[0];
  const traderFor = (bag: typeof pack, owns: (skin: string) => boolean, own: (skin: string) => void, quiver: typeof ammunition, bolts: NativeBoltItem | null): Exchange | null => rows.trade === undefined ? null : new Exchange(ports.trades, new Map<string, unknown>([[rows.trade.pack, bag],
    ['skins', { owns, own }],
    ['ammo', { capacity: (kind: string, n: number) => need(quiver ?? undefined, 'ammunition').room(kind, n),
      addBolts: (n: number) => { bolts?.addBolts(n); },
      grant: (kind: string, n: number) => { need(quiver ?? undefined, 'ammunition').add(kind, n); } }]]));
  const trader = traderFor(pack, skin => skin === rows.trade?.finish && state.rewardOwned || finishes.has(skin), skin => { finishes.add(skin); const saved = skinSave.read(ports.source.identity.slug); skinSave.write({ ...saved, owned: [...new Set([...saved.owned, skin])] }, ports.source.identity.slug); }, ammunition, launcher?.kind === 'bolt' ? launcher.item : null);
  const initialTrader = trader?.snapshot();
  const steps = rows.effects === undefined ? null : new QuestStepRunner(ports.steps);
  if (steps !== null) books.claim(steps.writes);
  const readingRoster = (book: Flags, completed: (kind: string) => void) => rows.reading === undefined ? null : createReadingRoster(need(ports.readings, 'readings'), spots.people ?? [],
    (npc, head, radius) => new NpcReading(npc, book, head, radius, need(rows.reading, 'reading').delay), completed);
  const dialogue = readingRoster(flags, kind => {
    commitQuestEffects(host, need(rows.effects, 'effects').pack, need(steps ?? undefined, 'steps').signal({ kind: 'talk', target: kind }, { flags: flags.all, inventory: pack.snapshot().counts }));
    if (kind === rows.trade?.speaker) trader?.open();
  });
  if (ports.readings !== undefined) books.claim(Object.values(ports.readings.speakers).flatMap(npc => npc.dialogue.flatMap(line => line.sets ?? [])));
  const transitions = entry.transitions(rows.transitions);
  const chapterClock = rows.chapter === undefined ? null : installNativeChapterDirector(host, need(ports.director, 'chapter director'), { id: `${rows.step}.chapter`, rows: rows.chapter });
  if (rows.chapter !== undefined && chapter === undefined) throw new Error('Story requires its chapter');
  const counterBook = earlyCounters ?? entry.achievements(ports.counters), feats = counterBook.counters;
  const boardFor = (): ContractBoard | null => rows.board === undefined ? null : new ContractBoard({ contracts: need(ports.contracts, 'contracts'), prompt: need(spots.board, 'board prompt'), radius: need(spots.board, 'board prompt').radius });
  const board = boardFor();
  const initialBoard = board?.snapshot();
  const useBoard = (value: number): void => {
    const claim = board?.use(value, eye); if (claim === null || claim === undefined) return;
    commitQuestEffects(host, need(rows.effects, 'effects').pack, claim.reward.items.map(item => ({ kind: 'item', item: item.id, count: item.n })));
    if (claim.reward.bolts > 0 && launcher?.kind === 'bolt') launcher.item.addBolts(claim.reward.bolts);
    if (claim.reward.skin === rows.board?.finish) state.rewardOwned = true;
    feats.event('streak', claim.streak); counterBook.flush();
  };
  counterBook.observe();
  if (rows.effects !== undefined) {
    const killed = bindQuestDeathEffects(ports.deaths, { kill: feats.kill, event: feats.event,
      calls: new Map([['contracts', (body: SimHost['entities'] extends ReadonlyMap<string, infer Entity> ? Entity : never) => {
        // a room's kill counts on every player's board: the death names no killer
        if (board !== null) for (const book of books.each()) gearOf(book.player).board?.killed(contractKill(need(ports.contracts, 'contracts'), body));
      }]]) });
    host.events.on('actor.died', ({ actor }) => {
      const body = [...host.entities.values()].find(candidate => candidate.combatActor() === actor);
      if (body !== undefined) { killed(body); counterBook.flush(); }
    }, host.scope);
    counterBook.sync();
  }

  const lead = rows.lead === undefined ? null : prepareNativeQuestLead(host, { ...need(ports.lead, 'lead program'), ...rows.lead });

  function commandOwners(): NonNullable<Parameters<typeof entry.install>[0]> {
    const actions = new Map<string, (value: number, player: string) => void>(), observations = new Map<string, (player: string) => boolean>();
    if (rows.acquisition !== undefined) {
      const acquisition = rows.acquisition;
      observations.set(acquisition.observation, player => !gearOf(player).state.iron && !guarded());
      actions.set(acquisition.id, (_value, player) => {
        const gear = gearOf(player); gear.state.iron = true;
        if (player === books.lead.player) equipment?.equip(acquisition.slot); else equipment?.equipFor(gear.body, acquisition.slot);
      });
    }
    if (rows.prompts !== undefined) for (const rule of rules) actions.set(rule.d.id, (_value, player) => {
      const seat = seatOf(player); seat.transitions.interact(need(seat.rules.get(rule.d.id), 'seated row'));
    });
    if (rows.reading !== undefined) {
      observations.set('reading', player => seatOf(player).dialogue?.active ?? false);
      actions.set('quest.reading.next', (_value, player) => { seatOf(player).dialogue?.press(need(rows.reading, 'reading').primary); });
      for (const person of spots.people ?? []) actions.set(`talk.${person.kind}`, (_value, player) => { seatOf(player).dialogue?.press(person.kind); });
    }
    if (rows.trade !== undefined) {
      observations.set('trading', player => gearOf(player).trader?.active ?? false);
      actions.set('quest.trade.close', (_value, player) => { gearOf(player).trader?.use(-1); });
      actions.set('quest.trade.use', (value, player) => { gearOf(player).trader?.use(value); });
    }
    if (rows.board !== undefined) {
      observations.set('boarding', player => gearOf(player).board?.active ?? false);
      actions.set('quest.board.close', (_value, player) => { gearOf(player).board?.use(CONTRACT_ACTION.close, eye); });
      actions.set('quest.board.use', (value, player) => { const gear = gearOf(player); eye.copy(gear.body.position); eye.y += rows.eye; gear.claim(value); });
    }
    if (rows.reading !== undefined || rows.trade !== undefined || rows.board !== undefined)
      actions.set('quest.cancel', (_value, player) => {
        seatOf(player).dialogue?.dismiss();
        const gear = gearOf(player); gear.board?.use(CONTRACT_ACTION.close, eye); gear.trader?.use(-1);
      });
    if (rows.ammunition !== undefined) {
      observations.set('selectable', player => launcher !== null && (player === books.lead.player ? launcher.frame : otherCombatFrame(launcher.frame, player)).live.has(need(rows.ammunition, 'ammunition').launcher));
      actions.set('quest.ammo.cycle', (_value, player) => { gearOf(player).ammunition?.cycle(); });
    }
    if (rows.pickup !== undefined) {
      const flag = rows.pickup.flag; books.claim([flag]); observations.set('pickup', player => !books.of(player).flags.has(flag));
      actions.set('quest.pickup', (_value, player) => { books.of(player).flags.set(flag); if (player === books.lead.player) state.pickup = true; });
    }
    if (rows.boss !== undefined) actions.set('quest.reward', (_value, player) => { eye.copy(gearOf(player).body.position); eye.y += rows.eye; takeNativeBossReward(host, need(rows.boss, 'boss').id, eye); });
    if (rows.bench !== undefined && bench !== null) actions.set(rows.bench.id, (_value, player) => {
      const body = host.players.get(player);
      if (body === undefined || !graph.run(bench.d.id, undefined, player).ok) return;
      const pose = questBenchPose(need(rows.bench, 'bench').pose, bench.spot, bench.spot.yaw);
      at.set(pose.x, pose.y, pose.z); body.motor.resetAt(at); body.position.copy(at); body.yaw = pose.yaw; body.velocity.y = 0;
    });
    const rosterOver = (owned: typeof rules, player: string): readonly HeadlessPrompt[] => bindHeadlessPrompts(spots.promptRegistrations ?? [], id => {
      const policy = need(rows.prompts, 'prompts');
      if (id === policy.talk.id) return { act: policy.talk.action, position: need(spots.talk, 'talk prompt'), radius: policy.talk.radius };
      if (id === rows.acquisition?.id) return { act: rows.acquisition.action, position: need(spots.sword, 'held prompt'), get radius() { return gearOf(player).state.iron ? 0 : guarded() ? need(rows.acquisition, 'acquisition').guardRadius : need(rows.acquisition, 'acquisition').radius; } };
      if (id === policy.cable.id) return { act: policy.cable.action, position: spots.cable.prompt, get radius() { return gearOf(player).riding() ? 0 : spots.cable.prompt.radius; } };
      const i = owned.findIndex(rule => rule.d.id === id), rule = owned[i];
      if (rule?.spot.prompt === undefined || rule.spot.prompt === null) return undefined;
      return { act: policy.rowBase + i, get position() { return promptOf(rule) ?? rule.spot; }, get radius() { return rule.promptRadius(); } };
    });
    const prompts = rows.prompts === undefined ? undefined : rosterOver(rules, books.lead.player);
    promptRoster = prompts; seatRoster = rosterOver;
    return { mechanics: { cables }, observations, actions, ...(prompts === undefined ? {} : { prompts, rosterOf: player => seatOf(player).roster ?? prompts, directorActions: new Map() }),
      ...(prompts === undefined ? { spots: { crack: [], interact: [
        ...rules.flatMap(rule => rule.spot.prompt === null || rule.spot.prompt === undefined ? [] : [{ id: rule.d.id, ...rule.spot.prompt, get radius() { return rule.promptRadius(); } }]),
        ...(spots.people ?? []).map(person => ({ id: `talk.${person.kind}`, x: person.prompt.x, y: person.prompt.y, z: person.prompt.z, radius: person.prompt.radius })),
        ...Object.entries(spots.signals ?? {}).map(([id, prompt]) => ({ id: `signal.${id}`, x: prompt.x, y: prompt.y, z: prompt.z, radius: prompt.radius })),
        { id: 'quest.cable', ...spots.cable.prompt }, ...(spots.pickup === undefined ? [] : [{ id: 'quest.pickup', ...spots.pickup }]),
      ] } } : {}) };
  }

  seats.set(books.lead.player, { rules: indexed, transitions, dialogue, roster: promptRoster, gear: { body: traveller, board, trader, reward, ammunition, state, get skins() { return finishes; }, claim: useBoard, seen: flags,
    riding: () => cables.state(cableId).riding } });
  books.install(book => {
    const body = need(host.players.get(book.player), 'seated body'), seat = entry.seat(book.player, rows.transitions);
    const ride = cables.seat(cableId, body, seat.flags);
    if (rider !== null && body.hasMotor) holdCarried(body, ride, seat.flags);
    const held = rows.ammunition === undefined ? null : need(ammunition ?? undefined, 'ammunition').of(body), own = { iron: false, rewardOwned: false }, skins = new Set<string>();
    const gear: SeatGear = { body, board: boardFor(), reward: rows.reward === undefined ? null : rewardFor(ride, undefined, seat.flags), ammunition: held, state: own, skins, seen: seat.flags,
      trader: traderFor(seat.pack, skin => skin === rows.trade?.finish && own.rewardOwned || skins.has(skin), skin => { skins.add(skin); }, held, launcher?.kind === 'bolt' ? seatedBolt(launcher.item, body) : null),
      riding: () => cables.seatState(cableId, book.player).riding,
      claim: value => {
        const claim = gear.board?.use(value, eye); if (claim === null || claim === undefined) return;
        commitSeatEffects(claim.reward.items.map(item => ({ kind: 'item', item: item.id, count: item.n })), seat.flags, seat.pack);
        if (claim.reward.bolts > 0 && launcher?.kind === 'bolt') seatedBolt(launcher.item, body).addBolts(claim.reward.bolts);
        if (claim.reward.skin === rows.board?.finish) own.rewardOwned = true;
      } };
    if (gear.reward !== null) host.scope.onDispose(() => { gear.reward?.dispose(); });
    const read = readingRoster(seat.flags, kind => {
      commitSeatEffects(need(steps ?? undefined, 'steps').signal({ kind: 'talk', target: kind }, { flags: seat.flags.all, inventory: seat.pack.snapshot().counts }), seat.flags, seat.pack);
      if (kind === rows.trade?.speaker) gear.trader?.open();
    });
    seats.set(book.player, { rules: seat.rules, transitions: seat.transitions, dialogue: read, roster: rows.prompts === undefined ? undefined : seatRoster?.([...seat.rules.values()], book.player), gear });
    book.part(`cable:${rows.step}`, { read: () => JSON.stringify(cables.snapshotSeat(cableId, book.player)), write: saved => { cables.restoreSeat(cableId, book.player, JSON.parse(saved)); } });
    book.part(`gear:${rows.step}`, { read: () => JSON.stringify({ ...own, skins: [...skins] }), write: saved => {
      const value = v.parse(SeatGearSaved, JSON.parse(saved)); own.iron = value.iron; own.rewardOwned = value.rewardOwned; skins.clear(); for (const skin of value.skins) skins.add(skin);
    } });
    if (gear.board !== null) book.part(`board:${rows.step}`, { read: () => JSON.stringify(gear.board?.snapshot() ?? null), write: saved => { gear.board?.prepareRestore(JSON.parse(saved))(); } });
    if (gear.trader !== null) book.part(`trader:${rows.step}`, { read: () => JSON.stringify(gear.trader?.snapshot() ?? null), write: saved => { gear.trader?.prepareRestore(JSON.parse(saved))(); } });
    if (gear.reward !== null) book.part(`reward:${rows.step}`, { read: () => JSON.stringify(gear.reward?.snapshot() ?? null), write: saved => { gear.reward?.restore(JSON.parse(saved)); } });
    if (held !== null) book.part(`ammo:${rows.step}`, { read: () => JSON.stringify(held.snapshot()), write: saved => { held.restoreSeat(v.parse(NativeAmmunitionSavedSchema, JSON.parse(saved))); } });
    book.part(`pack:${rows.step}`, { read: () => JSON.stringify(seat.pack.snapshot()), write: saved => { seat.pack.restore(JSON.parse(saved)); } });
    if (read !== null) book.part(`reading:${rows.step}`, { read: () => JSON.stringify(read.active ? read.snapshot() : null), write: saved => { read.prepareRestore(JSON.parse(saved))(); } });
  });
  const phases = new Map<string, (dt: number) => void>([
    ['commands', () => { graph.dispatch(input.scripts()); }], ['reading', dt => {
      for (const book of books.each()) { const body = host.players.get(book.player); if (body !== undefined) seatOf(book.player).dialogue?.advanceReading(dt, body.position); }
    }],
    ['props', dt => { const asked = input.walk(host.level.player.speed); walked.x = rider?.carried === true ? 0 : asked.x; walked.z = rider?.carried === true ? 0 : asked.z; props?.step(dt, walked); }],
    ['transitions', () => { for (const book of books.each()) seatOf(book.player).transitions.step(); props?.syncGates(); }], ['cable', dt => { cables.updateNative(cableId, dt, host); }],
    ['director', dt => { finale?.update(dt); }], ['reward', dt => {
      if (rows.reward !== undefined) for (const book of books.each()) { const { gear } = seatOf(book.player); gear.reward?.update(dt, gear.seen.has(rows.reward.seen)); }
    }],
    ['chapter', dt => { chapterClock?.update(dt, chapter?.current?.id, chapter?.def.id); }],
    ['lead', dt => { if (lead?.step(dt, chapter?.current?.id) === true && rows.lead !== undefined)
      commitQuestEffects(host, need(rows.effects, 'effects').pack, need(steps ?? undefined, 'steps').signal({ kind: 'follow', target: rows.lead.target }, { flags: flags.all })); }],
  ]);
  type SavedRole = NativeQuestCompositionRows['saved']['snapshot'][number];
  const parts = new Map<SavedRole, { capture: () => SimValue | undefined; prepare: (input: unknown) => () => void }>();
  const part = (id: SavedRole, capture: () => SimValue | undefined, prepare: (input: unknown) => () => void): void => { parts.set(id, { capture, prepare }); };
  part('counts', () => counterBook.snapshot(), value => { const saved = v.parse(countsSaved, value); return () => { counterBook.restore(rows.counts === 'declared' ? Object.fromEntries(ports.counters.feats.map(feat => [feat.id, saved[feat.id] ?? 0])) : saved); }; });
  part('pack', () => pack.snapshot(), value => { const saved = v.parse(nativeInventorySchema(entry.inventory), value === undefined && rows.saved.optional.includes('pack') ? { counts: {}, order: [] } : value); return () => { pack.restore(saved); }; });
  part('zipline', () => cables.snapshot(cableId), value => () => { cables.restore(cableId, value); });
  part('cable', () => cables.state(cableId).riding ? { s: cables.snapshot(cableId).s, v: cables.snapshot(cableId).v } : null,
    value => { const saved = v.parse(CableSaved, value); return () => { cables.restore(cableId, { riding: saved !== null, s: saved?.s ?? 0, v: saved?.v ?? 0 }); }; });
  if (props !== null && rows.props !== undefined) {
    const policy = rows.props;
    part('key', () => props.dropAt(policy.drop.id), value => { const saved = v.parse(v.nullable(v.strictObject(xyz)), value); return () => { props.restoreDrop(policy.drop.id, saved); }; });
    part('barrel', () => props.snapshot(policy.barrel.id), value => { const saved = v.parse(BarrelSaved, value); return () => { props.restore(policy.barrel.id, saved); }; });
  }
  if (finale !== null) part('finale', () => finale.snapshot(), value => { const saved = v.parse(v.string(), value); return () => { finale.restore(saved); }; });
  if (reward !== null) part('reward', () => reward.snapshot(), value => () => { reward.restore(value); });
  if (rows.acquisition !== undefined) part('iron', () => state.iron, value => { const saved = v.parse(v.boolean(), value); return () => { state.iron = saved; }; });
  if (rows.pickup !== undefined) part('pickup', () => state.pickup, value => { const saved = v.parse(v.boolean(), value); return () => { state.pickup = saved; }; });
  if (lead !== null) part('lead', lead.snapshot, lead.prepareRestore);
  if (chapterClock !== null) {
    part('clock', () => chapterClock.clock.snapshot(), value => { const saved = v.parse(v.pipe(v.string(), v.maxLength(1000000)), value); return () => { chapterClock.clock.restore(saved); }; });
    part('fast', () => chapterClock.fast.on === null ? null : { ...chapterClock.fast.on }, value => { const saved = v.parse(v.nullable(Fast), value); return () => { chapterClock.fast.on = saved; }; });
  }
  if (dialogue !== null) part('dialogue', () => dialogue.active ? dialogue.snapshot() : undefined, value => dialogue.prepareRestore(value ?? null));
  if (board !== null) {
    part('board', () => board.snapshot(), value => board.prepareRestore(value === undefined ? initialBoard : value));
    part('rewardOwned', () => state.rewardOwned ? true : undefined, value => { const saved = v.parse(v.optional(v.boolean(), false), value); return () => { state.rewardOwned = saved; }; });
  }
  if (trader !== null && rows.board !== undefined) {
    const ids = rows.board.ids;
    const schema = v.optional(v.strictObject({ modal: v.strictObject({ version: v.literal(1), open: v.boolean() }),
      skins: v.pipe(v.array(v.picklist(ids)), v.maxLength(ids.length), v.check(skins => new Set(skins).size === skins.length)) }));
    part('trader', () => trader.active || finishes.size > 0 ? { modal: trader.snapshot(), skins: [...finishes] } : undefined, value => {
      const saved = v.parse(schema, value), restore = trader.prepareRestore(saved?.modal ?? initialTrader);
      return () => { restore(); finishes = new Set([...skinSave.read(ports.source.identity.slug).owned.filter(id => ids.includes(id)), ...saved?.skins ?? []]); };
    });
  }
  if (ammunition !== null) part('ammunition', () => ammunition.changed ? ammunition.snapshot() : undefined,
    value => ammunition.prepareRestore(v.parse(v.optional(NativeAmmunitionSavedSchema), value)));
  const keys = new Set<string>(rows.saved.snapshot);
  if (rows.saved.snapshot.some(key => !parts.has(key))) throw new Error('Native saved role has no mechanic');
  host.onStep(rows.step, dt => { for (const phase of rows.phases) need(phases.get(phase), 'phase')(dt); }, {
    snapshot: () => entry.saved.encode(Object.fromEntries(rows.saved.snapshot.flatMap(key => {
      const value = need(parts.get(key), 'saved role').capture(); return value === undefined ? [] : [[key, value]];
    }))),
    restore: value => {
      const saved = entry.saved.decode(value);
      if (Object.keys(saved).some(key => !keys.has(key))) throw new Error('Unexpected native saved key');
      if (rows.saved.snapshot.some(key => !rows.saved.optional.includes(key) && !Object.hasOwn(saved, key))) throw new Error('Missing native saved key');
      const pending = new Map(rows.saved.snapshot.map(key => [key, need(parts.get(key), 'saved role').prepare(saved[key])]));
      if (rows.board !== undefined) {
        const finish = v.parse(v.object({ board: v.object({ claimed: v.number() }), open: v.boolean() }), saved['board'] === undefined ? initialBoard : saved['board']);
        const owned = v.parse(v.optional(v.boolean(), false), saved['rewardOwned']);
        if (owned !== (finish.board.claimed >= rows.board.claims) || finish.open && saved['dialogue'] !== undefined && saved['dialogue'] !== null) throw new RangeError('Invalid Story board/modal ownership');
        const modal = v.parse(v.optional(v.object({ modal: v.object({ open: v.boolean() }) })), saved['trader']);
        if (modal?.modal.open === true && (finish.open || saved['dialogue'] !== undefined && saved['dialogue'] !== null || saved['cable'] !== null)) throw new RangeError('Invalid Story trader/modal ownership');
      }
      for (const key of rows.saved.restore) need(pending.get(key), 'restore role')();
    }, ...(props === null ? {} : { physicsRestored: () => { props.physicsRestored(); } }),
  });
  if (promptRoster !== undefined) {
    const loans = promptLoans.get(host) ?? new Map<string, readonly HeadlessPrompt[]>();
    if (loans.has(rows.step)) throw new Error('Duplicate native quest prompt roster');
    loans.set(rows.step, promptRoster); promptLoans.set(host, loans);
    host.scope.onDispose(() => { loans.delete(rows.step); });
  }
  return { quests, pack, cables, lead: lead?.state ?? null, board, trader,
    riding: (): boolean => cables.state(cableId).riding || host.events.ask('player.carrying', false),
    talking: (): boolean => (dialogue?.active ?? false) || (board?.active ?? false) || (trader?.active ?? false),
    ownsFinish: (skin: string): boolean => finishes.has(skin) || skin === rows.board?.finish && state.rewardOwned,
    ownsBoardFinish: (): boolean => state.rewardOwned, takePickup: (): boolean => { const took = state.pickup; state.pickup = false; return took; } };
}

const LEAD_MODES = ['none', 'stare', 'trot', 'gone'] as const;
/** The guide's saved walk: the same {i, mode, t} bytes as Pine's questSaved envelope `lead` (nativeStory.ts LeadSaved). */
interface NativeLeadSaved { [field: string]: SimValue; i: number; mode: (typeof LEAD_MODES)[number]; t: number }
const LeadSaved: v.GenericSchema<unknown, NativeLeadSaved> = v.strictObject({ i: v.pipe(finite, v.integer(), v.minValue(0)), mode: v.picklist(LEAD_MODES), t: v.pipe(finite, v.minValue(0)) });

/**
 * The native composition's lead facet (G565 QC / QB): the guide's walk continuation. Its gate, its stare / trot / gone
 * walk and its event come from the shard's AS 'lead' signal (Pine's stag.as); this only carries the saved {i, mode, t}
 * and feeds the frame at the page quest frame's cadence: one decision every sixth fixed tick, elapsed accumulating on the
 * ticks between. `step` returns true only on the existing event 5 (the walk completed); the shared composition commits
 * the follow step's effects. No shard callbacks.
 */
function prepareNativeQuestLead(host: SimHost, rows: { readonly program: unknown; readonly path: readonly (readonly [number, number])[]; readonly step: string; readonly target: string }): {
  readonly state: { i: number; mode: (typeof LEAD_MODES)[number]; t: number };
  snapshot: () => NativeLeadSaved; prepareRestore: (input: unknown) => () => void; step: (dt: number, chapterId: string | undefined) => boolean;
} {
  const state: { i: number; mode: (typeof LEAD_MODES)[number]; t: number } = { i: 0, mode: 'none', t: 0 }, program = ReturnProgram.native(host, rows.program);
  const input = { i: 0, mode: 0, elapsed: 0, begin: 0, dt: 0, leadStep: 0, night: 0, playerX: 0, playerZ: 0, atX: 0, atZ: 0 };
  return { state, snapshot: () => ({ ...state }),
    prepareRestore: value => {
      const saved = v.parse(LeadSaved, value);
      if (saved.i >= rows.path.length) throw new RangeError('Invalid lead continuation');
      return () => { Object.assign(state, saved); };
    },
    step: (dt, chapterId) => {
      if (host.state.tick % 6 !== 0) { if (state.mode !== 'none') state.t += dt; return false; }
      // the guide waits on whoever is closest to its next bend
      const bend = rows.path[state.i];
      let player: { readonly x: number; readonly z: number } | undefined, best = Infinity;
      for (const body of host.players.values()) { const reach = Math.hypot(body.position.x - (bend?.[0] ?? 0), body.position.z - (bend?.[1] ?? 0)); if (reach < best) { best = reach; player = body.position; } }
      if (player === undefined) return false;
      Object.assign(input, { i: state.i, mode: LEAD_MODES.indexOf(state.mode), elapsed: state.t, dt, leadStep: Number(chapterId === rows.step),
        night: host.dayClock?.night ?? 0, playerX: player.x, playerZ: player.z, atX: bend?.[0] ?? 0, atZ: bend?.[1] ?? 0 });
      const answer = program.project('lead', input), i = answer['i'], mode = LEAD_MODES[answer['mode'] ?? -1], elapsed = answer['elapsed'];
      if (i === undefined || mode === undefined || elapsed === undefined) throw new Error('Stag projection omitted its continuation');
      state.i = i; state.mode = mode; state.t = elapsed;
      return answer['event'] === 5;
    } };
}

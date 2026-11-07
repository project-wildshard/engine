import * as v from 'valibot';
import type { Vector3 } from 'three';
import { bindInteractPlacements, createQuestPlacements, type InteractTable } from '@wildshard/engine/world/interact/types';
import { validateTable } from '@wildshard/engine/world/interact/validate';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { isJsonData } from '@wildshard/format/json';
import { parseQuestPageInteractions } from '@wildshard/format/questInteractions';
import type { Scope } from '@wildshard/engine/app/scope';
import type { QuestLine, QuestState } from '@wildshard/engine/quest/core';
import type {LiveMarker} from '@wildshard/engine/quest/view';
import {placesWithDiscovery,type Places} from '@wildshard/engine/quest/discovery';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { FullMap } from '@wildshard/engine/ui/Map';
import type { DialogueBox, ObjectiveLine } from '@wildshard/engine/quest/view/ui';
import { parseQuestStory, parseChapterStoryPresentation } from '@wildshard/format/questStory';
import { NpcDialogueRowSchema, bindQuestDeathEffects } from '../../../shared/game/plugin/quests';
import { chapterTalkFigures, completionMarkers, installInteractablesView, installQuestCableView, questBoardPage, questTalkFigures, questViews, type QuestCableView } from './chapterView';
import type { ContractBoardPage } from './contractBoardPage';
import type { ContractBoardPageRows } from '@wildshard/format/contracts';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { boundChapter, hasBoundChapter, publishBoundChapter, readQuestObservation, enteredAdventurePersistence } from '../../../shared/game/quest/chapterBindings';
import { commitQuestEffects, readQuestServiceActions } from '../../../shared/game/quest/effects';
import { QuestEffectSchema } from '@wildshard/format/questSteps';
import type { ShardContext } from '../plugin/context';
import type { FigureRows } from '../systems/npc/figureRows';
import type { CompletionProgress } from '../complete/declared';
import type { QuestPresentationHost, QuestPresentationOptions } from '../plugin/ui';
import { boundQuestServices, findBoundQuestState, installBoundQuestFlags } from '../../../shared/game/quest/boundState';
import { bindRuntimeQuest } from '../../../shared/game/quest/pageState';
import { bindStoryAchievements, bindStoryChapters, presentChapterStory, presentQuestStory, installStoryTalks } from './story';
import { questPageWorld } from '../../../shared/game/quest/pageResources';
import { questBenchPose } from '../../../shared/game/quest/storyLaw';
import type { QuestPageTalksRows } from '@wildshard/format/npcs';
import { QuestStepRunner } from '../../../shared/game/quest/steps';
import { chapterDecide } from '../../../shared/game/quest/chapterDecision';
import { openQuestTrader, installQuestTrader, parseQuestTrader, type QuestTrader } from './trader';
import type { Animal } from '@wildshard/engine/entities/AnimalView';

const finite = v.pipe(v.number(), v.finite());
const point = v.strictObject({ x: finite, y: finite, z: finite });
const discoverySchema = v.pipe(v.array(v.strictObject({ id: v.string(), label: v.string(), x: finite, z: finite,
  r: v.pipe(finite, v.minValue(0)), quiet: v.exactOptional(v.boolean()) })), v.maxLength(64));
const mapSchema = v.strictObject({ declutter: v.exactOptional(v.boolean()), tally: v.exactOptional(v.boolean()),
  unknownLabel: v.exactOptional(v.pipe(v.string(), v.maxLength(256))), markerLabels: v.optional(v.picklist(['full', 'short']), 'short') });
const schema = v.strictObject({
  placements: v.exactOptional(v.record(v.string(), point)),
  completion: v.exactOptional(v.boolean()),
  remainingLabel: v.exactOptional(v.string()),
  program: v.exactOptional(v.unknown()),
  content: v.exactOptional(v.object({ npcs: v.record(v.string(), NpcDialogueRowSchema), places: discoverySchema })),
});
/** Existing entered services; callers cannot inject story policy or owner paths. */
export interface QuestChapterContext extends Pick<ShardContext, 'app' | 'scope' | 'product'> {
  readonly game: { readonly runtime?: {
    readonly world: { readonly player: QuestPresentationHost['player'] } | null;
    readonly play: { readonly progress?: CompletionProgress; readonly fullMap: Pick<FullMap, 'setQuest'>;
      readonly hud: { toast: (text: string) => void }; readonly music: { sting: (name: 'chunk') => void } } | null;
  } };
}
/** A client-only view over a quest already bound by its existing progression owner. */
export interface QuestChapter {
  readonly quest: QuestState;
  readonly line: QuestLine | null;
  readonly project: (signal: string, input: Readonly<Record<string, number>>) => Readonly<Record<string, number>>;
  readonly reading: (input: unknown) => void;
  readonly dialogueBox: () => DialogueBox;
  readonly talk: (id: string) => void;
  readonly update: (dt: number, player: Vector3) => void;
  readonly installFeats: () => void;
  readonly objective: ObjectiveLine;
  readonly places: Places | null;
  readonly discover: (rows: unknown) => Places;
  /** Publish this chapter's live discovery and marker owners to the entered full map. */
  readonly publishMap: (rows: unknown) => void;
  readonly chip: ReturnType<typeof presentQuestStory>['chip'];
  readonly markers: () => LiveMarker[];
}
/** Framework lookup of the installed chapter, sharing its original objective owner. */
export function boundQuestChapter(scope: Scope, id: string): QuestChapter {
  return boundChapter(scope, id);
}
/** Bind the existing saved flag book by declared quest id and its original level key. */
export function installQuestFlags(ctx: Pick<QuestChapterContext, 'scope' | 'product'>, id: string, level: string): Flags {
  if (!ctx.product.shardfile.quests.quests.some(row => row.id === id)) throw new Error('Quest flags require a declared quest');
  return installBoundQuestFlags(ctx.scope, id, level);
}

const entryId = v.pipe(v.string(), v.minLength(1), v.maxLength(256));
const entryPlacement = v.strictObject({ world: v.exactOptional(entryId),
  frames: v.exactOptional(v.pipe(v.record(entryId, v.strictObject({ x: finite, z: finite, rot: finite })), v.maxEntries(4096))),
  platforms: v.exactOptional(v.boolean()), registryReach: v.exactOptional(v.pipe(finite, v.minValue(Number.MIN_VALUE))) });
const entrySystem = v.strictObject({ id: entryId, before: v.pipe(v.array(entryId), v.maxLength(64)),
  after: v.optional(v.pipe(v.array(entryId), v.maxLength(64)), []) });
const entryDeaths = v.strictObject({ effects: v.unknown(), order: v.pipe(finite, v.integer()),
  moves: v.optional(v.pipe(v.array(v.strictObject({ effect: entryId, target: entryId })), v.maxLength(64)), []) });
const cableSound = v.strictObject({ at: v.union([entryId, point]), sound: v.picklist(['lever', 'plate']) });
const entryCable = v.strictObject({ mode: entryId, carriage: entryId,
  scene: v.strictObject({ kind: v.picklist(['placement', 'object']), id: entryId }),
  prompt: v.union([entryId, point]), radius: v.pipe(finite, v.minValue(Number.MIN_VALUE)), label: entryId,
  camera: v.optional(v.boolean(), false),
  feedback: v.exactOptional(v.strictObject({ weapons: v.picklist(['visible', 'enabled']),
    start: cableSound, end: cableSound, arrival: v.exactOptional(entryId),
    shot: v.exactOptional(v.strictObject({ audio: entryId, family: entryId, at: v.union([entryId, point]) })) })) });
const entryTrader = v.strictObject({ rows: v.unknown(), resources: v.exactOptional(v.strictObject({
  figure: entryId, counter: entryId, offer: entryId, label: entryId,
  radius: v.pipe(finite, v.minValue(0), v.maxValue(100)), before: v.pipe(v.array(entryId), v.maxLength(64)), page: v.exactOptional(v.unknown()),
})) });
/** Prepared services retain the entered story's original state owners. */
export interface QuestEntry extends ReturnType<typeof createQuestPlacements> {
  readonly story: ReturnType<typeof parseQuestStory>; readonly flags: Flags;
  readonly services: Awaited<ReturnType<typeof readQuestServiceActions>>;
  interact: (interactions: Parameters<typeof installQuestInteractables>[2], system: unknown) => Promise<Awaited<ReturnType<typeof installQuestInteractables>>>;
  chapter: (input?: unknown) => QuestChapter;
  achievements: () => ReturnType<typeof bindStoryAchievements>;
  observe: () => void;
  bench: () => void;
  talks: (input: QuestPageTalksRows) => Promise<ReturnType<typeof installStoryTalks<FigureRows>>>;
  deaths: (input: unknown) => void;
  cable: (input: unknown) => Promise<QuestCableView>;
  trader: (input: unknown) => QuestTrader;
  board: (input: ContractBoardPageRows) => ContractBoardPage;
}
/** Client-only quest entry shared by declared stories. Prepare saved flags,
 * service actions and placement first; install interactables after the caller
 * binds progression. Both stages take data and preserve the original owners. */
export async function prepareQuestEntry(ctx: ShardContext, input: unknown): Promise<QuestEntry> {
  if (!isJsonData(input)) throw new Error('Quest entry requires plain JSON rows');
  const rows = v.parse(v.strictObject({ story: entryId, services: entryId, placement: entryPlacement }), input);
  const world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('Quest entry requires its entered world');
  const story = parseQuestStory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await ctx.product.file(rows.story))));
  if (ctx.scope.disposed) throw new Error('Quest entry left during story admission');
  const policy = rows.placement;
  const placement = createQuestPlacements({ terrain: terrainHeight, registry: world.registry,
    ...(policy.world === undefined ? {} : { pois: questPageWorld(ctx.scope, policy.world).pois }),
    ...(policy.frames === undefined ? {} : { frames: policy.frames }),
    ...(policy.platforms === true ? { platforms: world.player.platforms } : {}),
    ...(policy.registryReach === undefined ? {} : { registryReach: policy.registryReach }) });
  const flags = installQuestFlags(ctx, story.quest.id, ctx.manifest.slug);
  const services = await readQuestServiceActions(ctx, story.quest.id, rows.services);
  let achievements: Awaited<ReturnType<typeof bindStoryAchievements>> | null = null;
  let achievementRequest: ReturnType<typeof bindStoryAchievements> | null = null;
  let interaction: Awaited<ReturnType<typeof installQuestInteractables>> | null = null;
  let installed = false, talksInstalled = false, boardInstalled = false;
  return { story, flags, services, ...placement,
    board: boardInput => {
      if (boardInstalled || interaction === null || achievements === null || ctx.scope.disposed) throw new Error('Quest board requires its live table and achievement owners');
      const board = questBoardPage(ctx, boardInput, interaction.sfx);
      boardInstalled = true; return board;
    },
    trader: traderInput => {
      if (ctx.scope.disposed || !isJsonData(traderInput)) throw new Error('Quest trader requires live JSON rows');
      const trader = v.parse(entryTrader, traderInput), resources = trader.resources;
      if (resources === undefined) return installQuestTrader(ctx, trader.rows);
      const site = parseQuestTrader(trader.rows).placement;
      if (site === undefined) throw new Error('Quest trader resources require a declared placement');
      const feet = placement.place(site.feet), x = feet.x + Math.sin(feet.yaw) * site.tradeAhead, z = feet.z + Math.cos(feet.yaw) * site.tradeAhead;
      return installQuestTrader(ctx, trader.rows, { figure: resources.figure, counter: resources.counter, offer: resources.offer,
        at: { x, y: placement.floorAt(x, z) + site.tradeHeight, z }, prompt: { label: resources.label, radius: resources.radius }, before: resources.before,
        ...(resources.page === undefined ? {} : { page: parseQuestPageInteractions(resources.page) }) });
    },
    cable: async cableInput => {
      if (!isJsonData(cableInput)) throw new Error('Quest cable requires JSON rows');
      const view = await installQuestCableView(ctx, v.parse(entryCable, cableInput), world);
      return view;
    },
    deaths: deathInput => {
      if (!isJsonData(deathInput)) throw new Error('Quest deaths require JSON rows');
      const deathRows = v.parse(entryDeaths, deathInput), play = ctx.game.runtime?.play, counters = achievements, kit = interaction;
      if (ctx.scope.disposed || play === undefined || play === null || counters === null) throw new Error('Quest deaths require their entered achievement owners');
      if (deathRows.moves.length > 0 && kit === null) throw new Error('Quest death moves require their entered table');
      const killed = bindQuestDeathEffects<Animal>(deathRows.effects, { flags, kill: counters.kill, event: counters.event,
        toast: text => { play.hud.toast(text); }, calls: new Map(deathRows.moves.map(row => [row.effect, (body: Animal) => {
          kit?.moveTo(row.target, body.position.x, body.position.z);
        }])) });
      ctx.on('actor.died', ({ actor }) => {
        const body = play.animals.animals.find(animal => animal.combatActor() === actor);
        if (body !== undefined) killed(body);
      }, { order: deathRows.order });
    },
    talks: async talkInput => {
      if (!isJsonData(talkInput)) throw new Error('Quest talks require JSON rows');
      const talkRows = talkInput, runtime = ctx.game.runtime, play = runtime?.play;
      if (new Set(talkRows.models.map(row => row.id)).size !== talkRows.models.length) throw new Error('Duplicate quest talk model');
      if (runtime === undefined || play === undefined || play === null) throw new Error('Quest talks require their entered play owners');
      const requireLive = (): void => { if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Quest talks left during model admission'); };
      requireLive();
      if (talksInstalled) throw new Error('Quest talks already installed');
      talksInstalled = true;
      const { figures, immediate } = await questTalkFigures(ctx, talkRows, world, runtime, play, requireLive);
      const steps = Object.values(talkRows.calls).some(call => call.kind === 'talk') ? new QuestStepRunner(talkRows.steps) : null;
      const calls = new Map(Object.entries(talkRows.calls).map(([id, row]) => [id, () => {
        if (row.kind === 'trader') { openQuestTrader(ctx.scope, row.trader); return; }
        if (steps === null) throw new Error('Quest talk lacks its admitted step runner');
        const paid = row.after === undefined ? false : flags.has(row.after.flag);
        commitQuestEffects(ctx, story.quest.id, steps.signal({ kind: 'talk', target: row.target }, { flags: flags.all,
          inventory: Object.fromEntries(play.inventory.items.map(item => [item.id, item.count])) }));
        if (row.after !== undefined && !paid && flags.has(row.after.flag)) services.run(row.after.service);
      }]));
      const talks = installStoryTalks(questViews(ctx), ctx.product.shardfile, { flags, scene: world.game.scene, registry: world.registry,
        prompts: runtime.interactables, groundAt: placement.floorAt, figures, calls });
      await Promise.all(immediate); requireLive(); return talks;
    },
    bench: (): void => {
      const kit = interaction, play = ctx.game.runtime?.play;
      if (kit === null || play === undefined || play === null || ctx.scope.disposed) throw new Error('Quest seat requires its entered interaction table');
      kit.onSit = (at, yaw) => {
        const pose = questBenchPose(story.bench, at, yaw, placement.floorAt), player = world.player;
        player.position.set(pose.x, pose.y, pose.z); player.velocity.set(0, 0, 0); player.yaw = pose.yaw; player.pitch = pose.pitch;
        play.hud.toast(story.bench.text);
      };
    },
    achievements: (): ReturnType<typeof bindStoryAchievements> => {
      achievementRequest ??= bindStoryAchievements(ctx, story, ctx.game.runtime?.play?.progress, ctx.manifest.slug)
        .then(service => { achievements = service; return service; });
      return achievementRequest;
    },
    observe: (): void => {
      const counters = achievements, play = ctx.game.runtime?.play;
      if (counters === null || play === undefined || play === null || ctx.scope.disposed) throw new Error('Quest flag observation requires its entered achievements');
      counters.syncFlags(flags);
      ctx.scope.onDispose(flags.onChange((flag, on) => {
        if (!on || story.ignoredFlagPrefixes.some(prefix => flag.startsWith(prefix))) return;
        counters.syncFlags(flags);
        for (const row of story.notices) if (flag.startsWith(row.prefix) && flags.count(row.prefix) === row.total) play.hud.toast(row.text);
      }));
    },
    chapter: (chapterInput: unknown = {}): QuestChapter => {
      if (ctx.scope.disposed) throw new Error('Quest entry left before chapter installation');
      return buildQuestChapter(ctx, story, chapterInput, placement.anchors);
    },
    interact: async (interactions: Parameters<typeof installQuestInteractables>[2], system: unknown): Promise<Awaited<ReturnType<typeof installQuestInteractables>>> => {
      const order = v.parse(entrySystem, system);
      if (installed || ctx.scope.disposed) throw new Error('Quest entry interactables already installed or disposed');
      installed = true;
      const kit = await installQuestInteractables(ctx, story.quest.id, interactions);
      interaction = kit;
      ctx.system({ id: order.id, phase: 'update', before: order.before, after: order.after, run: (dt, time) => { kit.update(dt, time); } });
      return kit;
    } };
}

/** Build the shared chapter presentation directly over its concrete entered owner.
 * Story/content rows and the original optional marker anchors retain their API. */
export function buildQuestChapter(ctx: ShardContext, storyInput: unknown, input: unknown = {},
  anchors?: ReadonlyMap<string, { readonly x: number; readonly z: number }>): QuestChapter {
  if (!isJsonData(input)) throw new Error('Chapter intake requires plain JSON data');
  const rows = v.parse(schema, input);
  const completeStory = typeof storyInput === 'object' && storyInput !== null && 'quest' in storyInput ? parseQuestStory(storyInput) : null;
  const chapterRows = completeStory?.chapters ?? (completeStory === null ? parseChapterStoryPresentation(storyInput) : undefined);
  const id = completeStory?.quest.id ?? chapterRows?.chapters[0];
  if (id === undefined) throw new Error('Chapter requires a declared quest');
  const story = completeStory ?? { quest: { id, markers: {} }, chapters: chapterRows };
  const persistence = completeStory === null ? enteredAdventurePersistence(ctx.scope) : null;
  const existing = findBoundQuestState(ctx.scope, story.quest.id);
  if (hasBoundChapter(ctx.scope, story.quest.id)) throw new Error('Chapter presentation is already installed');
  const services = persistence === null ? existing === undefined ? boundQuestServices(ctx.scope, story.quest.id) : { flags: existing.flags } : { flags: persistence.flags, facts: persistence.facts };
  const ports: Parameters<typeof bindRuntimeQuest>[3] = { ...services, ...(completeStory === null ? {} : { place: (marker: { id: string }) => completeStory.quest.markers[marker.id] }) };
  const line = story.chapters === undefined ? null
    : bindStoryChapters(ctx, ctx.product.shardfile, story.chapters.chapters, ports, completeStory === null ? 'before-facts' : 'after-facts');
  const quest = existing ?? line?.chapters[0] ?? bindRuntimeQuest(ctx, ctx.product.shardfile, story.quest.id, ports).state;
  const world = ctx.game.runtime?.world, play = ctx.game.runtime?.play;
  if (world === undefined || world === null || play === undefined || play === null) throw new Error('Quest chapter requires its entered play services');
  if (rows.placements !== undefined) {
    const markers = [...quest.def.intro?.markers ?? [], ...quest.def.steps.flatMap(step => step.markers ?? [])];
    if (markers.some(marker => rows.placements?.[JSON.stringify(marker.at)] === undefined)) throw new Error('Quest chapter lacks an admitted marker placement');
  }
  const complete = rows.completion === true ? ctx.product.section('ui/completion') : null;
  const left = (): LiveMarker[] | null => complete === null || !quest.isComplete ? null
    : completionMarkers(complete, quest.flags, play.progress, anchors);
  const markers = (): LiveMarker[] => quest.markers().map(marker => {
    const at = rows.placements?.[JSON.stringify(marker.at)] ?? marker.at;
    return { id: marker.id, label: marker.label, short: marker.short ?? marker.label, x: at.x, z: at.z };
  });
  const toast = (text: string): void => { play.hud.toast(text); }, sting = (): void => { play.music.sting('chunk'); };
  const fullMap = completeStory === null ? play.fullMap : { setQuest: play.fullMap.setQuest.bind(play.fullMap) };
  const options: Pick<QuestPresentationOptions, 'markers' | 'chip' | 'placements'> = { markers: () => left() ?? markers(), chip: () => { const remaining = left(); return remaining === null ? quest.chip()
      : { label: remaining.length > 0 ? rows.remainingLabel ?? '' : '', count: '' }; },
    ...(rows.placements === undefined ? {} : { placements: rows.placements }),
  };
  const presentation = line === null || story.chapters === undefined
    ? presentQuestStory(parseQuestStory(story), { scope: ctx.scope, player: world.player, fullMap, toast, sting }, quest, options)
    : presentChapterStory(line, story.chapters, { ...(completeStory === null ? { ctx } : {}), scope: ctx.scope, flags: quest.flags,
      figures: chapterTalkFigures(ctx.scope, story.chapters.talks), npcs: rows.content?.npcs ?? {}, places: rows.content?.places ?? [], prompts: ctx.game.runtime?.interactables ?? [],
      open: () => { ctx.game.runtime?.play?.audio.weaponSwap(); },
      ...(persistence === null ? {} : { feat: persistence.feat }), fullMap, toast, sting, ...(completeStory === null ? {} : options) });
  let places: Places | null = completeStory === null && 'places' in presentation ? presentation.places : null;
  let mapPublished = false;
  const publishMap = (mapInput: unknown): void => {
    if (!isJsonData(mapInput)) throw new Error('Quest map requires JSON rows');
    const policy = v.parse(mapSchema, mapInput), map = ctx.game.runtime?.play?.fullMap, points = places;
    if (ctx.scope.disposed || map === undefined || points === null) throw new Error('Quest map requires its entered discovery owner');
    if (mapPublished) throw new Error('Quest map already published');
    map.setPois(() => {
      const pins = points.mapPois();
      if (policy.unknownLabel === undefined && policy.markerLabels === 'short') return pins;
      return pins.map(pin => {
        const projected = { x: pin.x, z: pin.z, kind: pin.kind,
          label: pin.kind === 'unknown' ? policy.unknownLabel ?? pin.label : pin.label };
        return policy.markerLabels === 'short' && pin.short !== undefined ? Object.assign(projected, { short: pin.short }) : projected;
      });
    }, { ...(policy.declutter === undefined ? {} : { declutter: policy.declutter }), ...(policy.tally === undefined ? {} : { tally: policy.tally }) });
    mapPublished = true;
  };
  const discover = (catalogue: unknown): Places => {
    if (places !== null) throw new Error('Quest discovery is already installed');
    places = placesWithDiscovery(v.parse(discoverySchema, catalogue), quest.flags, text => { play.hud.toast(text); }, markers);
    return places;
  };
  ctx.scope.onDispose(() => { presentation.chip.line.root.remove(); });
  const decision = chapterRows?.decision;
  const program = rows.program ?? decision?.program;
  const brain = program === undefined ? null : ReturnProgram.page(program, ctx.scope);
  // the observe -> project -> commit order is chapterDecide's (renderer-free, CI12)
  const project = (signal: string, values: Readonly<Record<string, number>>): Readonly<Record<string, number>> => {
    if (brain === null) throw new Error('Chapter has no admitted decision program');
    return chapterDecide(brain, decision, signal, values, source => readQuestObservation(ctx, quest.def.id, source), effects => { commitQuestEffects(ctx, quest.def.id, effects); });
  };
  const chapter: QuestChapter = { quest, line, project, reading: readingInput => {
    const row = v.parse(QuestEffectSchema, readingInput);
    if (row.kind !== 'reading' || !('dialogue' in presentation)) throw new Error('Chapter reading requires its dialogue');
    const dialogue = presentation.dialogue();
    if (!dialogue.isOpen) dialogue.open(row.title, row.lines, () => undefined);
  }, dialogueBox: () => {
    if (!('dialogue' in presentation)) throw new Error('Chapter has no dialogue');
    return presentation.dialogue();
  }, talk: personId => { if ('talk' in presentation) presentation.talk(personId); },
    update: (dt, player) => { if ('dialogue' in presentation) presentation.update(dt, player); },
    installFeats: () => { if ('installFeats' in presentation) presentation.installFeats(); }, chip: presentation.chip, objective: presentation.chip.line, get places() { return places; }, discover, publishMap, markers: completeStory === null && 'markers' in presentation ? presentation.markers : markers };
  publishBoundChapter(ctx.scope, story.quest.id, chapter);
  return chapter;
}

/** Client-only interactable presentation over entered services and saved quest flags.
 * Intake contains only bounded table/placement rows and floor policy. The caller
 * retains its update phase and event wiring; this owns no clock or save wire.
 */
export async function installQuestInteractables(ctx: ShardContext, id: string,
  input: { readonly table: InteractTable; readonly placements?: unknown; readonly platforms?: boolean; readonly registryReach?: number }): ReturnType<typeof installInteractablesView> {
  if (!isJsonData(input)) throw new Error('Quest interactables require plain JSON data');
  v.parse(v.strictObject({ table: v.unknown(), placements: v.exactOptional(v.unknown()),
    platforms: v.exactOptional(v.boolean()), registryReach: v.exactOptional(v.pipe(finite, v.minValue(Number.MIN_VALUE))) }), input);
  const table = input.placements === undefined ? input.table : bindInteractPlacements(input.table, input.placements);
  const errors = validateTable(table);
  if (errors.length > 0) throw new Error(`Invalid quest interactables: ${errors.join('; ')}`);
  if (table.rows.some(row => row.at.poi !== 'world')) throw new Error('Quest interactables require world placements');
  const runtime = ctx.game.runtime, world = runtime?.world;
  if (runtime === undefined || world === undefined || world === null) throw new Error('Quest interactables require entered world services');
  const flags = installQuestFlags(ctx, id, ctx.manifest.slug);
  const { floorAt, place } = createQuestPlacements({ terrain: terrainHeight, registry: world.registry,
    ...(input.platforms === true ? { platforms: world.player.platforms } : {}),
    ...(input.registryReach === undefined ? {} : { registryReach: input.registryReach }) });
  const kit = await installInteractablesView(ctx, table, flags, world, runtime, { floorAt, place });
  return kit;
}

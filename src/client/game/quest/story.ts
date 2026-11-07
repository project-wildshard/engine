import { findBoundQuestState, publishQuestFacts } from '../../../shared/game/quest/boundState';
import * as v from 'valibot';
import type { Vector3 } from 'three';
import { parseChapterStoryPresentation, type ChapterStoryPresentation, type QuestStory } from '@wildshard/format/questStory';
import type { AchievementCounterData } from '@wildshard/format/achievementCounters';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { Scope } from '@wildshard/engine/app/scope';
import { DialogueBox, RewardCaption } from '@wildshard/engine/quest/view/ui';
import { QuestChip, NpcTalk, type LiveMarker } from '@wildshard/engine/quest/view';
import {placesWithDiscovery,type PlacePoint,type Places} from '@wildshard/engine/quest/discovery';
import type { MapPoi, MapQuest } from '@wildshard/engine/ui/Map';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { QuestLine, questMessageHandlers, type QuestState, type NpcDef } from '@wildshard/engine/quest/core';
import type { Progress } from '../Progress';
import { progressSave } from '../../../shared/game/saves';
import { createAchievementCounters } from '../../../shared/game/achievements';
import { bindRuntimeQuest } from '../../../shared/game/quest/pageState';
import { bindRuntimeLedger, bindRuntimeJsonRecord, type RuntimeFacts } from '../../../shared/game/plugin/runtimeRows';
import { chapterFlow } from '../../../shared/game/quest/chapterFlow';
import type { ShardContext } from '../plugin/context';
import { QuestViews, installDeclaredNpcTalks, type QuestNpcTalkPorts, type QuestTalkFigure, type NpcTalkInstallation, presentQuest, type QuestPresentation, type QuestPresentationHost, type QuestPresentationOptions } from '../plugin/ui';

/** Bind an ordered chapter view over the original runtime quest states and fact owner.
 * Single-chapter stories use the same binding; no extra state or listener is installed. */
export function bindStoryChapters(ctx: Parameters<typeof bindRuntimeQuest>[0], source: Shardfile,
  ids: readonly string[], ports: Parameters<typeof bindRuntimeQuest>[3], order: 'before-facts' | 'after-facts' = 'before-facts'): QuestLine {
  if (ids.length === 0 || ids.length > 64 || new Set(ids).size !== ids.length || ids.some(id => !source.quests.quests.some(q => q.id === id))) throw new Error('Invalid story chapters');
  const line = new QuestLine([], ports.flags);
  for (const id of ids) {
    const quest = findBoundQuestState(ctx.scope, id) ?? bindRuntimeQuest(ctx, source, id, ports).state;
    const step: NonNullable<QuestState['onStep']> = (next, previous) => { line.onStep?.(quest, next, previous); };
    const complete = (): void => { line.onComplete?.(quest); };
    if (order === 'after-facts') ctx.scope.onDispose(quest.observe({ step, complete }));
    else { quest.onStep = step; quest.onComplete = complete; }
    line.chapters.push(quest);
  }
  return line;
}

/** Existing world figures and update order remain caller-owned. */
export interface ChapterStoryPorts {
  readonly ctx?: ShardContext;
  readonly scope: Scope;
  readonly flags: Flags;
  readonly figures: Readonly<Record<string, { readonly headWorld: Vector3; talking: boolean }>>;
  readonly npcs: Readonly<Record<string, NpcDef>>;
  readonly places: PlacePoint[];
  readonly prompts: Interactable[];
  readonly toast: (text: string) => void;
  readonly sting: () => void;
  readonly open: () => void;
  readonly feat?: (event: string, count: number) => void;
  readonly placements?: QuestPresentationOptions['placements'];
  readonly chip?: QuestPresentationOptions['chip'];
  readonly markers?: QuestPresentationOptions['markers'];
  readonly fullMap?: { setQuest?: (source: () => MapQuest | null) => void; setPois?: (source: () => MapPoi[], options?: { declutter?: boolean }) => void };
}
/** Present a chapter line through the existing chip, talks, discovery and retained-view host.
 * No update system, save owner, completion payout or quest state is created here. */
export function presentChapterStory(line: QuestLine, input: ChapterStoryPresentation, ports: ChapterStoryPorts): {
  chip: QuestChip; places: Places; markers: () => LiveMarker[]; dialogue: () => DialogueBox;
  talk: (id: string) => void; update: (dt: number, player: Vector3) => void; installFeats: () => void;
} {
  const rows = parseChapterStoryPresentation(input), { flags, scope } = ports;
  const captioned = new Set(Object.values(rows.rewards).map(row => row.event));
  if (line.chapters.map(q => q.def.id).join('\0') !== rows.chapters.join('\0')) throw new Error('Chapter presentation differs from its bound line');
  for (const row of rows.talks) if (ports.figures[row.id] === undefined || ports.npcs[row.id] === undefined) throw new Error(`Missing chapter speaker ${row.id}`);
  ports.ctx?.answer('feat.toast', value => ({ ...value, allowed: value.allowed && (value.event === undefined || !captioned.has(value.event)) }));
  const markers = (): LiveMarker[] => (line.active?.markers() ?? (rows.messages === undefined ? [] : line.chapters[0]?.markers()) ?? []).map(m => {
    const at = ports.placements === undefined ? m.at : ports.placements[JSON.stringify(m.at)];
    if (at === undefined) throw new Error('Chapter marker lacks an admitted frame placement');
    return { id: m.id, label: m.label, short: m.short ?? m.label, x: at.x, z: at.z };
  });
  const flow = chapterFlow(line, rows);
  const chip = new QuestChip({ markers: ports.markers ?? markers, chip: ports.chip ?? flow.chip });
  const views = ports.ctx === undefined ? undefined : new QuestViews(ports.ctx);
  views?.retainRoot(chip.line.root, () => { chip.line.hide(false); });
  const dialogueView = rows.talks.length === 0 ? undefined : views?.view('dialogue', entered => new DialogueBox(entered)) ?? (() => {
    const box = new DialogueBox(scope); return () => box;
  })();
  const dialogue = (): DialogueBox => { if (dialogueView === undefined) throw new Error('Story has no dialogue'); return dialogueView(); };
  const talks = rows.talks.map(row => {
    const npc = ports.npcs[row.id], speaker = ports.figures[row.id];
    if (npc === undefined || speaker === undefined) throw new Error('Missing chapter speaker');
    const talk = new NpcTalk({ get dialogue() { return dialogue(); }, flags, npc, at: speaker.headWorld,
      speaker, radius: row.radius, label: row.label, onOpen: ports.open });
    ports.prompts.push(talk.prompt); return { id: row.id, talk };
  });
  const messages = new Map(line.chapters.map(q => [q, rows.messages === undefined ? undefined : questMessageHandlers(q, rows.messages, ports)]));
  line.onStep = (q, step, previous) => {
    const notice = messages.get(q); if (notice !== undefined) { notice.step(step, previous); return; }
    const toast = flow.stepToast(q, step, previous); if (toast === null) return; ports.toast(toast); ports.sting();
  };
  scope.onDispose(() => { chip.line.scope.dispose(); chip.line.root.remove(); });
  const captions = new Map<string, RewardCaption>();
  line.onComplete = q => {
    const notice = messages.get(q); if (notice !== undefined) { notice.complete(); return; }
    ports.sting(); let caption = captions.get(q.def.id);
    if (caption === undefined) {
      const texts = flow.reward(q); caption = new RewardCaption(texts.kicker, texts.title, texts.subtitle);
      captions.set(q.def.id, caption); const created = caption;
      scope.onDispose(() => { created.root.remove(); }); views?.retainRoot(created.root, () => { created.show(false); });
    }
    const shown = caption; shown.show(true); chip.line.hide(true);
    const hide = (): void => { shown.show(false); chip.line.hide(false); };
    if (views === undefined) scope.timeout(rows.rewardMs, hide); else views.timeout(rows.rewardMs, hide);
  };
  ports.fullMap?.setQuest?.(flow.mapQuest);
  const places = placesWithDiscovery(ports.places, flags, ports.toast, markers);
  if (ports.places.length > 0) ports.fullMap?.setPois?.(places.mapPois, { declutter: true });
  const feats = (): void => { for (const [event, count] of flow.feats(flags)) ports.feat?.(event, count); };
  // Installed explicitly after world polling by the adventure, preserving its original event order.
  return { chip, places, markers, dialogue, talk: id => { talks.find(row => row.id === id)?.talk.talk(); },
    update: (dt, player) => { dialogueView?.().update(dt); for (const row of talks) row.talk.update(player); },
    installFeats: () => { feats(); scope.onDispose(flags.onChange((_flag, on) => { if (on) feats(); })); } };
}

const countsSchema = v.record(v.string(), v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0)));
type StoryContext = Pick<ShardContext, 'app' | 'scope' | 'product'>;
type JournalProgress = Partial<Pick<Progress, 'bindLedger' | 'refreshLedger'>> & { readonly rows?: readonly { readonly def: { readonly id: string }; readonly count: number }[] };
/** The existing journal and ledger keep their saves; rows select the original migration and refresh boundaries. */
export async function bindStoryAchievements(ctx: StoryContext, story: QuestStory, progress: JournalProgress | undefined,
  instance: string = ctx.product.shardfile.identity.slug): Promise<{ facts: RuntimeFacts; count: (id: string, total: number) => void; kill: (kind: string, variant?: string) => void; event: (name: string, total?: number) => void; syncFlags: (flags: Parameters<ReturnType<typeof createAchievementCounters>['syncFlags']>[0]) => void }> {
  const rows = await ctx.product.json<AchievementCounterData>('quests/achievements.json');
  if (ctx.scope.disposed) throw new Error('Quest achievement owner left during admission');
  const source = ctx.product.shardfile, policy = story.journal, emit = bindRuntimeLedger(ctx, source, instance);
  const facts: RuntimeFacts = Object.assign((name: string, entity: string) => {
    const receipt = emit(name, entity); if (policy.refresh === 'emit') progress?.refreshLedger?.(); return receipt;
  }, { flush: emit.flush, achievement: emit.achievement });
  let counts: Record<string, number> = Object.fromEntries(rows.feats.map(feat => [feat.id, emit.achievement(feat.id)?.count ?? 0]));
  const saved = policy.state === undefined ? null : bindRuntimeJsonRecord(ctx, source, policy.state, countsSchema, () => progressSave.read(instance).counts, instance);
  const counters = createAchievementCounters(rows, {
    read: () => saved === null ? { ...counts } : saved.read(),
    write: current => { if (saved === null) counts = current; else saved.write(current); }, emit: (name, entity) => { facts(name, entity); },
  });
  if (policy.replay) counters.replay();
  if (policy.migrateProgress) for (const row of progress?.rows ?? []) if (rows.feats.some(feat => feat.id === row.def.id)) counters.count(row.def.id, row.count);
  const achievement = (id: string) => emit.achievement(policy.achievementPrefix + id);
  progress?.bindLedger?.({ count: id => achievement(id)?.count ?? 0, earned: id => achievement(id)?.earned ?? false,
    checkpoint: () => { if (saved === null) return emit.flush(); const written = saved.write(saved.read()), grants = emit.flush(); return written && grants; } });
  const refresh = (): void => { if (policy.refresh === 'outcome') progress?.refreshLedger?.(); };
  const event = (name: string, total?: number): void => { counters.event(name, total); refresh(); };
  publishQuestFacts(ctx.scope, story.quest.id, facts);
  return { facts, count: counters.count, kill: (kind: string, variant?: string): void => { counters.kill(kind, variant); refresh(); }, event,
    syncFlags: (flags: Parameters<typeof counters.syncFlags>[0]): void => { counters.syncFlags(flags, policy.syncEvents ? event : undefined); } };
}
/** Data-backed presentation over the original quest; the caller retains its existing update phase. */
export function presentQuestStory(story: QuestStory, host: QuestPresentationHost, quest: QuestState, options: QuestPresentationOptions = {}): QuestPresentation {
  return presentQuest(host, quest, { ...story.presentation, ...options });
}

/** Borrow the existing figure factories; dialogue and talks advance only when their original caller steps them. */
export function installStoryTalks<F extends QuestTalkFigure>(views: QuestViews, source: Pick<Shardfile, 'questNpcs'>,
  ports: Omit<QuestNpcTalkPorts<F>, 'dialogue'>): { dialogue: () => DialogueBox; people: (NpcTalkInstallation<F> & { readonly kind: string })[]; update: (dt: number, t: number, player: Vector3) => void } {
  const dialogue = views.view('dialogue', scope => new DialogueBox(scope));
  const people = installDeclaredNpcTalks(source, { ...ports, dialogue });
  return { dialogue, people, update: (dt: number, t: number, player: Vector3): void => {
    dialogue().update(dt); for (const person of people) person.update(dt, t, player);
  } };
}

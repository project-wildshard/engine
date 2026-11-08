import { QuestRuntimeDocumentSchema } from '@wildshard/format/questRuntime';
import { Vector3 } from 'three';
import { RewardCaption } from '@wildshard/engine/quest/view/ui';
import { parseChapterDirector, parseChapterWake, type ChapterDirectorRows } from '@wildshard/format/chapterDirector';
import { bindRuntimeBoss } from '../../../shared/game/plugin/runtimeRows';
import { BossBar } from '@wildshard/engine/ui/BossBar';
import { WakeBossEncounter } from '../../../shared/game/boss/wake';
import { presentWakeBoss } from '../boss/presentation';
import { BossRowBar } from '../boss/barFeed';
import { wirePage } from '../shardfile/wirePage';
import type { ShardContext } from '../plugin/context';
import { readDirectorProduct } from '../../../shared/game/plugin/director';
import { enteredCompletion } from '../complete/declared';
import { boundQuestChapter } from './chapter';
import { commitQuestEffects } from '../../../shared/game/quest/effects';
import { spawnCueWord } from '../../../shared/game/shardfile/wirePrompts';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { DeclaredSoundBank } from '@wildshard/engine/audio/declaredBank';
import { QuestRewardController } from '../../../shared/game/plugin/quests';
import { parseQuestSpawnPage, parseQuestLeadPage, QuestLeadPageSchema, type QuestSpawnPageRows, type QuestLeadPageRows } from '@wildshard/format/questSteps';
import * as v from 'valibot';
import { boundQuestState } from '../../../shared/game/quest/boundState';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { ChapterClock } from '../../../shared/game/quest/chapterClock';
import { leadActors } from '../../../shared/game/quest/chapterLeads';
import { prepareScriptMemoryLease } from '@wildshard/engine/script/host';

/** Client-only chapter/boss binding over the existing AS director and native
 * spawn owner. Content supplies rows, ids and the resolved arena position;
 * the host preserves the original bar/director update order and flag phase. */
export async function installChapterWakeEncounter(ctx: ShardContext, input: unknown, pool: { readonly x: number; readonly z: number }): Promise<{
  readonly actor: Animal | null; readonly rewardAt: Vector3; readonly rewardPose: NonNullable<ChapterDirectorRows['reward']>;
}> {
  const rows = parseChapterWake(input), source = ctx.product.shardfile;
  const flags = boundQuestState(ctx.scope, rows.quest).flags;
  const spawnOwner = bindRuntimeBoss(ctx, source, rows.spawn, undefined, { identity: 'runtime' });
  const director = await readChapterDirector(ctx, rows.director);
  const world = ctx.game.runtime?.world, play = ctx.game.runtime?.play;
  if (ctx.scope.disposed || world === undefined || world === null || play === undefined || play === null
    || director.rewardAt === null || director.rewardPose === undefined) throw new Error('Chapter encounter requires its entered world and reward');
  const encounter = new WakeBossEncounter(rows.encounter, pool), bar = ctx.scope.run(() => new BossBar());
  let actor: Animal | null = null;
  // J130: a bar has one driver. On the wire the row draws it, and the body under it is the server's.
  // A wake fight tells no start, and a fall ends it as a walk away does: only the page knows its player died.
  let fell = false;
  const rowBar = new BossRowBar(bar, { id: rows.encounter.id, name: rows.encounter.name, title: '', retryTitle: '', phases: [{ at: 1, caption: '' }, ...rows.encounter.presentation.cuts.map(at => ({ at, caption: '' }))] }, null, { attempt: outcome => {
    if (outcome !== 'started') ctx.app.events.emit('boss.attempt', { boss: rows.encounter.id, level: rows.encounter.level, outcome: outcome === 'left' && fell ? 'lost' : outcome === 'died' ? 'lost' : outcome });
    fell = false;
  } });
  const spawn = (): void => {
    if (actor !== null || rowBar !== null) return;
    try {
      actor = spawnOwner.spawn(); if (actor === null) throw new Error('Declared chapter body unavailable');
      actor.herd = -1; actor.mem[rows.encounter.fields.poolX] = pool.x; actor.mem[rows.encounter.fields.poolZ] = pool.z;
      actor.mem[rows.encounter.fields.arena] = rows.encounter.arena.radius;
    } catch (error) { console.error('Chapter encounter failed to spawn', error); flags.set(rows.encounter.deadFlag); }
  };
  const observation = () => ({ player: world.player.position, animal: actor,
    wake: flags.has(rows.encounter.wakeFlag), dead: flags.has(rows.encounter.deadFlag) });
  const present = (): void => { presentWakeBoss(encounter, bar, ctx.app.events); };
  const cues = (): void => {
    for (const id of director.takeCues()) {
      const row = rows.cues.find(cue => cue.id === id); if (row === undefined) throw new Error('Unknown chapter encounter cue');
      if (row.operation !== 'effects') spawn();
      if (row.operation === 'wake') { encounter.wake(observation()); present(); }
      commitQuestEffects(ctx, rows.quest, row.effects);
      if (row.combat !== undefined) play.music.combat(row.combat);
    }
  };
  ctx.scope.onDispose(flags.onChange(cues));
  ctx.app.encounters.register({ id: rows.encounter.id, displayName: rows.encounter.name }, ctx.scope);
  ctx.app.encounters.boss(rows.encounter.id, encounter, ctx.scope);
  ctx.on('player.died', () => { if (rowBar !== null) { fell = true; rowBar.playerDied(); return; } encounter.onPlayerDeath(world.player.position); present(); });
  cues();
  ctx.system({ id: rows.systems.encounter, phase: 'update', before: rows.systems.before,
    run: dt => { if (rowBar !== null) { rowBar.draw(wirePage.encounters(), dt); return; } bar.update(dt); encounter.update(observation()); present(); } });
  ctx.system({ id: rows.systems.director, phase: 'update', before: rows.systems.before, run: dt => { director.update(dt); cues(); } });
  return { get actor() { return actor; }, rewardAt: director.rewardAt, rewardPose: director.rewardPose };
}

/** Client-only chapter presentation on the caller's existing update phase.
 * Rows select observations and ordered effects; concrete entered services supply
 * flags, inventory, clock, objective, equipment and completion. Cues are values
 * for an existing view owner to consume, never reflected calls into shard code.
 */
export async function readChapterDirector(ctx: ShardContext, file: string): Promise<{
  readonly caption: RewardCaption; readonly rewardAt: Vector3 | null;
  readonly rewardPose: ChapterDirectorRows['reward'];
  update: (dt: number) => void; request: (id: string) => void;
  run: (id: string) => void; takeCues: () => string[];
}> {
  const rows = parseChapterDirector(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await ctx.product.file(file))));
  const director = await readDirectorProduct(ctx.product, ctx.scope);
  if (ctx.scope.disposed) throw new Error('Chapter left during director admission');
  const chapter = boundQuestChapter(ctx.scope, rows.quest), flags = chapter.quest.flags;
  const world = ctx.game.runtime?.world, play = ctx.game.runtime?.play;
  if (world === undefined || world === null || play === undefined || play === null) throw new Error('Chapter director requires its entered play services');
  const day = world.sky.dayNight;
  const rewardAt = rows.reward === undefined ? null : new Vector3(rows.reward.x, rows.reward.y, rows.reward.z);
  const cues: string[] = [], state = { started: false, completed: false };
  let timeline: ChapterClock | null = null;
  ctx.scope.onDispose(() => { cues.length = 0; if (timeline !== null) timeline.fast.on = null; });
  const caption = ctx.scope.run(() => new RewardCaption(rows.caption.kicker, rows.caption.title, rows.caption.subtitle));
  const reward = rows.reward === undefined || rewardAt === null ? null : new QuestRewardController(world.player, day,
    { ...rows.reward, at: rewardAt, when: () => state.started,
      finish: () => enteredCompletion(ctx.scope)?.showAfterReward() === true }, {
      start: () => { caption.show(true); play.weapons.visible = false; chapter.objective.hide(true); play.music.sting('chunk'); },
      finish: () => { caption.show(false); },
      release: () => { play.weapons.visible = true; chapter.objective.hide(false); },
    });
  ctx.scope.onDispose(() => { reward?.dispose(); caption.scope.dispose(); });
  const release = await prepareScriptMemoryLease([director.bytes], ctx.scope, 'frame');
  let clock: ChapterClock;
  try {
    clock = ctx.scope.run(() => new ChapterClock(ctx.scope, director, rows, flags,
    { day, player: world.player.position, reward: rewardAt, finish: 'set' }, effect => {
      if (effect.kind === 'caption') caption.show(effect.show);
      else if (effect.kind === 'objective') chapter.objective.hide(effect.hide);
      else if (effect.kind === 'cue') {
        if (cues.length >= 64) throw new Error('Chapter cue allowance');
        cues.push(effect.id);
      } else if (effect.kind === 'reward') state[effect.state] = true;
      else commitQuestEffects(ctx, rows.quest, [effect]);
    }));
  } finally { release(); }
  timeline = clock;
  const request = (id: string): void => { clock.lane.request(id); };
  ctx.scope.onDispose(chapter.quest.observe({ step: step => { clock.requestStep(step?.id); } }));
  clock.requestStep(chapter.quest.current?.id);
  return { caption, rewardAt, rewardPose: rows.reward, run: id => { clock.run(id); }, request, takeCues: () => cues.splice(0), update: dt => {
    if (ctx.scope.disposed) return;
    clock.update(dt); reward?.update(dt, state.completed);
  } };
}

/** Finite declared entry capability; ids name concrete owners in this entry. */
export interface QuestSpawnCapability {
  readonly id: string; readonly source: string;
  readonly quest: string; readonly animals: string; readonly sounds: string;
}
/** Client-only publications over the original AS spawn owner. Views borrow
 * these values at their existing update phase; no new save or clock is added. */
export interface QuestSpawnResult {
  readonly puffs: QuestSpawnPageRows['puffs']; readonly count: number;
  force: () => void; update: (dt: number, player: Vector3) => void;
  takePuffs: () => readonly { readonly x: number; readonly y: number; readonly z: number }[];
}

/** A server's spawns on this page: its cues as it says them, and what a finished script shows as its flag rises. A save's flag is no news. */
function wiredQuestSpawns(ctx: ShardContext, rows: QuestSpawnPageRows, flags: Flags, bank: DeclaredSoundBank): QuestSpawnResult {
  let puffs: { readonly x: number; readonly y: number; readonly z: number }[] = [];
  const word = spawnCueWord(rows.script), complete = new Map(rows.complete.map(row => [row.flag, row.effects]));
  wirePage.whenLive(ctx.scope, client => client.onView(({ name, args }) => {
    if (name !== word) return;
    const [id, x = 0, y = 0, z = 0] = args, cue = rows.cues.find(row => row.id === id);
    if (cue?.kind === 'sound') bank.shot(cue.name, { at: { x, y, z } });
    else if (cue?.kind === 'puff' && puffs.length < 64) puffs.push({ x, y, z });
  }));
  ctx.scope.onDispose(flags.onChange((flag, on) => {
    const effects = complete.get(flag);
    if (on && effects !== undefined && wirePage.settled) commitQuestEffects(ctx, rows.quest, effects.filter(effect => effect.kind === 'toast' || effect.kind === 'sting')); // the flag is the server's
  }));
  ctx.scope.onDispose(() => { puffs.length = 0; });
  return { puffs: rows.puffs, count: 0, force: () => undefined, takePuffs: () => { const out = puffs; puffs = []; return out; }, update: () => undefined };
}

/** Construct only after the entry has published its quest, animal and sound
 * loans. The complete named runtime contributes .spawns; there is no selector. */
export async function installDeclaredQuestSpawns(ctx: ShardContext, capability: QuestSpawnCapability): Promise<QuestSpawnResult> {
  const quest = entryOwner(ctx.scope, 'quest', capability.quest), animals = entryOwner(ctx.scope, 'animals', capability.animals);
  const bank = entryOwner(ctx.scope, 'sounds', capability.sounds);
  const product = ctx.product;
  const runtime = v.parse(QuestRuntimeDocumentSchema, await product.json<unknown>(capability.source));
  if (ctx.scope.disposed || ctx.scope.disposing || ctx.product !== product) throw new Error('Quest left during runtime admission');
  if (entryOwner(ctx.scope, 'quest', capability.quest) !== quest || entryOwner(ctx.scope, 'animals', capability.animals) !== animals
    || entryOwner(ctx.scope, 'sounds', capability.sounds) !== bank) throw new Error('Quest spawn loan changed during runtime admission');
  const rows = parseQuestSpawnPage(runtime.spawns);
  if (boundQuestState(ctx.scope, rows.quest).flags !== quest.flags) throw new Error('Quest spawn loan differs from its bound quest');
  // The server directs these spawns, and they arrive as rows.
  return wiredQuestSpawns(ctx, rows, quest.flags, bank);
}

/** Client-only guide lifetime over the actual manager. The chapter's AS projection decides at 10 Hz (G565: gate, walk
 * and appear / complete effects, committed by the chapter's decision rows); the native body integrates each frame. A
 * guide is removed from combat, aim-assist and minimap lists immediately. */
export function installChapterLead(ctx: ShardContext, input: unknown): {
  readonly puffs: QuestLeadPageRows['puffs'];
  readonly active: boolean; readonly position: Vector3 | null;
  update: (dt: number, t: number) => void;
  takePuffs: () => readonly { readonly kind: 'appear' | 'fade'; readonly x: number; readonly y: number; readonly z: number }[];
} {
  const rows = parseQuestLeadPage(v.parse(v.object({ leadPage: QuestLeadPageSchema }), input).leadPage), chapter = boundQuestChapter(ctx.scope, rows.quest);
  const world = ctx.game.runtime?.world, animals = ctx.game.runtime?.play?.animals;
  if (world === undefined || world === null || animals === undefined) throw new Error('Chapter guide requires its entered world');
  let actor: Animal | null = null, pending = 0;
  const lead = { get actor(): Animal | null { return actor; } }, book = leadActors.get(ctx.scope) ?? new Map<string, { actor: Animal | null }>();
  if (book.has(rows.quest)) throw new Error('Duplicate native chapter guide');
  book.set(rows.quest, lead); leadActors.set(ctx.scope, book); ctx.scope.onDispose(() => { book.delete(rows.quest); });
  const walk = { i: 0, mode: 0, elapsed: 0 }, observation = { i: 0, mode: 0, elapsed: 0, begin: 0, dt: 0, night: 0, playerX: 0, playerZ: 0, atX: 0, atZ: 0 };
  let puffs: { readonly kind: 'appear' | 'fade'; readonly x: number; readonly y: number; readonly z: number }[] = [];
  const puff = (kind: 'appear' | 'fade'): void => {
    if (actor === null) return;
    if (puffs.length >= 64) throw new Error('Chapter guide cue allowance');
    puffs.push({ kind, x: actor.position.x, y: actor.position.y, z: actor.position.z });
  };
  const vanish = (): void => {
    if (actor === null) return;
    if (actor.mesh.visible) puff('fade');
    actor.alive = false; actor.hidden = true; actor.mesh.visible = false; actor.mesh.removeFromParent(); actor = null;
  };
  ctx.scope.onDispose(() => { vanish(); puffs.length = 0; });
  return { puffs: rows.puffs, get active() { return actor !== null; }, get position() { return actor?.position ?? null; },
    takePuffs: () => { const out = puffs; puffs = []; return out; }, update: (dt, t) => {
      if (ctx.scope.disposed) return;
      const player = world.player.position;
      pending += dt;
      if (pending >= 0.1) {
        const point = rows.path[walk.i], at = actor?.position;
        Object.assign(observation, walk, { dt: pending, night: world.sky.dayNight?.night ?? 0, playerX: player.x, playerZ: player.z, atX: at?.x ?? point?.[0] ?? 0, atZ: at?.z ?? point?.[1] ?? 0 });
        const result = chapter.project(rows.signal, observation), i = result['i'], mode = result['mode'], elapsed = result['elapsed'], event = result['event'];
        if (i === undefined || mode === undefined || elapsed === undefined || event === undefined || !Number.isInteger(i) || i < 0 || i >= rows.path.length
          || !Number.isInteger(mode) || mode < 0 || mode > 3 || elapsed < 0 || !Number.isInteger(event) || event < 0 || event > 5) throw new Error('Invalid chapter guide projection');
        walk.i = i; walk.mode = mode; walk.elapsed = elapsed; pending = 0;
        if (event === 4) vanish();
        else if (event === 1 || event === 2) {
          const target = rows.path[walk.i];
          if (target === undefined) throw new Error('Missing chapter guide point');
          const yaw = Math.atan2(player.x - target[0], player.z - target[1]);
          if (actor !== null) { actor.place(target[0], target[1], yaw); actor.mesh.visible = true; }
          else {
            actor = animals.spawn(rows.actor.kind, target[0], target[1], yaw, rows.actor.variant);
            const index = animals.animals.indexOf(actor); if (index !== -1) animals.animals.splice(index, 1);
            actor.herd = -1; actor.setDrawLod(0);
          }
          actor.sampleTerrain(); puff('appear');
        } else if (event !== 0 && actor !== null) {
          puff('fade'); animals.onSound?.(rows.sound, actor.position);
          actor.mesh.visible = false; actor.setMotion(actor.yaw, 0, rows.motion.stopTurn);
          if (event === 5) vanish();
        }
      }
      if (actor === null) return;
      actor.update(dt, t, true);
      if (Math.floor(t * 10) !== Math.floor((t - dt) * 10)) actor.sampleTerrain();
      if (walk.mode === 1) {
        actor.setMotion(Math.atan2(player.x - actor.position.x, player.z - actor.position.z), 0, rows.motion.faceTurn);
        actor.lookTarget.copy(player); actor.lookWeight = 1;
      } else if (walk.mode === 2) {
        const next = rows.path[walk.i + 1] ?? rows.path[walk.i];
        if (next !== undefined) actor.setMotion(Math.atan2(next[0] - actor.position.x, next[1] - actor.position.z), rows.motion.trotSpeed, rows.motion.trotTurn);
        actor.lookWeight = 0;
      }
    } };
}

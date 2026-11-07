/** Renderer-free chapter clock binding shared by the actual native quest entries. */
import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import type { Scope } from '@wildshard/engine/app/scope';
import { isJsonData } from '@wildshard/format/json';
import { ChapterDirectorSchema, parseChapterDirector } from '@wildshard/format/chapterDirector';
import { WakeEncounterSchema } from '@wildshard/format/bossEncounter';
import type { DirectorScriptStageLane, readDirectorProduct } from '../../../shared/game/plugin/director';
import { mixedPopulation } from '../population/mixedRoster';
import { installWakeBoss } from '../boss/nativeWake';
import { installNativeQuestChannels } from './nativeInputs';
import { ChapterClock } from '../../../shared/game/quest/chapterClock';
import { questBooks, type QuestBook } from '@wildshard/engine/quest/players';

const finite = v.pipe(v.number(), v.finite());
const chapterName = v.pipe(v.string(), v.minLength(1), v.maxLength(256));
const nativeChapter = v.strictObject({ id: chapterName, rows: ChapterDirectorSchema, reward: v.exactOptional(chapterName),
  wake: v.exactOptional(v.strictObject({ population: chapterName, encounter: WakeEncounterSchema,
    placement: v.strictObject({ pool: v.object({ x: finite, z: finite }), arena: finite }),
    cues: v.pipe(v.array(v.strictObject({ id: chapterName, operation: v.picklist(['restore', 'wake', 'effects']) })), v.maxLength(64)) })) });

/** Renderer-free chapter entry. Closed rows borrow actual population, encounter
 * and reward owners; the caller retains its existing step and save envelope. */
export function installNativeChapterDirector(host: SimHost, director: Awaited<ReturnType<typeof readDirectorProduct>>, input: unknown, restoring = false): {
  readonly clock: DirectorScriptStageLane; readonly fast: ChapterClock['fast'];
  /** One tick: `step` is the lead's chapter step, and `quest` names the chapter, so each other player's clock reads its own. */
  readonly update: (dt: number, step?: string, quest?: string) => void;
} {
  const books = questBooks(host);
  if (host.scope.disposed || !isJsonData(input)) throw new Error('Native chapter requires live JSON rows');
  const policy = v.parse(nativeChapter, input), rows = parseChapterDirector(policy.rows);
  const cues = new Map(policy.wake?.cues.map(cue => [cue.id, cue]));
  if (cues.size !== (policy.wake?.cues.length ?? 0)) throw new Error('Duplicate native chapter cue');
  for (const effects of Object.values(rows.actions)) for (const effect of effects) {
    if (effect.kind === 'cue' && !cues.has(effect.id)) throw new Error('Missing native chapter cue');
    if (effect.kind === 'reward' && policy.reward === undefined) throw new Error('Missing native chapter reward owner');
    if (!['flag', 'phase', 'cue', 'reward'].includes(effect.kind)) throw new Error('Native chapter requires closed native effects');
  }
  const population = policy.wake === undefined ? null : mixedPopulation(host, policy.wake.population);
  const encounter = policy.wake === undefined ? null : installWakeBoss(host, policy.wake.encounter, policy.wake.placement);
  const reward = policy.reward === undefined ? null : installNativeQuestChannels(host, policy.reward, { started: false, completed: false });
  const leadBody = host.players.get(books.lead.player); if (leadBody === undefined) throw new Error('Native chapter requires its player');
  const timeline = new ChapterClock(host.scope, director, rows, host.flags,
    { get day() { return host.dayClock ?? null; }, player: leadBody.position, reward: rows.reward ?? null, finish: 'assign' }, effect => {
      if (effect.kind === 'reward' && reward !== null) reward[effect.state] = true;
      else if (effect.kind === 'cue' && population !== null && encounter !== null && policy.wake !== undefined) {
        const cue = cues.get(effect.id); if (cue === undefined) throw new Error('Unknown native chapter cue');
        if (cue.operation !== 'effects') {
          if (population.captain() === null) population.spawnCaptain();
          encounter.publish(cue.operation === 'wake' ? policy.wake.encounter.events.wake : policy.wake.encounter.events.restore);
        }
      }
    }, restoring);
  timeline.lane.registerNative(host, policy.id);
  books.claim(Object.values(rows.actions).flatMap(effects => effects.flatMap(effect => effect.kind === 'flag' ? [effect.flag] : [])));
  /** J106: a chapter is each player's own: its clock over that player's book. The day and the reward stay the world's and the lead's. */
  const seats = new Map<string, { readonly clock: ChapterClock; readonly book: QuestBook; readonly scope: Scope }>();
  const seen: { phase: number; readonly night: number; set: () => Promise<void> } = { get phase() { return host.dayClock?.phase ?? 0; }, set phase(_ignored: number) { /* a player's chapter does not turn the room's day */ },
    get night() { return host.dayClock?.night ?? 0; }, set: () => Promise.resolve() };
  books.install(book => {
    const body = host.players.get(book.player); if (body === undefined) throw new Error('Native chapter requires its player');
    const scope = host.scope.child(`chapter:${book.player}`);
    const clock = new ChapterClock(scope, director, rows, book.flags, { get day() { return host.dayClock === undefined ? null : seen; }, player: body.position, reward: rows.reward ?? null, finish: 'assign' }, effect => {
      if (effect.kind !== 'cue' || population === null || encounter === null || policy.wake === undefined) return;
      const cue = cues.get(effect.id); if (cue === undefined) throw new Error('Unknown native chapter cue');
      // the boss is the room's: a player's chapter can wake one, and never resets a fight already running
      if (cue.operation === 'wake' && population.captain() === null) { population.spawnCaptain(); encounter.publish(policy.wake.encounter.events.wake); }
    }, books.restoring);
    seats.set(book.player, { clock, book, scope });
    book.part(`chapter:${policy.id}`, { read: () => clock.lane.snapshot(), write: saved => { clock.lane.restore(saved); } });
  });
  books.lead.part(`chapter:${policy.id}`, { read: () => timeline.lane.snapshot(), write: saved => { timeline.lane.restore(saved); } });
  return { clock: timeline.lane, fast: timeline.fast, update: (dt, step, quest) => {
    timeline.update(dt, step);
    for (const [player, seat] of seats) {
      if (!host.players.has(player)) { seat.scope.dispose(); seats.delete(player); continue; }
      seat.clock.update(dt, seat.book.quests.find(entry => entry.def.id === quest)?.current?.id);
    }
  } };
}

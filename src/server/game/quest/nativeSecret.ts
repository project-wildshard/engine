/**
 * SERVER-PARITY SS5: a chapter signal the page projects near a declared place, run on the server for every player. Pine's hollow
 * log: the page's quest views asked the chapter program `secret` every half second with the player's and the log's positions
 * (`questPageViews.ts`), and its `accept` raised `secret:log` in the page's own flags, so in a room "Find the 3 secrets" never
 * finished. Here the same admitted program, decision rows and cadence run for each seat, and the flags land in that player's
 * book. What a channel shows (its toast) stays the page's.
 *
 *   const step = installNativeQuestSecret(host, await readNativeQuestSecret(product), questBooks(host)); host.onStep(id, step);
 */
import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import type { QuestBook, QuestBooks } from '@wildshard/engine/quest/players';
import { parseQuestStory } from '@wildshard/format/questStory';
import type { QuestPageRows } from '@wildshard/format/questPageComposition';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { chapterDecide } from '../../../shared/game/quest/chapterDecision';
import { commitSeatEffects } from '../../../shared/game/quest/effects';
import { questObservation } from '../../../shared/game/quest/questObservation';
import type { QuestStepEffect } from '../../../shared/game/quest/steps';

/** The page's own story file (`pageComposition.ts`). */
const STORY = 'quests/story.json';
/** The page's projection beat (`QuestPageViews.present`): one ask every half second. */
const INTERVAL = 0.5;
const finite = v.pipe(v.number(), v.finite()), id = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const ViewRows = v.looseObject({ quest: id, secret: v.optional(v.looseObject({ projection: id, floorY: finite, mid: v.tuple([finite, finite, finite]) })) });
/** Install refuses item effects, so a seat's pack is never asked. */
const NO_ITEMS = { add: (): boolean => false, take: (): boolean => false };

type Decision = NonNullable<NonNullable<ReturnType<typeof parseQuestStory>['chapters']>['decision']>;
/** The declared place, its signal, and the chapter program and rows that decide it. */
export interface NativeQuestSecret {
  readonly program: unknown; readonly signal: string; readonly at: readonly [number, number, number]; readonly floorY: number; readonly decision: Decision;
}

/** The page's quest-view secret, from the rows the page reads: the `quest.views` file's `secret`, its quest composition's chapter
 *  program and the story's decision. Undefined when a shard's quest views declare none. */
export async function readNativeQuestSecret(product: ShardFolder): Promise<NativeQuestSecret | undefined> {
  if (!product.has('client/plan')) return undefined;
  const features = product.section('client/plan').features, views = features.find(row => row.kind === 'quest.views');
  if (views === undefined) return undefined;
  const rows = v.parse(ViewRows, await product.json<unknown>(views.file)), secret = rows.secret;
  if (secret === undefined) return undefined;
  const page = features.find(row => row.kind === 'quest.composition' && row.id === rows.quest);
  if (page?.kind !== 'quest.composition' || !product.hasFile(STORY)) throw new Error('Quest secret needs its quest composition and story');
  const [composition, story] = await Promise.all([product.json<QuestPageRows>(page.file), product.json<unknown>(STORY)]);
  const decision = parseQuestStory(story).chapters?.decision, program = composition.chapter.program ?? decision?.program;
  if (decision === undefined || program === undefined) throw new Error('Quest secret needs its chapter decision and program');
  return { program, signal: secret.projection, at: secret.mid, floorY: secret.floorY, decision };
}

const presents = (effect: QuestStepEffect): boolean => effect.kind === 'toast' || effect.kind === 'sting' || effect.kind === 'reading';
/** A seat commits flags only; anything else is refused at install, not on a player's first find mid-step. */
const commits = (effect: QuestStepEffect): boolean => effect.kind === 'flag' || presents(effect);

/** Ask the secret's signal for each seated player on the page's beat; return the step. The flags the signal observes are each
 *  player's own (claimed), so one player's find is theirs alone. */
export function installNativeQuestSecret(host: SimHost, secret: NativeQuestSecret, books: QuestBooks): (dt: number) => void {
  const program = ReturnProgram.native(host, secret.program), { decision, signal } = secret, [atX, atY, atZ] = secret.at;
  if (Object.values(decision.actions).some(effects => !effects.every(commits))) throw new Error('A quest secret commits only flags and notices');
  books.claim(Object.values(decision.observations).flatMap(row => (row.on === undefined || row.on === signal) && 'flag' in row.source ? [row.source.flag] : []));
  const values = { playerX: 0, playerY: 0, playerZ: 0, atX, atY, atZ, floorY: secret.floorY };
  const observe = (book: QuestBook, source: Parameters<typeof questObservation>[0]): number => questObservation(source, { flags: () => book.flags,
    quest: quest => { const state = book.quests.find(row => row.def.id === quest); if (state === undefined) throw new Error(`Unknown quest ${quest}`); return state; },
    active: () => book.quests.find(row => !row.isComplete && row.current !== null) ?? null,
    saved: () => { throw new Error('A quest secret reads no saved records'); } });
  let now = 0, last = 0;
  return dt => {
    now += dt;
    if (now - last <= INTERVAL) return;
    last = now;
    for (const book of books.each()) {
      const body = host.players.get(book.player);
      if (body === undefined) continue;
      values.playerX = body.position.x; values.playerY = body.position.y; values.playerZ = body.position.z;
      chapterDecide(program, decision, signal, values, source => observe(book, source), effects => { commitSeatEffects(effects.filter(effect => !presents(effect)), book.flags, NO_ITEMS); });
    }
  };
}

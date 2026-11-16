// meta NEW-SHARD-E2E F27 (MINI-UNBLOCK MU6): a proof tape talks to a quest-giver and answers it by name. The page's own
// presses are `talk:<talk>.<node>.<choice>` by position (talks.ts); a tape names the talk row (`wren`: E, which closes a
// node with no choices and opens one with) or the talk and a choice of its current node (`wren:accept`). Both resolve to
// the same claim the page's press lands on, judged where the server has the player, so a tape proves the real path.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { DeclaredQuests } from '../../../shared/game/quest/declared';
import { talkChoice, talkFinish } from '../../../shared/game/shardfile/talks';

/** What a tape's `interact` id names among a shard's talks. */
export type TalkPress = { readonly kind: 'press'; readonly claim: string } | { readonly kind: 'open' } | { readonly kind: 'over' };

/** Every id a tape may name now, for a refusal: interactions, talks, and each talk's current choices as `<talk>:<choice>`. */
export function tapeTargets(shard: Pick<Shardfile, 'targets'>, quest: DeclaredQuests, player: string): string[] {
  const out = shard.targets.interactions.map(row => row.id);
  for (const talk of shard.targets.talks ?? []) {
    out.push(talk.id);
    for (const choice of quest.view(talk.dialogue, player)?.choices ?? []) out.push(`${talk.id}:${choice.id}`);
  }
  return out;
}

/** The talk press an id names, or null when it names no talk. A choice the player's current node lacks refuses, naming the ones it has. */
export function talkPress(shard: Pick<Shardfile, 'targets' | 'quests'>, quest: DeclaredQuests, id: string, player: string): TalkPress | null {
  const talks = shard.targets.talks ?? [];
  if (id.startsWith('talk:')) return { kind: 'press', claim: id }; // the page's own positional press
  const split = id.indexOf(':'), name = split === -1 ? id : id.slice(0, split), choiceId = split === -1 ? null : id.slice(split + 1);
  const index = talks.findIndex(talk => talk.id === name), talk = talks[index];
  if (talk === undefined) return null;
  const tree = shard.quests.dialogue.find(row => row.id === talk.dialogue);
  if (tree === undefined) throw new Error(`Talk ${talk.id} requires its declared dialogue: ${talk.dialogue}`);
  const view = quest.view(tree.id, player);
  if (view === null) return { kind: 'over' };
  const at = tree.nodes.findIndex(node => node.id === view.id), node = tree.nodes[at];
  if (node === undefined) throw new Error(`Talk ${talk.id} stands at an undeclared node: ${view.id}`);
  if (choiceId === null) return node.choices.length === 0 ? { kind: 'press', claim: talkFinish(index) } : { kind: 'open' };
  const position = node.choices.findIndex(choice => choice.id === choiceId);
  if (position === -1 || !view.choices.some(choice => choice.id === choiceId)) {
    const offers = view.choices.map(choice => `${talk.id}:${choice.id}`).join(', ');
    throw new Error(`Talk ${talk.id} at node ${node.id} has no choice ${choiceId} now; it offers: ${offers === '' ? `none (press E: interact ${talk.id})` : offers}`);
  }
  return { kind: 'press', claim: talkChoice(index, at, position) };
}

/** Land a talk press on its claim, as the page's would; false when the server refuses it (too far, or the node moved on). */
export function pressTalk(host: SimHost, claim: string, player: string): boolean {
  const routes = actRoutes(host), land = routes.claims.get(claim);
  if (land === undefined) throw new Error(`Unknown talk press ${claim}`);
  const refused = routes.refused; land(player);
  return routes.refused === refused;
}

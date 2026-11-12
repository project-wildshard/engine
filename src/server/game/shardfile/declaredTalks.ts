// TE-ENG3: a data shard's quest-givers (`targets.talks`) on the server. Each player's node lives in `DeclaredQuests`, saved in
// the quest's existing dialogue part; this owner says it as an owned line and takes the page's answers by name, judged where
// the player stands. A choice sets its flags, so a quest's `startWhen` takes the accept; the quest pays as it always has.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import type { DeclaredQuests } from '../../../shared/game/quest/declared';
import { talkChoice, talkFinish, talkLine } from '../../../shared/game/shardfile/talks';

/** A press is judged where the server has the body, a command behind: this much past the talk's reach still counts. */
const TALK_SLACK = 1.5;

/** Route a shard's talks and publish each player's node; nothing when it declares none. */
export function installDeclaredTalks(host: SimHost, shard: Pick<Shardfile, 'targets' | 'quests'>, quest: DeclaredQuests): void {
  const talks = shard.targets.talks ?? [];
  if (talks.length === 0) return;
  const routes = actRoutes(host);
  const trees = talks.map(talk => {
    const tree = shard.quests.dialogue.find(row => row.id === talk.dialogue);
    if (tree === undefined) throw new Error(`Talk requires its declared dialogue: ${talk.dialogue}`);
    return { talk, tree };
  });
  for (const [index, { talk, tree }] of trees.entries()) {
    const near = (player: string): boolean => {
      const body = host.players.get(player)?.position;
      return body !== undefined && Math.hypot(body.x - talk.at[0], body.z - talk.at[2]) <= talk.radius + TALK_SLACK;
    };
    // The node the player stands at, as the tree declares it; null once the talk is over.
    const current = (player: string): Shardfile['quests']['dialogue'][number]['nodes'][number] | null => {
      const view = quest.view(tree.id, player);
      return view === null ? null : tree.nodes.find(node => node.id === view.id) ?? null;
    };
    for (const [at, node] of tree.nodes.entries()) for (const [position, choice] of node.choices.entries()) routes.claims.set(talkChoice(index, at, position), player => {
      // only a choice of the node this player stands at, its condition met now (a page a frame behind may ask for one it no longer has)
      if (!near(player) || current(player) !== node || quest.view(tree.id, player)?.choices.some(entry => entry.id === choice.id) !== true) { routes.refused++; return; }
      quest.choose(tree.id, choice.id, player);
    });
    routes.claims.set(talkFinish(index), player => {
      const node = current(player);
      if (!near(player) || node === null || node.choices.length > 0) { routes.refused++; return; }
      quest.finish(tree.id, player);
    });
  }
  publishOwned(host, 'talks.declared', (player, out) => {
    if (!host.players.has(player)) return;
    for (const { tree } of trees) {
      const view = quest.view(tree.id, player);
      out.set(talkLine(tree.id), view === null ? tree.nodes.length + 1 : tree.nodes.findIndex(node => node.id === view.id) + 1);
    }
  });
}

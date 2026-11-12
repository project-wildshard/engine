// TE-ENG3: a data shard's quest-giver (`targets.talks`), the names both halves share. The server keeps each player's node in
// the quest's dialogue part and says it as an owned line; the page shows that node and sends the player's answer by name.
import type { Shardfile } from '@wildshard/format/shardSchema';

/** One declared talk row. */
export type TalkRow = NonNullable<Shardfile['targets']['talks']>[number];
/** How far over its feet a talk's prompt stands, in metres: about a figure's head. */
export const TALK_HEIGHT = 1.5;
/** The owned line that says a player's node in `dialogue`: the node's index + 1, or past the last node once the talk is over.
 *  Never zero, since a line at zero is not sent: no line yet means the server has not spoken. */
export function talkLine(dialogue: string): string { return `dialogue:${dialogue}`; }
/** The press that takes a node's choice, by position: `talk:<talk>.<node>.<choice>`, the talk's place in `targets.talks` and the
 *  node's and choice's in its tree. Positions keep every press short and wire-safe (a press id is at most 128 of `[a-zA-Z0-9._:-]`),
 *  and the colon keeps them apart from every interaction id, which may hold none. */
export function talkChoice(talk: number, node: number, choice: number): string { return `talk:${String(talk)}.${String(node)}.${String(choice)}`; }
/** The press that closes the talk's current node when it has no choices. */
export function talkFinish(talk: number): string { return `talk:${String(talk)}.end`; }
/** What a talk line's value says of a tree: its current node, or null once the talk is over (undefined: no line yet). */
export function talkNode(tree: Shardfile['quests']['dialogue'][number], value: number): Shardfile['quests']['dialogue'][number]['nodes'][number] | null | undefined {
  if (value <= 0) return undefined;
  return tree.nodes[value - 1] ?? null;
}

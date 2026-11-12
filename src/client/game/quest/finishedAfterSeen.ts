/** What a quest's "Quest complete" beat reads of the wire: whether this page's books follow the server's, and whether the world's first frame is in. */
export interface SeenWire { readonly following: boolean; readonly settled: boolean }

/**
 * TE-ENG8: true once `quest` finishes after this page first saw it open, so a quest a save already finished raises no "Quest
 * complete" beat on load. On the wire the page's flags mirror the server's only from the world's first frame: at install a
 * finished quest still reads open, and finishes a frame later. Where it stands at that first settled frame is the save's word.
 * A page off the wire reads its own flags at once.
 */
export function finishedAfterSeen(quest: { readonly isComplete: boolean }, wire: SeenWire): () => boolean {
  let before: boolean | null = wire.following ? null : quest.isComplete;
  return () => {
    if (before === null) { if (!wire.settled) return false; before = quest.isComplete; }
    return !before && quest.isComplete;
  };
}

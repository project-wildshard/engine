/** What a quest's "Quest complete" beat reads of the wire: whether this page's books follow the server's, and its world's first frame. */
export interface SeenWire {
  readonly following: boolean;
  /** Run `then` once at the world's first frame, after its flags are mirrored (now, if it is in); returns its cancel. */
  readonly whenSettled: (then: () => void) => () => void;
}

/**
 * TE-ENG8: true once `quest` finishes after this page first saw it open, so a quest a save already finished raises no "Quest
 * complete" beat on load. On the wire the page's flags mirror the server's only from the world's first frame: at install a
 * finished quest still reads open, and finishes a frame later. Where it stands at that first frame is the save's word, taken
 * as the frame lands, whether or not the beat is polled then. A page off the wire reads its own flags at install. `keep`
 * holds the wait's cancel for the caller's lifetime.
 */
export function finishedAfterSeen(quest: { readonly isComplete: boolean }, wire: SeenWire, keep: (cancel: () => void) => void): () => boolean {
  let before: boolean | null = null;
  const take = (): void => { before ??= quest.isComplete; };
  if (wire.following) keep(wire.whenSettled(take)); else take();
  return () => before === false && quest.isComplete;
}

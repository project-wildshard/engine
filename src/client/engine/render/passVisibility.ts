/**
 * A pass that hides objects for one render and shows them again within the same frame (aoTransparency.ts's pre-passes)
 * says so here, so watchers of `visible` (the grid's cellClip) do not take the restore for a reveal.
 *
 * DRIFTWOOD-FPS DF14 (mini-dwfps, 2026-11-23): n8ao's pre-passes hide every visible opaque renderable and show it again,
 * every frame. At the Driftwood dock each restore marked its object as revealed, so cellClip re-gated and re-checked the
 * whole cell's draws on the next frame (about 9% of desktop High's frame CPU). Nothing moves between the hide and the
 * restore, so the objects end the pass exactly as the main pass drew them.
 */
let depth = 0;
/** true while a pass restores the visibility it borrowed (a watcher skips its reveal work) */
export function restoringPassVisibility(): boolean { return depth > 0; }
/** run `restore` (a loop that sets `visible` back) as a pass's own restore */
export function restorePassVisibility(restore: () => void): void {
  depth++;
  try { restore(); } finally { depth--; }
}

/**
 * QA-FEEDBACK-2026-11-24 row 35 (Jake, ~14:50 Cancún: "i can no longer harvest corpses of enemies for items in driftwood"). The
 * bodies a carcass prompt reads. Standalone, the page's own creatures. In the grid, inside an entered runtime cell, that cell's
 * (`LiveGridSession.enteredAnimals`, in the cell's frame, where the feet and the camera are): since Driftwood's creatures became
 * declared rows its kills fell in the entered cell, and the prompt read only the page's, so no corpse ever offered a harvest.
 * On the road, none (QA 11-23-b row 7 fixed the minimap the same way).
 */
export function harvestBodies<T>(homeActive: boolean, page: readonly T[], entered: (() => { readonly animals: readonly T[] } | null) | null): readonly T[] {
  if (homeActive) return page;
  return entered?.()?.animals ?? [];
}

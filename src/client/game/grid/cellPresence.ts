// GC2 (GRID-CROSSING): which cell interior the page says the player is in (`gridCells`), and when the frame gate must say so
// itself. Online, the server still walls every cell (C5, `dedicatedRoom.ts` opens each `lone`), and the page predicts ahead of
// it with no wall of its own: at boost the feet ran ~6 m past the edge before the server pulled them back. The page took that
// for a departure, left the cell (its entered hooks out, a 900 ms frame), and on the way back in the frame gate shut on the
// unentered hooks before the fixed step that enters them could run, so no frame ever ran again (the first repro, staging
// v0.1.12: 120 s "on the road", the view frozen). Real online crossings are MP1.6 / GC15.

/** A fixed step's word to `gridCells`. */
export type CellPresence = { readonly kind: 'enter'; readonly instance: string; readonly slug: string } | { readonly kind: 'leave' } | { readonly kind: 'keep' };
interface CellRef { readonly instance: string; readonly slug: string }

/** `inside`: the cell whose interior holds the feet (undefined on the road or a rim); `active`: the crossing's current cell;
 *  `held`: the server still has this client in `active`. Feet off every interior while the server holds the body in the cell
 *  are prediction on the rim, not a departure: keep it entered. */
export function cellPresence(inside: CellRef | undefined, active: string | null, held: boolean): CellPresence {
  if (inside !== undefined && inside.instance === active) return { kind: 'enter', instance: inside.instance, slug: inside.slug };
  return inside === undefined && active !== null && held ? { kind: 'keep' } : { kind: 'leave' };
}

/** Whether the frame gate enters `current` itself: the feet are in its interior, it has entered hooks to run, and the page has
 *  not entered it. The gate waits on those hooks, and the hooks start only from an entry, so without this nothing opens it. */
export function gateEnters(current: string | null, feetCell: string | undefined, entered: string | null, hasRuntime: boolean): boolean {
  return current !== null && hasRuntime && feetCell === current && entered !== current;
}

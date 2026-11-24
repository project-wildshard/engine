/** Fit complete words inside one map label's pixel box; no line can reach a neighbour. */
export function fitMapLabel(text: string, width: number, height: number, preferred: number, minimum: number,
  measure: (line: string, font: number) => number): { readonly lines: readonly string[]; readonly font: number } {
  if (![width, height, preferred, minimum].every(Number.isFinite) || width <= 0 || height <= 0 || minimum <= 0) return { lines: [], font: minimum };
  const words = text.trim().split(/\s+/u);
  for (let font = Math.max(minimum, preferred); font >= minimum; font--) {
    const lines: string[] = []; let line = '', fits = true;
    for (const word of words) {
      if (measure(word, font) > width) { fits = false; break; }
      const next = line.length === 0 ? word : `${line} ${word}`;
      if (measure(next, font) <= width) line = next;
      else { lines.push(line); line = word; }
    }
    if (line.length > 0) lines.push(line);
    if (fits && lines.length * font * 1.15 <= height) return { lines, font };
  }
  return { lines: [], font: minimum };
}

/** A screen rectangle, canvas pixels. */
export interface ScreenRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/**
 * QA 11-23-b row 16 (polish board, Names A): where a neighbour's name goes so it is never cut by the map's frame. The name keeps
 * its spot (`at`) when it fits there; otherwise it slides along its cell to the part of the cell that is on screen. Null when no
 * whole name fits upright in what shows (a thin rim, a corner sliver): no label rather than a cut one. QA-FEEDBACK 11-24 row 19
 * (Jake: names "turn sideways and run across the neighbouring tiles"): a name is never turned; Rims A's sideways name is gone.
 */
export function placeInside(at: { readonly x: number; readonly y: number }, cell: ScreenRect, view: ScreenRect, textW: number, textH: number,
  pad: number): { readonly x: number; readonly y: number } | null {
  const vx0 = Math.max(cell.x0, view.x0) + pad, vx1 = Math.min(cell.x1, view.x1) - pad;
  const vy0 = Math.max(cell.y0, view.y0) + pad, vy1 = Math.min(cell.y1, view.y1) - pad;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  if (vx1 - vx0 >= textW && vy1 - vy0 >= textH) return { x: clamp(at.x, vx0 + textW / 2, vx1 - textW / 2), y: clamp(at.y, vy0 + textH / 2, vy1 - textH / 2) };
  return null;
}

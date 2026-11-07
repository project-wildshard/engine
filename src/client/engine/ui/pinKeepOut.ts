/**
 * World pins never cover a control (SHARD-PLATFORM playtest 1, E332). A pin (`hud.pin`, hudAdapters.ts) is projected onto
 * its world point, so a quest marker over an NPC who stands at the screen edge lands on whatever control sits there (Sky
 * Reach's "KEEPER 8 M" over HOVER). The pin pass reads the touch layer's visible controls a few times a second
 * (`controlRects`) and moves a pin that would overlap one to the nearest clear spot beside it (`placePin`); the controls,
 * slots and bands never move.
 */

/** a screen rectangle in CSS pixels */
export interface PinRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** the gap between a moved pin and the control it steps round (px) */
const GAP = 6;

const overlaps = (a: PinRect, b: PinRect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const box = (x: number, y: number, w: number, h: number): PinRect => ({ left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 });

/**
 * Where a `w` × `h` pin centred on (x, y) goes: (x, y) itself when it covers no keep-out rectangle; otherwise the clear
 * spot nearest to it that is just above, below, right or left of a control it would cover (on screen), or null when there
 * is none (the pin hides for that frame).
 */
export function placePin(x: number, y: number, w: number, h: number, keepOut: readonly PinRect[], view: { readonly width: number; readonly height: number }): { x: number; y: number } | null {
  const clear = (cx: number, cy: number): boolean => {
    const r = box(cx, cy, w, h);
    if (r.top < 0 || r.bottom > view.height || r.left < 0 || r.right > view.width) return false;
    for (const k of keepOut) if (overlaps(r, k)) return false;
    return true;
  };
  const own = box(x, y, w, h);
  const hits = keepOut.filter((k) => overlaps(own, k));
  if (hits.length === 0) return { x, y };
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  const consider = (cx: number, cy: number): void => {
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD && clear(cx, cy)) { best = { x: cx, y: cy }; bestD = d; }
  };
  // one axis at a time, beside each control in the way (a stack of them: beside the stack's outer edge too)
  const top = Math.min(...hits.map((k) => k.top)), bottom = Math.max(...hits.map((k) => k.bottom));
  const left = Math.min(...hits.map((k) => k.left)), right = Math.max(...hits.map((k) => k.right));
  for (const k of [...hits, { left, top, right, bottom }]) {
    consider(x, k.top - GAP - h / 2); consider(x, k.bottom + GAP + h / 2);
    consider(k.right + GAP + w / 2, y); consider(k.left - GAP - w / 2, y);
  }
  return best;
}

/** the touch layer's visible controls under `root`: its buttons and the bottom bar (MOVE · ATTACK · LOOK) */
export function controlRects(root: ParentNode): PinRect[] {
  const out: PinRect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('.ws-touch button, .ws-touch .ws-touch-bar')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

import { uiScope, mountUi } from '@wildshard/engine/ui/ownership';
/**
 * BagButton — the INVENTORY button that squares out the minimap's top-right corner (E124, the user: "a button that squares out
 * the minimap … top and right straight edge, and on the minimap the button has like a reverse moon edge").
 *
 *   new BagButton(minimap.root, () => menu.open('inventory'));   // main.ts
 *
 * One SVG inside `.ws-minimap`, so it follows the minimap's size, place, intro fade and hide. Its box starts at the circle's
 * centre and runs up and right; the drawing is in units where the minimap's radius is 100:
 *   - the piece: straight top and right edges at SIDE (just past the rim's tick tips at ~111), a concave edge ON the rim
 *     (round 12, the user: "make it bigger by touching the minimap … the little blue things that stick out … in this
 *     corner can go away": the NE tick is gone, minimap.css), short end caps just past the N and E ticks; glass fill, a
 *     cyan hairline on the straight edges and the caps (the rim is the minimap's own border), a bracket on the corner;
 *   - the backpack glyph tucked into the outer corner, where the piece is widest;
 *   - an invisible hit shape: the piece grown by HIT_OUT outward (up and right, into the screen margin), so the target
 *     is ≥ 44 px across on a phone while a tap on the map itself still opens the MAP tab.
 * Styled by src/client/engine/ui/styles/minimap.css (prefix ws-minimap-). Pressed = `.down` (the minimap's pointerdown preventDefault
 * would swallow :active on iOS).
 */

/** minimap radius = 100: the straight edges (the square's half side: the tick tips reach ~111), the concave edge (ON the
 *  rim: the piece touches the minimap, round 12), where the piece ends short of the N and E ticks, the hit's outward reach */
const SIDE = 113, RIM = 100, END = 8, HIT_OUT = 26;
const f = (n: number): string => n.toFixed(2);
/** where each end cap meets the rim, measured along the axis (the centre is (0, SIDE) in the SVG) */
const RIM_AT_END = Math.sqrt(RIM * RIM - END * END);

/** the fill: the top-right quadrant of the square minus the circle — top edge from the N end to the corner, down the right
 *  edge to the E end, in to the rim, back along the rim (counter-clockwise on screen) */
function fillPath(): string {
  return `M${f(END)} 0 H${f(SIDE)} V${f(SIDE - END)} H${f(RIM_AT_END)} A${RIM} ${RIM} 0 0 0 ${f(END)} ${f(SIDE - RIM_AT_END)} Z`;
}
/** the hairline: both end caps and the two straight edges — not the rim, which is the minimap's own border (the shared edge) */
function edgePath(): string {
  return `M${f(END)} ${f(SIDE - RIM_AT_END)} V0 H${f(SIDE)} V${f(SIDE - END)} H${f(RIM_AT_END)}`;
}
/** the hit shape: the piece grown up and right into the screen margin */
function hitPath(): string {
  const o = SIDE + HIT_OUT;
  return `M${f(END)} ${f(-HIT_OUT)} H${f(o)} V${f(SIDE - END)} H${f(RIM_AT_END)} A${RIM} ${RIM} 0 0 0 ${f(END)} ${f(SIDE - RIM_AT_END)} Z`;
}

/** the backpack, drawn in a 64-unit box (it spans x 12–52, y 8–56): a small grab loop, a domed body (not the padlock's
 *  box + big shackle), the curved flap seam, a front pocket */
const PACK = `
  <path class="ws-minimap-bag-loop" d="M28 18 V13 A4 4 0 0 1 36 13 V18"/>
  <path class="ws-minimap-bag-body" d="M17 56 Q12 56 12 51 V33 C12 23 20 17 32 17 C44 17 52 23 52 33 V51 Q52 56 47 56 Z"/>
  <path class="ws-minimap-bag-seam" d="M12 34 C21 39 43 39 52 34"/>
  <rect class="ws-minimap-bag-seam" x="21" y="43" width="22" height="9" rx="2.5"/>`;
/** the glyph sits in the corner, PAD in from both straight edges, GLYPH tall — the most the piece holds before its
 *  lower-left corner meets the rim (the widest part of the piece is the corner, ~33 px deep on a phone) */
const PAD = 5, GLYPH = 37;

export class BagButton {
  readonly scope: ReturnType<typeof uiScope> = uiScope('BagButton');
  readonly root: HTMLButtonElement;

  constructor(minimap: HTMLElement, onTap: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws-minimap-bag';
    b.setAttribute('aria-label', 'Inventory');
    b.title = 'Inventory';
    const k = GLYPH / 48, tx = SIDE - PAD - k * 52, ty = PAD - k * 8; // glyph units → piece units, its top-right on the pad
    const box = SIDE + HIT_OUT;
    const bracket = 16;
    b.innerHTML = `<svg viewBox="0 ${f(SIDE - box)} ${f(box)} ${f(box)}" aria-hidden="true">
      <path class="ws-minimap-bag-hit" d="${hitPath()}"/>
      <path class="ws-minimap-bag-piece" d="${fillPath()}"/>
      <path class="ws-minimap-bag-edge" d="${edgePath()}"/>
      <path class="ws-minimap-bag-corner" d="M${f(SIDE - bracket)} 0 H${f(SIDE)} V${f(bracket)}"/>
      <g class="ws-minimap-bag-icon" transform="translate(${f(tx)} ${f(ty)}) scale(${f(k)})">${PACK}</g>
    </svg>`;
    // the minimap is itself a button (Map.bindMinimap: pointerdown swallowed, pointerup opens MAP): stop ours before it
    const up = () => { b.classList.remove('down'); };
    this.scope.listen(b, 'pointerdown', () => { b.classList.add('down'); });
    this.scope.listen(b, 'pointerup', (e) => { e.stopPropagation(); up(); onTap(); });
    this.scope.listen(b, 'pointercancel', up);
    this.scope.listen(b, 'pointerleave', up);
    this.scope.listen(b, 'click', (e) => { e.stopPropagation(); if (e.detail === 0) onTap(); }); // keyboard (Enter / Space) only
    this.root = b;
    minimap.classList.add('bag'); // the phone steps the circle in so the square clears the screen edge (minimap.css)
    mountUi(b, this.scope, minimap);
  }
}

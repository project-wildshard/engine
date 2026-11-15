/** The unchanged procedural road painters, shared by runtime fallback and the reproducible phone bake. */
import {CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace} from 'three';
import {GAP_HALF, RING_ISLAND, RING_OUTER, ROAD_HALF} from '../../../shared/game/grid/roadLayout';
import {putRoadGrain, roadGrainSteps, type RoadGrainSource} from './roadGrain';

export const WHITE = '#e9ebe6';
const YELLOW = '#e0b23a';
function canvas(w: number, h: number): {el: HTMLCanvasElement; g: CanvasRenderingContext2D} {
  const el = document.createElement('canvas'); el.width = w; el.height = h;
  const g = el.getContext('2d'); if (g === null) throw new Error('No 2D canvas for the road look');
  return {el, g};
}
function texture(el: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const t = new CanvasTexture(el); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; t.minFilter = LinearMipmapLinearFilter;
  if (repeat) { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; }
  return t;
}

/** The road canvas: u [0, 0.5) the normal section, [0.5, 1) the turn-in section; v one 12 m period of dashes. */
export const ROAD_PERIOD = 12;
export function* roadTextureSteps(grain?: RoadGrainSource): Generator<void, CanvasTexture> {
  const W = 1024, H = 512, { el, g } = canvas(W, H);
  const plane = grain?.('asphalt');
  if (plane === undefined) yield* roadGrainSteps(g, W, H, 1); else putRoadGrain(g, 'asphalt', plane);
  const half = W / 2, px = (t: number, base: number): number => base + (t + ROAD_HALF) / (2 * ROAD_HALF) * half, pm = half / (2 * ROAD_HALF);
  for (const base of [0, half]) {
    const turnIn = base > 0;
    // wheel paths: faint darker wear in each lane
    g.fillStyle = 'rgba(20,22,26,0.07)';
    for (const t of [-5.9, -4.3, -2.6, -1.0, 1.0, 2.6, 4.3, 5.9]) g.fillRect(px(t, base) - 0.45 * pm, 0, 0.9 * pm, H);
    g.fillStyle = YELLOW; // the double yellow centre line (G80)
    for (const t of [-0.17, 0.17]) g.fillRect(px(t, base) - 0.06 * pm, 0, 0.12 * pm, H);
    g.fillStyle = WHITE; // lane dividers: 3 m dash in a 12 m period
    for (const t of [-3.55, 3.55]) g.fillRect(px(t, base) - 0.06 * pm, 0, 0.12 * pm, H * 3 / ROAD_PERIOD);
    for (const t of [-7.0, 7.0]) { // edge lines; at a turn-in, short dashes so the opening reads
      if (!turnIn) g.fillRect(px(t, base) - 0.075 * pm, 0, 0.15 * pm, H);
      else for (let k = 0; k < 6; k++) g.fillRect(px(t, base) - 0.075 * pm, k * H / 6, 0.15 * pm, H / 12);
    }
  }
  return texture(el, true);
}

/** The junction canvas: 62.5 m square; the roundabout's markings in the middle, plain asphalt in the corners. */
export function* junctionTextureSteps(grain?: RoadGrainSource): Generator<void, CanvasTexture> {
  const W = 1024, { el, g } = canvas(W, W), k = W / (2 * GAP_HALF);
  const plane = grain?.('junction');
  if (plane === undefined) yield* roadGrainSteps(g, W, W, 2); else putRoadGrain(g, 'junction', plane);
  const P = (x: number, z: number): [number, number] => [(x + GAP_HALF) * k, (GAP_HALF - z) * k];
  const arc = (r: number, a0: number, a1: number, width: number, colour: string, dash?: readonly [number, number]): void => {
    g.strokeStyle = colour; g.lineWidth = width * k; g.setLineDash(dash === undefined ? [] : [dash[0] * k, dash[1] * k]);
    const [cx, cy] = P(0, 0); g.beginPath(); g.arc(cx, cy, r * k, -a1, -a0); g.stroke(); g.setLineDash([]);
  };
  const open = Math.asin((ROAD_HALF + 0.3) / (RING_OUTER - 0.5));
  for (let q = 0; q < 4; q++) arc(RING_OUTER - 0.5, q * Math.PI / 2 + open, (q + 1) * Math.PI / 2 - open, 0.15, WHITE); // outer edge line between the arms
  arc(RING_ISLAND + 0.45, 0, Math.PI * 2, 0.15, WHITE); // inner edge line
  arc((RING_ISLAND + RING_OUTER) / 2, 0, Math.PI * 2, 0.12, WHITE, [3, 3]); // the circulating lane divider
  const sides: readonly { x: number; z: number }[] = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
  for (const d of sides) {
    const rx = -d.z, rz = d.x; // the across unit
    const line = (t: number, r0: number, r1: number, width: number, colour: string, dash = 0): void => {
      g.fillStyle = colour;
      for (let r = r0; r < r1; r += dash > 0 ? dash * 4 : r1 - r0) {
        const e = Math.min(r1, r + (dash > 0 ? dash : r1 - r0)), [ax, ay] = P(d.x * r + rx * (t - width / 2), d.z * r + rz * (t - width / 2)), [bx, by] = P(d.x * e + rx * (t + width / 2), d.z * e + rz * (t + width / 2));
        g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      }
    };
    for (const t of [-0.17, 0.17]) line(t, RING_OUTER + 3, GAP_HALF, 0.12, YELLOW);
    for (const t of [-3.55, 3.55]) line(t, RING_OUTER + 3, GAP_HALF, 0.12, WHITE, 3);
    for (const t of [-7.0, 7.0]) line(t, RING_OUTER + 0.5, GAP_HALF, 0.15, WHITE);
    // give way: the entry half is on the inbound traveller's right (three's mirrored frame: −across), dashed, a triangle per lane
    const entry = -1;
    for (let t = 0.4; t < 6.9; t += 0.9) line(entry * (t + 0.3), RING_OUTER + 0.9, RING_OUTER + 1.2, 0.6, WHITE);
    for (const t of [1.8, 5.3]) {
      const tip = RING_OUTER + 2.2, base = tip + 2.6, [ax, ay] = P(d.x * tip + rx * t * entry, d.z * tip + rz * t * entry);
      const [bx, by] = P(d.x * base + rx * (t * entry + 0.7), d.z * base + rz * (t * entry + 0.7)), [cx, cy] = P(d.x * base + rx * (t * entry - 0.7), d.z * base + rz * (t * entry - 0.7));
      g.strokeStyle = WHITE; g.lineWidth = 0.15 * k; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.closePath(); g.stroke();
    }
  }
  return texture(el, false);
}

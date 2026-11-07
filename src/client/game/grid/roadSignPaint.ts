import type { RoadSign, SignLine } from '../../../shared/game/grid/roadLayout';

export const SIGN_LINE_W = 512, SIGN_LINE_H = 64;
export interface RoadSignPaintLayout {
  readonly keys: readonly string[]; readonly lines: ReadonlyMap<string, SignLine>; readonly width: number; readonly height: number;
  readonly slot: (index: number) => [number, number];
}
export type RoadSignSource = (layout: RoadSignPaintLayout) => Uint8Array<ArrayBuffer> | undefined;
export function roadSignLineKey(line: SignLine): string { return `${line.arrow}|${line.names.join(' · ')}|${line.metres === null ? '' : String(line.metres)}`; }
/** Original first-key ordering and last matching line, without canvas or renderer state. */
export function roadSignPaintLayout(signs: readonly Pick<RoadSign, 'lines'>[]): RoadSignPaintLayout {
  const keys = [...new Set(signs.flatMap(s => s.lines.map(roadSignLineKey)))], lines = new Map<string, SignLine>();
  for (const sign of signs) for (const line of sign.lines) lines.set(roadSignLineKey(line), line);
  const width = 1024, perRow = width / SIGN_LINE_W, height = Math.ceil((keys.length + 1) / perRow) * SIGN_LINE_H;
  return { keys, lines, width, height, slot: k => [(k % perRow) * SIGN_LINE_W, Math.floor(k / perRow) * SIGN_LINE_H] };
}
/** Exact original commands, font, coordinates and canvas state on either native 2D surface. */
export function paintRoadSignCanvas(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, atlas: RoadSignPaintLayout): void {
  const { keys, lines, slot, width: W, height: H } = atlas, LINE_W = SIGN_LINE_W, LINE_H = SIGN_LINE_H, WHITE = '#e9ebe6';
  g.fillStyle = '#0d6b3c'; g.fillRect(0, 0, W, H);
  keys.forEach((key, k) => {
    const line = lines.get(key); if (line === undefined) return;
    const [x, y] = slot(k), mid = y + LINE_H / 2;
    g.fillStyle = WHITE; g.strokeStyle = WHITE; g.lineWidth = 6;
    const ax = line.arrow === 'right' ? x + LINE_W - 40 : x + 28;
    g.beginPath();
    if (line.arrow === 'ahead') { g.moveTo(ax, mid + 18); g.lineTo(ax, mid - 14); g.moveTo(ax - 12, mid - 4); g.lineTo(ax, mid - 18); g.lineTo(ax + 12, mid - 4); }
    else { const s = line.arrow === 'left' ? -1 : 1; g.moveTo(ax - s * 16, mid); g.lineTo(ax + s * 16, mid); g.moveTo(ax + s * 4, mid - 12); g.lineTo(ax + s * 18, mid); g.lineTo(ax + s * 4, mid + 12); }
    g.stroke();
    const text = line.names.join(' · ').toUpperCase(), dist = line.metres === null ? '' : `${String(line.metres)} M`, left = line.arrow === 'right' ? x + 18 : x + 64, right = line.arrow === 'right' ? x + LINE_W - 72 : x + LINE_W - 18;
    g.font = '600 34px "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle';
    const dw = g.measureText(dist).width, room = right - left - dw - 22, tw = g.measureText(text).width;
    g.save(); g.translate(left, mid); g.scale(Math.min(1, room / Math.max(1, tw)), 1); g.textAlign = 'left'; g.fillText(text, 0, 2); g.restore();
    g.textAlign = 'right'; g.fillText(dist, right, 2);
  });
  const [sx, sy] = slot(keys.length);
  g.fillStyle = WHITE; g.fillRect(sx + 128, sy, 64, SIGN_LINE_H);
}

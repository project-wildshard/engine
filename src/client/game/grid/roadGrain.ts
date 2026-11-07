/** Identical grain commands on a DOM canvas or its worker-owned offscreen counterpart. */
export type RoadGrainContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;
export type RoadGrainKind = 'asphalt' | 'junction';
export const ROAD_GRAIN_PLANES = {
  asphalt: { width: 1024, height: 512, seed: 1 },
  junction: { width: 1024, height: 1024, seed: 2 },
} as const;
export interface RoadGrainPixels { readonly pixels: Uint8ClampedArray<ArrayBuffer>; readonly fillStyle: string }
export type RoadGrainSource = (kind: RoadGrainKind) => RoadGrainPixels | undefined;

function hash(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
const GRAIN_SPECKS_PER_STEP = 2048;

/** Original arithmetic, strings, blend order and yield points; return its final canvas state too. */
export function* roadGrainSteps(g: RoadGrainContext, w: number, h: number, seed: number): Generator<void, string> {
  g.fillStyle = '#3a3c40'; g.fillRect(0, 0, w, h);
  const count = Math.round(w * h / 18); let style = '#3a3c40';
  for (let k = 0; k < count; k++) {
    if (k > 0 && k % GRAIN_SPECKS_PER_STEP === 0) yield;
    const r = hash(seed + k * 3.1), x = hash(seed + k * 7.7) * w, y = hash(seed + k * 1.3) * h, l = r < 0.5 ? 30 + r * 30 : 70 + r * 40;
    style = `rgba(${String(l)},${String(l + 2)},${String(l + 6)},0.55)`;
    g.fillStyle = style; g.fillRect(x, y, 1 + (r > 0.92 ? 1 : 0), 1);
  }
  return style;
}

/** Restore exact opaque RGBA8 words before the unchanged lane/roundabout painting commands. */
export function putRoadGrain(g: CanvasRenderingContext2D, kind: RoadGrainKind, plane: RoadGrainPixels): void {
  const { width, height } = ROAD_GRAIN_PLANES[kind];
  if (plane.pixels.length !== width * height * 4) throw new Error('Road grain plane size differs');
  g.putImageData(new ImageData(plane.pixels, width, height), 0, 0); g.fillStyle = plane.fillStyle;
}

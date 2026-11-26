// STAGING-BUGBASH SB48 (P0, Jake 2026-11-18 12:07 Cancún, staging v0.1.43): Driftwood played with the HUD over a completely
// black world on his iPhone, and no smoke check looked at the world itself. This reads a play frame's world, with no golden
// image: the middle of the screen (between the HUD's top row and the touch controls) must hold a drawn world, not the page's
// own background (#050810, what shows through a hidden or empty canvas) and not a flat dark fill.
import sharp from 'sharp';

/** The page background behind the canvas (index.html `html, body { background: #050810 }`). */
export const PAGE_BG = Object.freeze([5, 8, 16]);
/** The world region, as fractions of the frame: the middle 60 % across, 25 %..65 % down (on a 402x874 phone that clears
 *  the minimap and quest row above and the chat, stick and buttons below; a HUD panel inside it is DOM, small and lit). */
export const REGION = Object.freeze({ x0: 0.2, x1: 0.8, y0: 0.25, y1: 0.65 });
/** A drawn world is never this dark and this flat at once: Driftwood's sky and sea read mean ~140 sd ~35, Pine's forest
 *  ~90 sd ~40, the darkest night cell is still textured. Jake's black frame: mean 8, sd 4.7, 99.9 % page background. */
export const BLACK_MEAN = 24;
export const FLAT_SD = 6;
/** Over this share of the region showing the page background, the canvas is not drawing (hidden, lost or cleared). */
export const PAGE_BG_SHARE = 0.5;
/** ...and the region that flat: a night sky near #050810 over a lit, textured ground is a drawn world (Jake's frame: sd 4.7). */
export const BG_SD = 12;

/** @typedef {{ mean: number, sd: number, pageBg: number, pixels: number }} WorldStats */

/** @param {number} v @param {number} [places] */
const round = (v, places = 1) => Number(v.toFixed(places));

/**
 * Luminance mean, spread and page-background share of the world region of an RGB(A) frame.
 * @param {Uint8Array | Uint8ClampedArray | Buffer} data @param {number} width @param {number} height @param {number} channels
 * @returns {WorldStats}
 */
export function worldStats(data, width, height, channels) {
  const x0 = Math.floor(width * REGION.x0), x1 = Math.ceil(width * REGION.x1), y0 = Math.floor(height * REGION.y0), y1 = Math.ceil(height * REGION.y1);
  let n = 0, sum = 0, sq = 0, bg = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * channels, r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++; sum += l; sq += l * l;
      // JPEG keeps a flat fill within a few levels
      if (Math.abs(r - PAGE_BG[0]) <= 4 && Math.abs(g - PAGE_BG[1]) <= 4 && Math.abs(b - PAGE_BG[2]) <= 4) bg++;
    }
  }
  const mean = n === 0 ? 0 : sum / n;
  return { mean: round(mean), sd: round(Math.sqrt(Math.max(0, n === 0 ? 0 : sq / n - mean * mean))), pageBg: round(n === 0 ? 0 : bg / n, 3), pixels: n };
}

/**
 * Why a frame's world is not drawn, or null when it is.
 * @param {WorldStats} s @returns {string | null}
 */
export function blackWorld(s) {
  if (s.pixels === 0) return 'the frame has no world region';
  if (s.pageBg >= PAGE_BG_SHARE && s.sd < BG_SD) return `the page background shows through ${String(Math.round(s.pageBg * 100))}% of the world region (canvas hidden, lost or empty)`;
  if (s.mean < BLACK_MEAN && s.sd < FLAT_SD) return `the world region is a flat dark fill (mean luminance ${String(s.mean)}, sd ${String(s.sd)})`;
  return null;
}

/** Judge a frame (jpeg or png). @param {string | Buffer} image @returns {Promise<{ stats: WorldStats, black: string | null }>} */
export async function judgeFrame(image) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats = worldStats(data, info.width, info.height, info.channels);
  return { stats, black: blackWorld(stats) };
}

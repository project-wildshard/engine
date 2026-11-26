// Generated from the JSDoc in the .mjs beside it (meta STAGING-SMOKE): npx tsc --ignoreConfig <the .mjs files> --allowJs --declaration --emitDeclarationOnly
/* oxlint-disable typescript/consistent-type-definitions -- tsc's declaration output */
/** @typedef {{ mean: number, sd: number, pageBg: number, pixels: number }} WorldStats */
/**
 * Luminance mean, spread and page-background share of the world region of an RGB(A) frame.
 * @param {Uint8Array | Uint8ClampedArray | Buffer} data @param {number} width @param {number} height @param {number} channels
 * @returns {WorldStats}
 */
export function worldStats(data: Uint8Array | Uint8ClampedArray | Buffer, width: number, height: number, channels: number): WorldStats;
/**
 * Why a frame's world is not drawn, or null when it is.
 * @param {WorldStats} s @returns {string | null}
 */
export function blackWorld(s: WorldStats): string | null;
/** Judge a frame (jpeg or png). @param {string | Buffer} image @returns {Promise<{ stats: WorldStats, black: string | null }>} */
export function judgeFrame(image: string | Buffer): Promise<{
    stats: WorldStats;
    black: string | null;
}>;
/** The page background behind the canvas (index.html `html, body { background: #050810 }`). */
export const PAGE_BG: readonly number[];
/** The world region, as fractions of the frame: the middle 60 % across, 25 %..65 % down (on a 402x874 phone that clears
 *  the minimap and quest row above and the chat, stick and buttons below; a HUD panel inside it is DOM, small and lit). */
export const REGION: Readonly<{
    x0: 0.2;
    x1: 0.8;
    y0: 0.25;
    y1: 0.65;
}>;
/** A drawn world is never this dark and this flat at once: Driftwood's sky and sea read mean ~140 sd ~35, Pine's forest
 *  ~90 sd ~40, the darkest night cell is still textured. Jake's black frame: mean 8, sd 4.7, 99.9 % page background. */
export const BLACK_MEAN: 24;
export const FLAT_SD: 6;
/** Over this share of the region showing the page background, the canvas is not drawing (hidden, lost or cleared). */
export const PAGE_BG_SHARE: 0.5;
/** ...and the region that flat: a night sky near #050810 over a lit, textured ground is a drawn world (Jake's frame: sd 4.7). */
export const BG_SD: 12;
export type WorldStats = {
    mean: number;
    sd: number;
    pageBg: number;
    pixels: number;
};

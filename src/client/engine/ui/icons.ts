/**
 * icons — inline SVG glyphs for the in-game menu (src/client/engine/ui/Menu.ts): the engine's UI glyphs here, and a registry the
 * content icons join (the game's creatures, items and weapons: src/client/game/icons.ts). Everything is `currentColor` so the CSS sets the tint;
 * every glyph is drawn in a 64×64 box from primitives (no artwork files to load).
 *
 *   icon('lock')  → '<svg …>…</svg>'
 */
/** The icon ids: the engine's UI glyphs; a content library merges its own in (the game's, src/client/game/icons.ts: creatures, items,
 *  weapons; E405: the engine names no content) with `declare module '@wildshard/engine' { interface IconMap { … } }`. */
export interface IconMap { lock: true; check: true; poi: true; you: true; map: true; pack: true; star: true; book: true; heart: true; pin: true; laurel: true }
export type IconId = keyof IconMap;

const wrap = (body: string, extra = '') => `<svg viewBox="0 0 64 64" fill="currentColor" stroke="none" ${extra}>${body}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

/** a row of legs: side-view creatures stand on y≈56 */
const legs: (xs: number[], top: number, h: number, w?: number) => string = (xs: number[], top: number, h: number, w = 3.2) => xs.map((x) => `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="1"/>`).join('');

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

/* ── glyphs ── */
const LAUREL = `
  <path d="M18 14 C6 24 8 44 20 54 M46 14 C58 24 56 44 44 54" ${S} stroke-width="2.4"/>
  <path d="M12 26 C8 30 8 34 12 36 C16 32 16 28 12 26 Z M10 36 C6 40 8 46 12 46 C16 42 14 38 10 36 Z M16 46 C14 52 18 56 22 54 C22 50 20 46 16 46 Z M52 26 C56 30 56 34 52 36 C48 32 48 28 52 26 Z M54 36 C58 40 56 46 52 46 C48 42 50 38 54 36 Z M48 46 C50 52 46 56 42 54 C42 50 44 46 48 46 Z"/>
  <path d="M32 18 L36 27 L46 28 L38 34 L41 44 L32 39 L23 44 L26 34 L18 28 L28 27 Z"/>`;

const LOCK = `
  <rect x="16" y="28" width="32" height="26" rx="3"/>
  <path d="M22 28 V20 A10 10 0 0 1 42 20 V28" ${S} stroke-width="5"/>`;

const CHECK = `<path d="M12 34 L26 48 L54 18" ${S} stroke-width="7"/>`;
const POI = `<circle cx="32" cy="32" r="12"/>`;
const YOU = `<path d="M32 8 L50 52 L32 42 L14 52 Z"/>`;

/* ── the Bag (E314): tab icons, GEAR's slots, FINDS' stickers ── */
const MAP = `
  <path d="M6 14 L22 8 L42 14 L58 8 L58 50 L42 56 L22 50 L6 56 Z" ${S} stroke-width="3.6"/>
  <path d="M22 8 L22 50 M42 14 L42 56" ${S} stroke-width="3"/>`;
const PACK = `
  <path d="M22 18 C22 8 42 8 42 18" ${S} stroke-width="4"/>
  <path d="M12 26 C12 20 16 18 22 18 L42 18 C48 18 52 20 52 26 L54 54 C54 57 52 58 49 58 L15 58 C12 58 10 57 10 54 Z"/>
  <rect x="20" y="34" width="24" height="12" rx="2" fill="#0b1520" opacity="0.55"/>`;
const STAR = `<path d="M32 5 L39.5 23 L59 24.5 L44 37 L48.5 56 L32 45.5 L15.5 56 L20 37 L5 24.5 L24.5 23 Z"/>`;
const BOOK = `
  <path d="M8 14 C16 10 26 10 31 16 L31 56 C26 50 16 50 8 54 Z M56 14 C48 10 38 10 33 16 L33 56 C38 50 48 50 56 54 Z"/>`;
const HEART = `<path d="M32 56 C20 46 6 36 6 22 C6 12 14 6 22 6 C27 6 30 9 32 13 C34 9 37 6 42 6 C50 6 58 12 58 22 C58 36 44 46 32 56 Z"/>`;
const PIN = `<path fill-rule="evenodd" d="M32 60 C22 46 12 36 12 24 C12 12 21 4 32 4 C43 4 52 12 52 24 C52 36 42 46 32 60 Z ${circle(32, 24, 8)}"/>`;

const SVG = new Map<string, string>(Object.entries({
  lock: LOCK, check: CHECK, poi: POI, you: YOU, map: MAP, pack: PACK, star: STAR, book: BOOK, heart: HEART, pin: PIN, laurel: LAUREL,
}).map(([id, body]) => [id, wrap(body)]));

/** a content library's icons, full SVGs by id (the game's installKitIcons) */
export function registerIcons(table: Partial<Readonly<Record<IconId, string>>>): void {
  for (const [id, svg] of Object.entries(table)) SVG.set(id, svg);
}

/** the icon's SVG; an id nothing registered draws an empty box */
export function icon(id: IconId): string { return SVG.get(id) ?? wrap(''); }

/** the pieces a content icon is drawn from: the 64×64 SVG frame, the stroke attributes, legs and circles */
export const iconParts: { readonly svg: (body: string, extra?: string) => string; readonly stroke: "fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\""; readonly legs: (xs: number[], top: number, h: number, w?: number) => string; readonly circle: (cx: number, cy: number, r: number) => string; } = { svg: wrap, stroke: S, legs, circle } as const;

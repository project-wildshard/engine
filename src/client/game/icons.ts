import type { BagIcons } from './bag/tabs';
import { iconParts, registerIcons } from '@wildshard/engine/ui/icons';

/**
 * The game's content icons (moved from the engine, E405 LAYER-PURITY, then from the kit, SF54): the creatures, the pack
 * items, the weapons and the Bag's GEAR / FINDS stickers, drawn in the engine's 64×64 frame (`iconParts`). installKitIcons
 * registers them (the name keeps the shipped kit.* content vocabulary); a level that needs one names its id.
 */

const { svg, stroke: S, legs, circle } = iconParts;

const DEER = `
  <ellipse cx="37" cy="35" rx="16" ry="8.5"/>
  <path d="M25 31 L20 16 L27 15 L31 30 Z"/>
  <ellipse cx="20" cy="15" rx="6.5" ry="4"/>
  <path d="M15 13 L12 6 L17 11 Z"/>
  <path d="M25 12 L27 7 L29 12 Z"/>
  <path d="M20 12 L17 3 M20 12 L23 2 M17 3 L14 4 M18.5 7 L15 6 M23 2 L26 1 M21.5 6 L25 5" ${S} stroke-width="1.8"/>
  <path d="M52 30 L56 26 L55 31 Z"/>
  ${legs([24, 30, 43, 49], 40, 17)}`;

const ELK = `
  <ellipse cx="38" cy="36" rx="17" ry="9.5"/>
  <path d="M24 32 L18 15 L27 13 L32 30 Z"/>
  <path d="M22 26 L19 34 L26 31 Z"/>
  <ellipse cx="19" cy="14" rx="7" ry="4.5"/>
  <path d="M13 12 L9 6 L15 10 Z"/>
  <path d="M18 11 C12 8 8 3 6 -2 M18 11 C15 5 13 1 14 -3 M18 11 L24 -1 M20 5 L17 2 M22 2 L19 -1 M13 5 L9 4 M11 8 L6 8 M22 4 L25 1" ${S} stroke-width="2.2"/>
  ${legs([23, 30, 45, 52], 42, 17, 3.6)}`;

const BOAR = `
  <path d="M14 34 C12 24 24 20 36 20 C50 20 58 26 57 36 C56 44 48 46 36 46 C24 46 15 44 14 34 Z"/>
  <path d="M15 30 L6 35 L8 42 L16 42 Z"/>
  <path d="M7 40 L3 44 L6 44.5 Z"/>
  <path d="M30 20 L33 16 L36 20 Z M40 20 L43 16 L46 20 Z"/>
  <path d="M8 43.5 C9 46.5 12 47 14 45" ${S} stroke-width="2"/>
  <path d="M57 30 L61 26 L60 33 Z"/>
  ${legs([18, 25, 41, 48], 43, 14, 3.4)}`;

const BEAR = `
  <path d="M8 30 C6 24 10 20 16 20 L20 20 C24 14 34 12 44 14 C54 16 60 24 58 34 C57 42 52 46 44 46 L20 46 C12 46 8 40 8 30 Z"/>
  <path d="M10 22 C6 22 4 26 5 30 C7 33 12 33 14 30 L20 30 L20 36 C16 40 10 38 8 34 Z"/>
  <path d="M4 32 L1 36 L5 36.5 Z"/>
  <circle cx="14" cy="18" r="3.2"/><circle cx="21" cy="15" r="3"/>
  ${legs([16, 24, 40, 48], 44, 13, 5.2)}`;

const LEOPARD = `
  <ellipse cx="34" cy="37" rx="18" ry="7"/>
  <circle cx="13" cy="31" r="6"/>
  <path d="M15 28 L25 32 L23 40 L14 35 Z"/>
  <path d="M8 27 L9 21 L13 25 Z M15 25 L18 20 L19 26 Z"/>
  <path d="M51 35 C59 37 62 45 58 52 C55 57 49 55 50 51" ${S} stroke-width="3.6"/>
  ${legs([20, 26, 42, 48], 40, 16, 3.4)}`;

const WOLF = `
  <ellipse cx="36" cy="34" rx="17" ry="7.5"/>
  <path d="M24 30 L17 19 L25 16 L31 29 Z"/>
  <path d="M23 15 L6 20 L8 24 L25 24 Z"/>
  <path d="M17 17 L18 8 L22 15 Z M22 16 L25 8 L26 16 Z"/>
  <path d="M52 30 C58 33 62 40 61 48 C57 43 54 39 50 37 Z"/>
  ${legs([24, 29, 44, 49], 38, 18, 2.8)}`;

const EAGLE = `
  <path d="M32 22 C26 17 15 13 1 14 C6 17 8 19 9 22 L6 23 C12 25 20 27 28 33 Z"/>
  <path d="M32 22 C38 17 49 13 63 14 C58 17 56 19 55 22 L58 23 C52 25 44 27 36 33 Z"/>
  <ellipse cx="32" cy="32" rx="5.5" ry="11"/>
  <circle cx="32" cy="18" r="4.4"/>
  <path d="M27 41 L32 55 L37 41 Z"/>`;

const HORSE_BODY = `
  <ellipse cx="38" cy="36" rx="16" ry="8.5"/>
  <path d="M26 33 L17 16 L25 14 L32 31 Z"/>
  <path d="M19 13 L6 22 L9 26 L24 17 Z"/>
  <path d="M19 13 L20 7 L23 13 Z"/>
  <path d="M53 32 C58 35 60 43 58 53 C55 47 53 41 51 38 Z"/>
  ${legs([25, 31, 44, 50], 42, 15, 3.2)}`;
const HORSE = HORSE_BODY;

const RIDER = `
  <g transform="translate(0 4)">${HORSE_BODY}</g>
  <path d="M34 34 L33 20 L41 20 L42 34 Z"/>
  <circle cx="37" cy="14" r="4.4"/>
  <path d="M33 22 L24 12 L22 14 L31 26 Z"/>`;

/* ── items ── */
const MEAT = `
  <path d="M12 34 C10 22 22 14 36 16 C50 18 56 28 52 40 C48 50 32 52 22 48 C14 45 13 40 12 34 Z"/>
  <path d="M22 30 C24 26 30 26 34 30 C38 34 38 40 34 42" ${S} stroke-width="3" opacity="0.45"/>
  <path d="M44 20 L54 10 M50 8 L56 14" ${S} stroke-width="4"/>`;

const HIDE = `
  <path d="M10 14 C16 18 20 16 22 12 L26 20 C30 18 34 18 38 20 L42 12 C44 16 48 18 54 14 C50 22 50 28 52 34 C50 40 52 46 56 52 C50 50 46 50 42 54 L38 46 C34 48 30 48 26 46 L22 54 C18 50 14 50 8 52 C12 46 14 40 12 34 C14 28 14 22 10 14 Z"/>`;

const TUSK = `
  <path d="M14 52 C10 36 18 18 34 10 C40 7 48 8 52 12 C42 14 30 24 26 38 C24 46 20 52 14 52 Z"/>`;

const ANTLERS = `
  <path d="M32 58 L32 30 M32 30 C22 28 14 20 12 8 M32 30 C42 28 50 20 52 8 M22 26 L16 18 M42 26 L48 18 M18 16 L10 14 M46 16 L54 14 M27 29 L24 36 M37 29 L40 36" ${S} stroke-width="3.5"/>`;

const CLAW = `
  <path d="M6 58 L20 42 L26 48 L10 62 Z"/>
  <ellipse cx="30" cy="37" rx="15" ry="11" transform="rotate(-40 30 37)"/>
  <path d="M26 28 C30 14 42 5 56 5 C50 11 44 18 40 30 Z"/>
  <path d="M40 42 C48 38 56 30 60 18 C62 32 54 44 42 48 Z"/>`;

const SHELL = `
  <path d="M6 36 C8 24 19 18 32 18 C45 18 56 24 58 36 C56 46 46 52 32 52 C18 52 8 46 6 36 Z"/>
  <path d="M8 32 L1 28 L7 38 Z M56 32 L63 28 L57 38 Z M12 24 L8 16 L17 21 Z M52 24 L56 16 L47 21 Z M20 50 L16 58 L25 52 Z M44 50 L48 58 L39 52 Z"/>
  <path d="M25 18 L24 11 M39 18 L40 11" ${S} stroke-width="2.4"/>
  <circle cx="24" cy="10" r="3"/><circle cx="40" cy="10" r="3"/>`;

const COCONUT = `
  <path fill-rule="evenodd" d="${circle(32, 36, 22)} ${circle(25, 28, 3)} ${circle(37, 26, 3)} ${circle(31, 37, 3)}"/>
  <path d="M28 14 L24 6 M32 14 L32 4 M36 14 L40 6" ${S} stroke-width="2.4"/>`;

const COIN = `
  <path fill-rule="evenodd" d="M32 8 C46 7 57 18 56 32 C57 46 46 57 32 56 C18 57 7 46 8 32 C7 18 18 7 32 8 Z ${circle(32, 32, 18)} ${circle(32, 32, 15)} M29 20 H35 V29 H44 V35 H35 V44 H29 V35 H20 V29 H29 Z"/>`;

const SEAGLASS = `
  <path fill-rule="evenodd" d="M8 38 L16 20 L34 12 L50 20 L52 38 L38 50 L18 50 Z M20 24 L30 19 L25 30 Z"/>
  <path d="M42 50 L50 42 L60 46 L58 56 L48 58 Z"/>`;

const ROPE = `
  <path d="M28 32 A4 4 0 0 1 36 32 A8 8 0 0 1 20 32 A12 12 0 0 1 44 32 A16 16 0 0 1 12 32 A20 20 0 0 1 52 32 C52 42 56 50 60 56" ${S} stroke-width="4.2"/>
  <path d="M58 54 L62 60 M60 52 L64 57" ${S} stroke-width="1.8"/>`;

const WHETSTONE = `
  <path fill-rule="evenodd" transform="rotate(-24 32 36)" d="M11 29 H53 Q58 29 58 34 V39 Q58 44 53 44 H11 Q6 44 6 39 V34 Q6 29 11 29 Z M12 35.5 H52 V37.5 H12 Z"/>
  <path d="M24 25 L20 17 M31 22 L32 13 M38 20 L44 13" ${S} stroke-width="2.6"/>`;

const CHART = `
  <path fill-rule="evenodd" d="M7 14 C17 10 25 18 33 14 C41 10 49 14 57 12 V50 C49 54 41 48 33 52 C25 56 17 50 7 52 Z
    ${circle(15, 42, 2.3)} ${circle(22, 36, 2.3)} ${circle(29, 33, 2.3)} ${circle(36, 29, 2.3)}
    M41 19 L44 16 L47 19 L50 16 L53 19 L50 22 L53 25 L50 28 L47 25 L44 28 L41 25 L44 22 Z"/>`;

const BEARCLAW = `
  <path d="M20 54 C15 38 19 21 31 11 C39 5 51 5 57 9 C47 11 39 17 35 27 C31 37 31 46 33 54 Z"/>
  <path d="M13 61 C11 53 16 47 25 47 C34 47 39 53 37 61 Z"/>`;

const BOARTUSK = `
  <path fill-rule="evenodd" d="M16 54 C11 37 19 18 35 10 C41 7 49 8 53 12 C43 14 31 24 27 38 C25 46 22 52 16 54 Z
    M13 43.5 L26 46.5 L25.5 49 L13.2 46.2 Z M14.5 37.5 L27.5 40.5 L27.2 43 L14 40.2 Z"/>
  <path d="M16 54 C10 60 4 54 8 48" ${S} stroke-width="2.2"/>`;

const BOLT = `
  <path d="M8 56 L52 12" ${S} stroke-width="3.5"/>
  <path d="M52 12 L58 6 L54 16 Z"/>
  <path d="M10 46 L18 52 M14 42 L22 48 M6 50 L14 56" ${S} stroke-width="2.5"/>`;

/* ── weapons, side profile ── */
const CROSSBOW = `
  <path d="M6 38 L46 26 L58 26 L58 32 L48 34 L10 44 Z"/>
  <path d="M40 22 C44 8 52 4 60 6 M40 34 C44 48 52 52 60 50" ${S} stroke-width="3.5"/>
  <path d="M60 6 L46 28 L60 50" ${S} stroke-width="1.4"/>
  <path d="M8 44 L6 52 L11 52 L13 44 Z"/>
  <rect x="26" y="26" width="30" height="3" rx="1"/>`;

/* straight arming sword, point up-right like the bolt: pommel · wrapped grip · crossguard · fullered blade */
const SWORD = `
  <g transform="rotate(-45 32 32) translate(32 32) scale(1.12) translate(-32 -32)">
    <circle cx="5" cy="32" r="4.2"/>
    <rect x="8" y="29" width="11" height="6" rx="1.4"/>
    <path d="M18 21 L23.5 23 L23.5 41 L18 43 Z"/>
    <path fill-rule="evenodd" d="M23.5 27.5 L52 27.5 L61.5 32 L52 36.5 L23.5 36.5 Z M27 31 L49 31 L49 33 L27 33 Z"/>
  </g>`;

const RIFLE = `
  <path d="M4 30 L18 30 L20 26 L44 26 L44 30 L62 30 L62 33 L44 33 L44 36 L30 36 L26 44 L20 44 L22 36 L18 36 L16 40 L6 40 Z"/>
  <rect x="32" y="36" width="7" height="12" rx="1" transform="skewX(-14)"/>
  <rect x="22" y="22" width="20" height="4" rx="1"/>
  <path d="M48 26 L48 22 L50 22 L50 30" ${S} stroke-width="1.5"/>`;

/* a lever-action rifle: a straight-grip stock, the receiver, the barrel over its magazine tube, the loop lever */
const LEVER = `
  <path d="M3 35 L9 30 L21 30 L23 28 L34 28 L34 30 L62 30 L62 32.6 L34 32.6 L34 34.6 L58 34.6 L58 36.8 L34 36.8 L30 38 L21 38 L11 44 L3 44 Z"/>
  <path d="M25 38 C24 46 35 46 33 37.6" ${S} stroke-width="2.4"/>
  <rect x="55" y="27.4" width="1.8" height="3"/>`;

/* the Warden's Longbow (PH-C11): a tall stave, its string, an arrow on it */
const LONGBOW = `
  <path d="M16 5 C42 16 42 48 16 59" ${S} stroke-width="4.2"/>
  <path d="M16 5 L16 59" ${S} stroke-width="1.2"/>
  <path d="M9 32 L55 32" ${S} stroke-width="2.2"/>
  <path d="M53 27.5 L61 32 L53 36.5 Z"/>
  <path d="M10 32 L5 27.5 M10 32 L5 36.5 M14 32 L9 27.5 M14 32 L9 36.5" ${S} stroke-width="1.6"/>`;

/* a tricorn hat */
const HAT = `
  <path d="M4 38 C12 30 20 18 32 18 C44 18 52 30 60 38 C50 44 42 40 32 44 C22 40 14 44 4 38 Z"/>
  <path d="M22 22 C24 10 40 10 42 22 Z"/>
  <path d="M28 30 L36 36 M36 30 L28 36" stroke="#0b1520" stroke-width="2.4" stroke-linecap="round" fill="none" opacity="0.7"/>`;

/* a sailcloth cape on its clasp */
const CAPE = `
  <path d="M18 10 L46 10 L52 28 L58 56 C48 60 40 54 32 58 C24 54 16 60 6 56 L12 28 Z"/>
  <path d="M24 12 L22 54 M32 12 L32 56 M40 12 L42 54" stroke="#0b1520" stroke-width="1.6" fill="none" opacity="0.45"/>
  <circle cx="32" cy="12" r="4"/>`;

/* a sea glass pendant on its cord */
const CHARM = `
  <path d="M20 6 L32 26 L44 6" ${S} stroke-width="2.4"/>
  <path d="M32 24 L44 32 L42 50 L32 60 L22 50 L20 32 Z"/>
  <path d="M26 34 L32 30 L30 44 Z" fill="#fff" opacity="0.35"/>`;

const NECKLACE = `
  ${[[12, 14], [11, 24], [14, 33], [19, 41], [25, 47], [39, 47], [45, 41], [50, 33], [53, 24], [52, 14]].map(([x, y]) => `<circle cx="${x ?? 0}" cy="${y ?? 0}" r="4.2"/>`).join('')}
  <circle cx="32" cy="52" r="7"/>`;

const GLYPH = `
  <path d="M32 4 L40 26 L34 60 L28 60 L24 26 Z"/>
  <path d="M14 22 L22 34 L24 56 L18 56 L10 36 Z M50 22 L54 36 L46 56 L40 56 L42 34 Z"/>`;

/* a bear's claws: three curved talons on a pad */
const TALON = `
  <path d="M10 50 C8 34 14 18 26 8 C24 20 22 32 22 50 Z M26 52 C26 34 30 18 40 8 C38 22 36 36 36 52 Z M40 52 C42 36 48 24 58 16 C54 28 50 40 50 54 Z"/>
  <path d="M6 50 C18 46 42 46 54 52 C50 60 14 62 6 50 Z"/>`;

const PURSE = `
  <path d="M20 16 L44 16 L40 24 L24 24 Z"/>
  <path d="M24 24 C8 30 6 58 32 58 C58 58 56 30 40 24 Z"/>
  <path d="M22 20 L42 20" stroke="#0b1520" stroke-width="2" opacity="0.5"/>`;

/* a grappling claw: a gauntlet's cuff, the claw hub, three hooked talons fanned up-right, a line trailing */
const GRAPPLE = `
  <path d="M4 56 L16 42 L24 50 L12 62 Z"/>
  <path fill-rule="evenodd" d="${circle(28, 38, 9)} ${circle(28, 38, 3.5)}"/>
  <path d="M26 30 C24 18 30 8 42 4 C37 12 35 20 34 30 Z M34 34 C42 26 52 22 62 24 C54 28 47 33 40 40 Z M34 44 C44 44 52 50 56 60 C49 54 42 52 32 48 Z"/>
  <path d="M20 46 C14 40 8 38 2 40" ${S} stroke-width="2"/>`;

/** Install the shared game icon catalogue. */
export function installKitIcons(): void {
  registerIcons({
    deer: svg(DEER), elk: svg(ELK), boar: svg(BOAR), bear: svg(BEAR), meat: svg(MEAT), hide: svg(HIDE), tusk: svg(TUSK), antlers: svg(ANTLERS), bolt: svg(BOLT), claw: svg(CLAW), shell: svg(SHELL), coconut: svg(COCONUT), coin: svg(COIN), seaglass: svg(SEAGLASS), rope: svg(ROPE), whetstone: svg(WHETSTONE), chart: svg(CHART), bearclaw: svg(BEARCLAW), boartusk: svg(BOARTUSK), crossbow: svg(CROSSBOW), sword: svg(SWORD), rifle: svg(RIFLE), lever: svg(LEVER), longbow: svg(LONGBOW), hat: svg(HAT), cape: svg(CAPE), charm: svg(CHARM), necklace: svg(NECKLACE), glyph: svg(GLYPH), purse: svg(PURSE), talon: svg(TALON), leopard: svg(LEOPARD), wolf: svg(WOLF), eagle: svg(EAGLE), rider: svg(RIDER), horse: svg(HORSE), grapple: svg(GRAPPLE),
    ghost: svg(`<g filter="url(#gm-ghost-glow)">${DEER}</g><defs><filter id="gm-ghost-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`, 'class="ghost"'),
    ironhide: svg(`<g transform="translate(-4 -6) scale(1.14)">${BOAR}<path d="M4 46 L-2 52 L5 50 Z" transform="translate(4 -4)"/></g>`),
  });
}

/** the bag's glyphs (the composition root hands them to the game's BagMenu, E362 AG4) */
export const BAG_ICONS: BagIcons = { gear: 'sword', finds: 'seaglass', coin: 'coin', charm: 'charm', glass: 'seaglass' };

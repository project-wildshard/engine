import { STARTER_BOW } from './starter.generated';
import { wind } from '@wildshard/engine/world/steppeWind';
import type { BowProfile as PlatformBowProfile } from '@wildshard/engine/combat/view/bowProfile';

/** The starter view recipes keep their existing repaint vocabulary. */
const BOW_STYLES = ['recurve', 'golden', 'sky-wolf'] as const;
export type BowStyle = typeof BOW_STYLES[number];
/** Whether a declared row names one of those repaint styles. */
export function isBowStyle(value: string): value is BowStyle { return BOW_STYLES.some(entry => entry === value); }
/** The starter bow profile accepts those same trusted view strategies. */
export type BowProfile = PlatformBowProfile<BowStyle>;

/** The default bow's numbers. SF54: its view (the recurve's poses, arrow line, build and arrow) moved with the recurve into
 *  the admitted held bow row; a bow brings its own, as Pine's longbow does. */
export const BOW: Omit<BowProfile, 'poses' | 'arrowX' | 'arrowY' | 'arrowLength' | 'build' | 'arrow'> = {
  ...STARTER_BOW, wind,
};

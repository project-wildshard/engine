import { SweptMelee, type SwordOptions as PlatformOptions, type MeleeEvents, type SweptMeleeDefaults } from '@wildshard/engine/combat/view/SweptMelee';
import { isMeleeProfile, type MeleeProfile } from '@wildshard/engine/combat/meleeProfile';
import type { SwordWorld } from '@wildshard/engine/combat/view/melee';
import type { Targets } from '@wildshard/engine/combat/types';
import { SWORD_WOOD, SWORD_IRON } from '../../../shared/game/weapons/starterMeleeProfile';
import { REST, CHARGE, SPRINT, COMBO, SLASH, FINISHER, HEAVY } from '../../../shared/game/weapons/starterMoves';

/** The starter recipes share their original sound/reaction hooks, supplied to the platform family. */
export const swordEvents: MeleeEvents = {};
/** Starter reach remains content data. */
export const REACH: number = SWORD_WOOD.reach;
/** Compatibility options keep the starter profile and input-context defaults out of the engine. */
export type SwordOptions = Omit<PlatformOptions, 'profile' | 'inputContext'> & { profile?: MeleeProfile };

const shell = { surface: 'shell', count: 9, atFeet: false, sparks: true } as const;
const timber = { surface: 'wood', count: 8, atFeet: false, sparks: true } as const;
const sand = { surface: 'sand', count: 10, atFeet: true, sparks: false } as const;
const defaults: SweptMeleeDefaults = {
  moves: { rest: REST, charge: CHARGE, sprint: SPRINT, combo: COMBO, heavy: HEAVY },
  slash: SLASH, finisher: FINISHER, heavy: HEAVY, events: swordEvents,
  debris: (kind) => kind === 'crab' ? shell : kind === 'sailor' ? timber : sand,
};

/** The starter constructor: view, contact and input execution live in the platform family. */
export class Sword extends SweptMelee {
  constructor(world: SwordWorld, targets: Targets | undefined, opts: SwordOptions) {
    const profile = opts.profile ?? (isMeleeProfile(opts.row) ? opts.row : opts.blade === 'iron' ? SWORD_IRON : SWORD_WOOD);
    super(world, targets, { ...opts, profile, inputContext: 'weapon.melee' }, defaults);
  }
}

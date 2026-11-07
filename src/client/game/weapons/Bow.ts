import { Bow as PlatformBow, type BowOptions as PlatformBowOptions, type BowWorld as PlatformBowWorld } from '@wildshard/engine/combat/view/Bow';
import type { Targets } from '@wildshard/engine/combat/types';
import type { BowStyle } from '../../../shared/game/weapons/starterBowProfile';

/** Starter host ports for the trusted platform bow family. */
export type BowWorld = PlatformBowWorld;
/** Starter callers retain their row/profile options; the bridge supplies current input and style defaults. */
export type BowOptions = Omit<PlatformBowOptions<BowStyle>, 'inputContext' | 'initialStyle'>;
/** Starter constructor only; draw clocks, arrows and view strategy execution have one platform implementation. */
export class Bow extends PlatformBow<BowStyle> {
  constructor(world: BowWorld, targets: Targets | undefined, opts: BowOptions) {
    super(world, targets, { ...opts, inputContext: 'weapon.bow', initialStyle: 'recurve' });
  }
}

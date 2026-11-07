import { lit, glow } from '../../models/interact';

/** a pickup's model: its parts floating at the look's rest height (E405: content defines its own; the game's are
 *  src/client/game/models/specimenCatalogue.ts) */
/** a lit part (the shared low-poly material) and a glowing one (unlit, the glow batch's), for a pickup look's model */
export const interactParts: Readonly<{lit:typeof lit;glow:typeof glow}> = { lit, glow } as const;

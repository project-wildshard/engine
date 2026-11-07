/** Native equipment order and the original lower/raise clocks. */
export const PINE_NATIVE_LOADOUT = { slots: [0, 1, 2], initial: 0, lower: 0.25, raise: 0.25 } as const;
export const LOADOUT_STEP = 'pine.loadout';
export const WEAPON_COMMAND = 'pine.weapon';
export const PINE_WEAPON = { crossbow: 0, lever: 1, longbow: 2 } as const;
export const LEVER_FLAG = 'owned:lever-rifle';

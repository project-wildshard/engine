/**
 * The platform's room curves (J104). A boss's data stays one authored number; these say how a fight grows with the players
 * engaged at its start. One player is exactly the authored fight: a scale of 1 and one target.
 */
/** Each player past the first adds three quarters of the authored health. */
export function bossHealthScale(engaged: number): number { return 1 + 0.75 * (Math.max(1, engaged) - 1); }
/** One more player struck by each blow for every four engaged. */
export function bossTargetCount(engaged: number): number { return Math.max(1, Math.ceil(engaged / 4)); }

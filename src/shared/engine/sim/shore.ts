/**
 * The §3.2 shore rule's shared numbers (SHARD-PLATFORM G134 / G149). An edge whose observed sea is at exactly 0 over
 * seabed below 0 keeps the platform strip at 0 to the cell edge and gets a low rip-rap revetment there
 * (`seamGeometry.ts` builds it); the shard clips its sea at the revetment's inner face. Both sides read these.
 */

/** A boundary sample counts as seabed when it is more than this below 0 (the entry rule's 2 cm road tolerance). */
export const SHORE_DEPTH = 0.02;

/**
 * The revetment's inner (sea-side) face, in metres into the cell from the cell edge. The shard's sea is clipped here: no
 * water nearer the cell edge than this, so its edge hides under the revetment's crest (+0.6 m, above the +0.4 m swell).
 */
export const SHORE_REVETMENT_INNER_FACE = 0.8;

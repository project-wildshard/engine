/** One declared aim exclusion: a target whose memory field equals the value is not aimable. */
export interface AimTargetExclusion { readonly field: string; readonly equals: number }

/** CI12: the aim-target filter of combat.aimTargets (clientTargets.ts), renderer-free so a native host applies the same
 *  admitted rows. A target keeps its place unless its memory is an object holding an excluded field at the excluded value;
 *  the field is read with Reflect.get, in rule order, stopping at the first match. */
export function filterCombatAimTargets<T extends object>(list: readonly T[], exclude: readonly AimTargetExclusion[]): T[] {
  return list.filter(actor => {
    const memory: unknown = 'mem' in actor ? actor.mem : null;
    return typeof memory !== 'object' || memory === null || !exclude.some(rule => rule.field in memory && Reflect.get(memory, rule.field) === rule.equals);
  });
}

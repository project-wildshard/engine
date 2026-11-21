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

/** The memory shields a shard's creatures declare (`attackable.unless`, shard-format OF38a), in species order, each field
 *  once. ONE-FORMAT OF38c (J420 (2)): these are the aim exclusions; no weapon or page carries an aim list. */
export function declaredAimExclusions(species: readonly { readonly attackable?: false | { readonly unless?: readonly AimTargetExclusion[] } }[]): AimTargetExclusion[] {
  const seen = new Set<string>(), rows: AimTargetExclusion[] = [];
  for (const row of species) {
    const shields = row.attackable === undefined || row.attackable === false ? [] : row.attackable.unless ?? [];
    for (const shield of shields) if (!seen.has(shield.field)) { seen.add(shield.field); rows.push({ field: shield.field, equals: shield.equals }); }
  }
  return rows;
}

/** A page feature that names an encounter owner: a timed encounter, or an arena (an open one carries its `equipment`). */
interface OwnerFeature { readonly kind: string; readonly owner?: string | undefined; readonly equipment?: string | undefined }
/** The aim rows OF38c derives. */
export interface OwnedCombatTargets {
  readonly ray?: { readonly sources: string[]; readonly result: 'copy'; readonly requires?: 'population.wildlife' };
  readonly aim?: { readonly exclude: AimTargetExclusion[]; readonly append: string[] };
}
/**
 * ONE-FORMAT OF38c: the target rows a page with no target list draws from its owners' own declarations. Each timed
 * encounter lends its riders' ray, and each open arena (the one whose fight equips the player) its boss's ray and lock,
 * as their server owners lend their held contacts (`c6fc94e26b`); a room arena lends neither. The aim exclusions are the
 * creatures' `attackable.unless` shields. A wildlife page's ray waits on its population, as before.
 */
export function ownedCombatTargets(features: readonly OwnerFeature[], species: Parameters<typeof declaredAimExclusions>[0]): { rows: OwnedCombatTargets; bindings: { id: string; kind: 'arena-room' | 'timed-encounters'; owner: string }[] } | null {
  const timed = features.flatMap(row => row.kind === 'timed.encounters' && row.owner !== undefined ? [row.owner] : []);
  const open = features.flatMap(row => row.kind === 'arena-room.entry' && row.owner !== undefined && row.equipment !== undefined ? [row.owner] : []);
  const exclude = declaredAimExclusions(species), sources = [...timed, ...open];
  if (sources.length === 0 && exclude.length === 0) return null;
  const wildlife = features.some(row => row.kind === 'population.wildlife');
  const rows: OwnedCombatTargets = { ...(sources.length === 0 ? {} : { ray: { sources, result: 'copy' as const, ...(wildlife ? { requires: 'population.wildlife' as const } : {}) } }),
    aim: { exclude, append: open } };
  return { rows, bindings: [...timed.map(owner => ({ id: owner, kind: 'timed-encounters' as const, owner })), ...open.map(owner => ({ id: owner, kind: 'arena-room' as const, owner }))] };
}

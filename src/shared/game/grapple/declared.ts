import type { Shardfile } from '@wildshard/format/shardSchema';
import type { GrappleMode } from '@wildshard/format/modes';
import { parseGrappleProfile, type GrappleProfile } from '@wildshard/format/grapple';

/** A `state/modes` grapple row that carries its tool (OF41c). */
export type DeclaredGrappleRow = GrappleMode & Required<Pick<GrappleMode, 'profile' | 'hooks'>>;

/** ONE-FORMAT OF41c: the one grapple row of a plain upload that carries its tool `profile` and `hooks`, or null. A shard
 *  declares one grapple tool: the server's sim and the page each install it from this row alone. */
export function declaredGrappleRow(shard: Pick<Shardfile, 'modes'>): DeclaredGrappleRow | null {
  const rows = (shard.modes?.grapple ?? []).filter((row): row is DeclaredGrappleRow => row.profile !== undefined && row.hooks !== undefined);
  if (rows.length > 1) throw new Error(`A shard declares one grapple tool; ${rows.map(row => row.id).join(', ')} each carry a profile`);
  return rows[0] ?? null;
}

/** The row's timings, the course mode both sides step. */
export function declaredGrappleMode(row: DeclaredGrappleRow): GrappleMode {
  const { profile: _profile, hooks: _hooks, guard: _guard, rise: _rise, ...mode } = row;
  return mode;
}

/** The native profile file, rebuilt from the row: its course mode is the row's own timings. `id` is the row's, unless the
 *  page names its equipped tool (`tool.<row>`). */
export function declaredGrappleProfile(row: DeclaredGrappleRow, id: string = row.id): GrappleProfile {
  return parseGrappleProfile({ ...row.profile, id, course: { ...row.profile.course, mode: declaredGrappleMode(row) } });
}

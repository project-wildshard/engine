import type { Shardfile } from '@wildshard/format/shardSchema';
import { parseGrappleProfile } from '@wildshard/format/grapple';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { SimHost } from '@wildshard/engine/sim';
import { installGrapple, type GrappleTickContext, type NativeGrapple } from '../grapple/native';
import { registerInstalled } from './installedSides';

/** ONE-FORMAT OF41c: the `grapple` primitive from a plain upload. A `state/modes` grapple row that carries its tool
 * `profile` and `hooks` installs the same `installGrapple` the native `grapple` assembly row does (`nativeAssemblyHosts.ts`):
 * the row's timings are the course's mode, its `guard` names the collider owner a crossing opens, its `rise` lifts the
 * claw over a ledge. A shard whose grapple rows are timings only installs nothing; one grapple tool a shard, since the
 * tool owns its step, its LOCK route and its world-state rows. */
export function installDeclaredGrapple(host: SimHost, shard: Pick<Shardfile, 'modes'>, context: GrappleTickContext, restoring: boolean): NativeGrapple | null {
  const rows = (shard.modes?.grapple ?? []).filter(row => row.profile !== undefined);
  if (rows.length > 1) throw new Error(`A shard declares one grapple tool; ${rows.map(row => row.id).join(', ')} each carry a profile`);
  const [row] = rows;
  if (row?.profile === undefined || row.hooks === undefined) return null;
  // the native profile file, rebuilt from the row: its id and course mode are the row's own, timings only
  const { profile: tool, hooks, guard: owner, rise, ...mode } = row;
  const profile = parseGrappleProfile({ ...tool, id: row.id, course: { ...tool.course, mode } });
  // a restore's guard handles come from its save, as the native host's do
  const guard = restoring || owner === undefined ? [] : host.physics.world.colliders.getAll().filter(collider => tagOf(collider)?.owner === owner).map(collider => collider.handle);
  const grapple = installGrapple(host, context, profile, mode, hooks, guard, rise === true);
  registerInstalled(host, 'grapple');
  return grapple;
}

/** The declared sim's grapple tick port when its host lends none: each player's JUMP press from the tick's own command,
 *  the LOCK and aim from the admitted script values (`ports.commands`), facts to the quest port. */
export function declaredGrappleTick(host: SimHost, scripts: (() => ReadonlyMap<string, number>) | undefined, fact: (name: string, actorId: string) => void): GrappleTickContext {
  const tape = (id: string | undefined, values: boolean): ReturnType<GrappleTickContext['commands']> => [
    ...(values ? [...scripts?.() ?? []].map(([actorId, value]) => ({ kind: 'script' as const, actorId, value })) : []),
    { kind: 'player', jump: id !== undefined && host.tickCommand(id)?.jump === true },
  ];
  const first = (): string | undefined => host.players.keys().next().value;
  return { commands: () => tape(first(), true), commandsOf: id => tape(id, false), emit: effect => { fact(effect.name, effect.actorId); } };
}

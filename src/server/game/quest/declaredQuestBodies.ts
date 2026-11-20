// ONE-FORMAT OF22e1: the quest hosts read the declared population. A native assembly's kill steps and its quest's
// guard read the mixed population's bodies (`run.island`); once a shard's creatures are declared spawns (OF22b) and
// its plan names no `population.mixed`, they read the declared bodies instead: a body's kind is its species row's.
import type { SimHost } from '@wildshard/engine/sim';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { countedShard } from '../shardfile/declaredSpawnCount';

/** The declared bodies as the quest hosts read them: a dying actor's kind, and whether a body of a kind stands. */
export interface DeclaredQuestBodies {
  /** The species kind of the declared body that is `actor`, or `undefined` for any other actor. */
  readonly kindOf: (actor: unknown) => string | undefined;
  /** Whether a declared body of `kind` stands alive. */
  readonly standing: (kind: string) => boolean;
  /** OF22c3: every declared body the host holds, with its species kind and herd (what the mixed roster lent a bounty). */
  readonly bodies: () => readonly DeclaredQuestBody[];
}
export interface DeclaredQuestBody { readonly id: string; readonly kind: string; readonly herd: number; readonly actor: NonNullable<ReturnType<SimHost['entities']['get']>> }

export function declaredQuestBodies(host: SimHost, shard: Shardfile): DeclaredQuestBodies {
  const kinds = new Map(shard.rows.species.map(row => [row.id, row.kind] as const));
  const spawns = countedShard(shard).creatures.spawns, ids = new Set(spawns.map(row => row.id));
  const byKind = new Map<string, string[]>();
  for (const row of spawns) { const kind = kinds.get(row.species); if (kind !== undefined) byKind.set(kind, [...byKind.get(kind) ?? [], row.id]); }
  return {
    kindOf: actor => {
      const id = (actor as { readonly id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !ids.has(id)) return undefined;
      const body = host.entities.get(id);
      return body === undefined || body.combatActor() !== actor ? undefined : kinds.get(body.species);
    },
    standing: kind => (byKind.get(kind) ?? []).some(id => host.entities.get(id)?.alive === true),
    bodies: () => spawns.flatMap(row => {
      const actor = host.entities.get(row.id), kind = kinds.get(row.species);
      return actor === undefined || kind === undefined ? [] : [{ id: row.id, kind, herd: actor.herd, actor }];
    }),
  };
}

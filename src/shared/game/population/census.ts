import type { SimHost } from '@wildshard/engine/sim';

/** One creature as the census reads it: the native body (`AnimalSim`) and the page's view (`Animal`) both fit. */
export interface CensusCreature {
  readonly entityId: string; readonly kind: string; readonly variant: string; readonly alive: boolean; readonly hp: number;
  readonly state: string; readonly yaw: number; readonly position: { readonly x: number; readonly y: number; readonly z: number };
}
/** One declared home: its id and kind, the body standing in it (its entity id, null between bodies) and its refill clock. */
export interface CensusHome { readonly id: string; readonly kind: string; readonly body: string | null; readonly wait: number }
/** A creature's row: identity, life, behaviour state and pose. */
export interface PopulationCensusBody {
  readonly id: string; readonly kind: string; readonly variant: string; readonly alive: boolean; readonly hp: number;
  readonly state: string; readonly position: readonly [number, number, number]; readonly yaw: number;
}
/**
 * P1-E3.1: the population's serialisable read model. Plain JSON, no live body, no clock, no random stream: what a view
 * (or, from E5, a replication schema) reads to show and count creatures. Bodies are ordered by id; `kinds` counts live
 * and fallen bodies per kind the way the page's creature manager counts `alive`. `homes` are the refilling owners'
 * declared homes in their declared order, each with its current body and respawn clock (seconds; 0 while one stands).
 */
export interface PopulationCensus {
  readonly version: 1; readonly tick: number; readonly alive: number; readonly fallen: number;
  readonly kinds: Readonly<Record<string, { readonly alive: number; readonly fallen: number }>>;
  readonly bodies: readonly PopulationCensusBody[];
  readonly homes: readonly CensusHome[];
}

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The census law, shared by the server's host and a client view: the same bodies and homes always count the same. */
export function censusOf(tick: number, creatures: Iterable<CensusCreature>, homes: Iterable<CensusHome> = []): PopulationCensus {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('Census tick must be a natural number');
  const bodies: PopulationCensusBody[] = [], kinds: Record<string, { alive: number; fallen: number }> = {};
  let alive = 0;
  for (const c of creatures) {
    const p = c.position;
    if (![p.x, p.y, p.z, c.yaw, c.hp].every(Number.isFinite)) throw new Error(`Census body ${c.entityId} is not finite`);
    bodies.push({ id: c.entityId, kind: c.kind, variant: c.variant, alive: c.alive, hp: c.hp, state: c.state, position: [p.x, p.y, p.z], yaw: c.yaw });
    const count = kinds[c.kind] ??= { alive: 0, fallen: 0 };
    if (c.alive) { count.alive++; alive++; } else count.fallen++;
  }
  bodies.sort(byId);
  if (new Set(bodies.map(body => body.id)).size !== bodies.length) throw new Error('Census bodies repeat an id');
  const rows = [...homes].map(home => ({ id: home.id, kind: home.kind, body: home.body, wait: home.wait }));
  if (rows.some(home => !Number.isFinite(home.wait))) throw new Error('Census home clock is not finite');
  return { version: 1, tick, alive, fallen: bodies.length - alive, kinds, bodies, homes: rows };
}

const owners = new WeakMap<object, Map<string, () => Iterable<CensusHome>>>();
/** A refilling population owner lends its homes to the census under its fixed-step id; the lease ends with the returned
 *  release or the host's scope. One id holds one owner. */
export function registerPopulationHomes(host: Pick<SimHost, 'scope'>, owner: string, homes: () => Iterable<CensusHome>): () => void {
  let table = owners.get(host);
  if (table === undefined) { table = new Map(); owners.set(host, table); }
  if (table.has(owner)) throw new Error(`Population owner ${owner} is already registered`);
  table.set(owner, homes);
  const release = (): void => { if (table.get(owner) === homes) table.delete(owner); };
  host.scope.onDispose(release);
  return release;
}

/** The census of one native host: every creature it simulates and every registered owner's homes (owners in id order). */
export function populationCensus(host: Pick<SimHost, 'entities' | 'state' | 'scope'>): PopulationCensus {
  const table = owners.get(host), homes: CensusHome[] = [];
  if (table !== undefined) for (const id of [...table.keys()].sort()) homes.push(...table.get(id)?.() ?? []);
  return censusOf(host.state.tick, host.entities.values(), homes);
}

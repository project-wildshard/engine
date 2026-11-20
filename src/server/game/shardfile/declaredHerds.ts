import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import * as v from 'valibot';

/**
 * ONE-FORMAT OF23c: declared herds. Pine's herds stand as declared spawns, each herd's bodies sharing a spawn `group`, and
 * a layer hunt drives each body. The rain shelter (`population.shelter`) shelters them as it sheltered the roster's herds:
 * a herd's centre starts where its bodies stand, the shelter moves it under a big tree through a shower and back home
 * after, and its bodies' wanders walk to the goal it publishes. A group a script owns (an elite program's declared main, a
 * spawn script's thralls: the bodies `lendDeclaredBodies` names) is that script's, never a herd.
 */
export interface DeclaredHerd {
  readonly kind: string; cx: number; cz: number;
  readonly members: AnimalSim[];
  /** the shelter's latest wander goal for this herd; null when it holds none */
  goal: { x: number; z: number; r: number } | null;
}
interface Ledger {
  readonly groups: Map<string, { readonly members: AnimalSim[]; readonly at: [number, number][] }>;
  readonly lent: Set<string>;
  herds?: readonly DeclaredHerd[];
  byBody?: ReadonlyMap<AnimalSim, DeclaredHerd>;
}
const ledgers = new WeakMap<SimHost, Ledger>();
function ledger(host: SimHost): Ledger {
  let found = ledgers.get(host);
  if (found === undefined) { found = { groups: new Map(), lent: new Set() }; ledgers.set(host, found); }
  return found;
}

/** A layer hunt's body joins its spawn group, standing at `x, z`. Install time only, before the herds are first read. */
export function joinDeclaredGroup(host: SimHost, group: string, body: AnimalSim, x: number, z: number): void {
  const book = ledger(host);
  if (book.herds !== undefined) throw new Error('Declared herds are already read');
  let row = book.groups.get(group);
  if (row === undefined) { row = { members: [], at: [] }; book.groups.set(group, row); }
  row.members.push(body); row.at.push([x, z]);
}

/** A script borrows these declared bodies: their groups are its own, never herds. Install time only. */
export function lendDeclaredBodies(host: SimHost, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const book = ledger(host);
  if (book.herds !== undefined) throw new Error('Declared herds are already read');
  for (const id of ids) book.lent.add(id);
}

/** The declared herds in spawn order, fixed on the first read (after every host installed). */
export function declaredHerds(host: SimHost): readonly DeclaredHerd[] {
  const book = ledgers.get(host);
  if (book === undefined) return [];
  if (book.herds === undefined) {
    const herds: DeclaredHerd[] = [], byBody = new Map<AnimalSim, DeclaredHerd>();
    for (const { members, at } of book.groups.values()) {
      const first = members[0];
      if (first === undefined || members.some(body => book.lent.has(body.entityId))) continue;
      const herd: DeclaredHerd = { kind: first.kind, cx: at.reduce((sum, [x]) => sum + x, 0) / at.length,
        cz: at.reduce((sum, [, z]) => sum + z, 0) / at.length, members, goal: null };
      herds.push(herd);
      for (const body of members) byBody.set(body, herd);
    }
    book.herds = herds; book.byBody = byBody;
  }
  return book.herds;
}

/** A declared body's herd; null when it is in none (no group, or a script's). */
export function declaredHerdOf(host: SimHost, body: AnimalSim): DeclaredHerd | null {
  if (ledgers.get(host)?.byBody === undefined) declaredHerds(host);
  return ledgers.get(host)?.byBody?.get(body) ?? null;
}

/** The shelter's wander goal for a declared body's herd; null when it is in no herd or the herd holds none. */
export function declaredHerdGoal(host: SimHost, body: AnimalSim): { x: number; z: number; r: number } | null {
  return declaredHerdOf(host, body)?.goal ?? null;
}

const finite = v.pipe(v.number(), v.finite());
const SavedCentres = v.array(v.tuple([finite, finite]));
const SAVE = 'creatures.herds';
/** A declared herd's centre is saved state (the shelter moves it, its members ease it), as a roster herd's is. Installed
 *  once the layer hunts joined a group; a shard with no grouped hunt saves nothing new. */
export function installDeclaredHerdSave(host: SimHost): void {
  if ((ledgers.get(host)?.groups.size ?? 0) === 0 || host.adapters.has(SAVE)) return;
  // joined: a save from before declared herds carried centres restores without one (each centre stays where its bodies stood)
  const adapter = { joined: true as const, snapshot: () => declaredHerds(host).map(herd => [herd.cx, herd.cz]), restore: (saved: unknown) => {
    const centres = v.parse(SavedCentres, saved), herds = declaredHerds(host);
    if (centres.length !== herds.length) throw new Error('Incompatible declared herd continuation');
    herds.forEach((herd, index) => { const [x, z] = centres[index] ?? [herd.cx, herd.cz]; herd.cx = x; herd.cz = z; });
  } };
  host.adapters.set(SAVE, adapter);
  host.scope.onDispose(() => { if (host.adapters.get(SAVE) === adapter) host.adapters.delete(SAVE); });
}

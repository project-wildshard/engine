import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { scriptItemHook } from '@wildshard/engine/combat/items';
import type { ScriptLanePort } from '@wildshard/engine/script/lane';
import type { DeclaredScriptWorld } from '@wildshard/engine/script/state';
import type { ScriptEntity } from '@wildshard/engine/script/effects';
import { parseItems } from '@wildshard/format/items';

type ItemHook = ReturnType<typeof scriptItemHook>;
/** The lane this host's players sit at, with the item rows that act on it. `actors` is the name table scenes and queries read. */
export interface ScriptSeatPorts {
  readonly lane: Pick<ScriptLanePort, 'host' | 'seat' | 'unseat' | 'seatWorlds'>; readonly items: unknown;
  readonly actors?: Map<string, number>; readonly handle: (name: string) => number;
}
/** Every player's place in a shard's script lane. */
export interface ScriptSeats {
  /** The player the lane was installed for: their handles are the content's own, so a save holds no seat for them. */
  readonly first: PlayerSim;
  /** Open the seats on one lane; until then only `first` is served. */
  readonly bind: (ports: ScriptSeatPorts) => void;
  /** Bring the seats up to who is here. Run it before the lane's step. */
  readonly step: () => void;
  /** This player's item hooks, each acting as them. */
  readonly hooks: (player: string) => ReadonlyMap<string, ItemHook>;
}

const entity = (id: number, name: string): ScriptEntity => ({ id, name, position: [0, 0, 0], fields: {}, frozen: false, interactive: true });
const NO_HOOKS: ReadonlyMap<string, ItemHook> = new Map();

/**
 * P1-E5.2a: a lane's actors were fixed at install, so item scripts, scenes and the state they read stopped at the first
 * player. A later player sits here on their first tick: a body entity and an alias for each item with a hook, all bound to
 * them, plus their own state record, and they leave with it all. Handles come from their id, so a room replays alike, and the
 * lane's save holds the seats. A script still reads the handle content declared, and state and provenance follow the seat. With
 * nobody else here nothing is added, so a one-player save keeps its exact bytes. One module serves every seat, so what it
 * keeps in its own memory it keeps for the room; a player's numbers belong in declared player fields.
 */
export function scriptSeats(host: SimHost): ScriptSeats {
  const [first] = host.players.values();
  if (first === undefined) throw new Error('Simulation host has no player');
  let ports: ScriptSeatPorts | undefined, world: DeclaredScriptWorld | undefined;
  const hookRows = (input: ScriptSeatPorts): readonly { readonly id: string; readonly hook: NonNullable<ReturnType<typeof parseItems>['rows'][number]['hook']> }[] =>
    parseItems(input.items).rows.flatMap(row => row.hook === null ? [] : [{ id: row.id, hook: row.hook }]);
  const known = new Set<string>(), own = new Map<string, { readonly handles: readonly number[]; readonly hooks: ReadonlyMap<string, ItemHook> }>();
  const free = (input: ScriptSeatPorts, name: string, taken: Set<number>): number => {
    let id = input.handle(name);
    while (taken.has(id) || input.lane.host.world.entity(id) !== undefined) id = id % 0x7fffffff + 1;
    taken.add(id); return id;
  };
  const sit = (player: string): readonly number[] | undefined => {
    if (ports === undefined || world === undefined) return undefined;
    const held = world.seatOf(player);
    if (held !== undefined) return held;
    const taken = new Set<number>(), body = free(ports, player, taken), items = hookRows(ports);
    const input = ports, seat = [entity(body, player), ...items.map(row => entity(free(input, `item:${row.id}:${player}`, taken), row.id))];
    input.lane.seat?.(world, player, seat, [input.actors?.get(first.id) ?? body, ...items.map(row => row.hook.entity)]);
    return world.seatOf(player);
  };
  const reconcile = (input: ScriptSeatPorts, seats: DeclaredScriptWorld): void => {
    for (const actor of seats.seatedActors()) if (!host.players.has(actor)) input.lane.unseat?.(seats, actor);
    for (const player of host.players.values()) if (player !== first) sit(player.id);
    for (const actor of known) if (seats.seatOf(actor) === undefined) { known.delete(actor); own.delete(actor); input.actors?.delete(actor); }
    for (const actor of seats.seatedActors()) {
      const body = seats.seatOf(actor)?.[0];
      if (body !== undefined) { known.add(actor); input.actors?.set(actor, body); }
    }
  };
  return { first,
    bind: input => {
      if (ports !== undefined) throw new Error('Script seats are bound to one lane');
      ports = input; world = input.lane.seatWorlds?.().find(candidate => candidate.holds(first.id));
    },
    step: () => {
      if (ports === undefined || world === undefined || (host.players.size === 1 && world.seated === 0 && known.size === 0)) return;
      reconcile(ports, world);
    },
    hooks: player => {
      if (ports === undefined) return NO_HOOKS;
      const input = ports, rows = hookRows(input);
      if (player === first.id) return new Map(rows.map(row => [row.id, scriptItemHook(input.lane.host, row.hook.module, row.hook.entity, row.hook.event, player)]));
      const handles = sit(player);
      if (handles === undefined) return NO_HOOKS;
      const cached = own.get(player);
      if (cached?.handles === handles) return cached.hooks;
      const hooks = new Map(rows.map((row, index) => [row.id, scriptItemHook(input.lane.host, row.hook.module, row.hook.entity, row.hook.event, player, handles[index + 1] ?? 0)]));
      own.set(player, { handles, hooks }); known.add(player);
      return hooks;
    } };
}

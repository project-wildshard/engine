import type { SimHost, SimStateAdapter, SimValue } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

/** One player's copy of a weapon's state: its tick, and its continuation. */
export interface PlayerSeat { readonly step: (dt: number) => void; readonly snapshot: () => SimValue; readonly restore: (value: unknown) => void }
/** Every player's seat at one weapon. */
export interface PlayerSeats<S extends PlayerSeat> { readonly lead: S; readonly of: (player: PlayerSim) => S; readonly step: (dt: number) => void; readonly adapter: SimStateAdapter }

function othersIn(value: unknown): { readonly lead: unknown; readonly others: Readonly<Record<string, unknown>> } | null {
  if (typeof value !== 'object' || value === null || !('others' in value) || !('lead' in value)) return null;
  const { lead, others } = value;
  if (typeof others !== 'object' || others === null || Array.isArray(others) || Object.keys(value).length !== 2) throw new Error('Invalid player seat continuation');
  return { lead, others: Object.fromEntries(Object.entries(others)) };
}

/** Every weapon's seats on a host, in install order, so one player's values can leave with them (E7.4). */
const hostSeats = new WeakMap<SimHost, ((player: PlayerSim) => PlayerSeat)[]>();
/** One player's value at each weapon, in install order. */
export function exportSeats(host: SimHost, player: PlayerSim): SimValue[] { return (hostSeats.get(host) ?? []).map(seat => seat(player).snapshot()); }
/** Put a player's weapon values back, on seats made for them if they have none yet. */
export function importSeats(host: SimHost, player: PlayerSim, values: readonly unknown[]): void {
  for (const [index, seat] of (hostSeats.get(host) ?? []).entries()) { const value = values[index]; if (value !== undefined) seat(player).restore(value); }
}

/**
 * P1-E3.5: a weapon serves every player, so what a weapon remembers lives in a seat per player. The host's first player sits
 * from install (`first`: its save, its frame, and whatever else stays one-player); another player gets a seat on its first tick and loses it when it leaves. One adapter holds them: alone, its value is the
 * lead's as it always was, so a one-player save keeps its exact bytes; with company it is `{ lead, others }`.
 */
export function playerSeats<S extends PlayerSeat>(host: SimHost, make: (player: PlayerSim, first: boolean) => S): PlayerSeats<S> {
  const [leader] = host.players.values(); if (leader === undefined) throw new Error('Simulation host has no player');
  const lead = make(leader, true), others = new Map<string, S>();
  const of = (player: PlayerSim): S => {
    if (player === leader) return lead;
    let seat = others.get(player.id);
    if (seat === undefined) { seat = make(player, false); others.set(player.id, seat); }
    return seat;
  };
  hostSeats.set(host, [...hostSeats.get(host) ?? [], of]);
  return { lead, of,
    step: dt => {
      lead.step(dt);
      if (host.players.size === 1 && others.size === 0) return;
      for (const id of others.keys()) if (!host.players.has(id)) others.delete(id);
      for (const player of host.players.values()) if (player !== leader) of(player).step(dt);
    },
    adapter: {
      snapshot: () => {
        const value = lead.snapshot();
        return others.size === 0 ? value : { lead: value, others: Object.fromEntries([...others].map(([id, seat]) => [id, seat.snapshot()])) };
      },
      restore: value => {
        const saved = othersIn(value); others.clear();
        if (saved === null) { lead.restore(value); return; }
        lead.restore(saved.lead);
        for (const [id, entry] of Object.entries(saved.others)) {
          const player = host.players.get(id); if (player === undefined || player === leader) throw new Error('Player seat continuation names no other player');
          of(player).restore(entry);
        }
      },
    } };
}

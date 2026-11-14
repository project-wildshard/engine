import * as v from 'valibot';
import type { SimStateAdapter } from '../sim';

/** J109: a spawn point fills again on a timer that runs faster with more players near it. */
declare module '../../../client/engine/events/maps' {
  interface EventMap {
    /** J108: a wild creature became a player's mount; a new wild one comes later at the spot it left. */
    'creature.tamed': { kind: string; variant: string; herd: number; x: number; z: number; id: string };
  }
}

/** A player counts toward a spawn point's rate inside this radius (m). */
export const REFILL_NEAR = 120;
/** Nothing appears within this far of any player (m). */
export const REFILL_AWAY = 60;
/** The timer of a point no author gave one, in seconds at one player near it: the low end of the shards' 180–900 s rules. */
export const REFILL_WAIT = 300;
/** The queue's bound: a room cannot owe more refills than this. */
const REFILL_LIMIT = 256;
/** Timers tick once a second; nothing here needs a frame's precision. */
const REFILL_CHECK = 1;

interface RefillPlayer { readonly id?: string; readonly position: { readonly x: number; readonly z: number } }
interface RefillPoint { readonly x: number; readonly z: number }

/** How many of `players` stand within `radius` m of (x, z). */
export function playersNear(players: Iterable<RefillPlayer>, x: number, z: number, radius: number = REFILL_NEAR): number {
  let near = 0;
  for (const { position: p } of players) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= radius * radius) near++;
  return near;
}

/** The J109 rate: a timer runs at the speed of the players near it, and never slower than one player's. */
export function refillRate(near: number): number { return Math.max(1, near); }

/** The rate at (x, z) in a room. One player is always exactly 1: their timers are today's timers, wherever they stand. A parked seat is nobody (J109). */
export function roomRefillRate(players: { readonly size: number; values: () => Iterable<RefillPlayer> }, x: number, z: number, parked: ReadonlySet<string> = new Set()): number {
  return players.size <= 1 ? 1 : refillRate(playersNear([...players.values()].filter(player => player.id === undefined || !parked.has(player.id)), x, z));
}

/** The player nearest (x, z), or `fallback` in an empty room. */
export function nearestPosition<T extends RefillPoint>(players: Iterable<{ readonly position: T }>, x: number, z: number, fallback: T): T {
  let best = fallback, far = Infinity;
  for (const { position: p } of players) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < far) { far = d; best = p; }
  }
  return best;
}

/** One creature owed to a spawn point: `from` is the body it replaces. */
export interface RefillEntry { kind: string; variant: string; herd: number; x: number; z: number; wait: number; from: string }

const finite = v.pipe(v.number(), v.finite());
const SavedRefill = v.strictObject({ clock: finite, pending: v.pipe(v.array(v.strictObject({ kind: v.string(), variant: v.string(), herd: finite,
  x: finite, z: finite, from: v.string(), wait: finite })), v.maxLength(REFILL_LIMIT)) }); // key order is the live entry's: a save digests equal

/** What a population owner lends its refill. */
export interface RefillPorts {
  readonly players: () => readonly RefillPlayer[];
  /** how many more bodies the shard's budget has room for now */
  readonly room: () => number;
  readonly random: () => number;
  /** Put the body back. Nothing else may change the population: the queue has already dropped the entry. */
  readonly spawn: (entry: RefillEntry, yaw: number) => void;
  /** SC5 (J328): a served world (the MMO server's) is a room with one player in it: what falls comes back, as it does for two. */
  readonly served?: () => boolean;
}

/**
 * The refill of a population nobody gave a timer (J109, J108): a herd animal that falls or is tamed comes back at its
 * spawn point after REFILL_WAIT, sooner with more players there, while the shard's budget has room and no player would
 * watch it appear. Authors change nothing, and one player gets today's game: nothing is queued and nothing draws, so
 * their tick and their save are the bytes they always were. A point with its own timer stays on it (homes, returns).
 */
export class CreatureRefill {
  readonly pending: RefillEntry[] = [];
  private clock = 0;
  private readonly ports: RefillPorts;
  constructor(ports: RefillPorts) { this.ports = ports; }
  /** A room's refill runs: two players or more, or a served world's one (SC5: a grid cell never starts over, so this is all that refills it). */
  private room(players: readonly RefillPlayer[]): boolean { return players.length > 1 || this.ports.served?.() === true; }

  /** A body left its spawn point (it fell, or a player tamed it). */
  left(entry: Omit<RefillEntry, 'wait'>): void {
    if (!this.room(this.ports.players()) || this.pending.length >= REFILL_LIMIT) return;
    this.pending.push({ ...entry, wait: REFILL_WAIT });
  }

  step(dt: number): void {
    if (this.pending.length === 0) return;
    this.clock += dt;
    if (this.clock < REFILL_CHECK) return;
    const elapsed = this.clock, players = this.ports.players();
    this.clock = 0;
    if (!this.room(players)) return; // the room emptied to one: what is owed waits, and that player's game is today's
    const due: RefillEntry[] = [];
    for (const entry of this.pending) {
      entry.wait -= elapsed * refillRate(playersNear(players, entry.x, entry.z));
      if (entry.wait <= 0 && playersNear(players, entry.x, entry.z, REFILL_AWAY) === 0) due.push(entry);
    }
    for (const entry of due) {
      if (this.ports.room() <= 0) break;
      this.pending.splice(this.pending.indexOf(entry), 1);
      this.ports.spawn(entry, this.ports.random() * Math.PI * 2);
    }
  }

  /** Save state, as a host adapter. It joins a save only while something is owed (`syncRefillState`). */
  readonly state: SimStateAdapter = {
    snapshot: () => ({ clock: this.clock, pending: this.pending.map(entry => ({ ...entry })) }),
    restore: value => {
      const saved = v.parse(SavedRefill, value);
      this.clock = saved.clock; this.pending.length = 0; this.pending.push(...saved.pending);
    },
  };
}

/** Keep a refill's save row present exactly while it owes a body, so a one-player save never gains an adapter. */
export function syncRefillState(adapters: Map<string, SimStateAdapter>, id: string, refill: CreatureRefill): void {
  if (refill.pending.length === 0) adapters.delete(id);
  else if (!adapters.has(id)) adapters.set(id, refill.state);
}

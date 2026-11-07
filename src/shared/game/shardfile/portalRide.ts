/** The walk-in portal ride's renderer-free half (G478 'walk-in-portal-ride'). A shard declares its portal-link entryways,
 * the ride's director and these rows: the walk-in trigger, the fade and the facts a landing reports. The ride
 * (walkInPortalRide.ts) runs after the player on the page's update and on the host's fixed step with exact continuation; the
 * page draws the veil (`client/shardfile/portalRideBinding.ts`). No shard identifier or callback enters here. */
import * as v from 'valibot';
import type { PortalLinkEntry, portalLinkRules } from '@wildshard/format/portalLinkAssets';
import { createPortalRide, PortalRideStateSchema, type PortalRideState, type PortalRideLane, type RideRings } from './walkInPortalRide';
import { createPortalTraversal, type PortalTransfer, type PortalTraversalPorts } from './portalTraversal';

/** the ride's rows: its director (a `directors` id), walk-in volume, fade and the facts a landing reports */
export interface PortalRideRows {
  readonly director: string;
  readonly trigger: RideRings['trigger'];
  readonly fade: RideRings['fade'];
  readonly landings: readonly { readonly node: string; readonly fact: string }[];
}
/** where a landing's fact goes: the page's bound ledger or the host's effect buffer */
export type PortalFacts = (name: string, entity: string) => void;
/** a shardfile's portal entries and the rules' inputs (its props and collision) */
export type PortalSource = Parameters<typeof portalLinkRules>[1] & {
  readonly entryways: readonly { readonly edge: PortalLinkEntry['edge']; readonly portal?: PortalLinkEntry['portal'] }[];
  readonly directors?: readonly { readonly id: string }[] | null;
};
/** the player as the ride moves it: feet, motor, board, the hold and the resets */
export interface PortalPlayer {
  readonly position: PortalTraversalPorts['feet'];
  readonly motor: PortalTraversalPorts['motor'];
  hover: boolean;
  carried: boolean;
  setHover: (on: boolean) => void;
  spawn: (x: number, z: number, yaw: number, y?: number) => void;
}
/** the portals while they run (captures and tests read them) */
export interface PortalRide {
  readonly entered: () => PortalLinkEntry['edge'] | null;
  readonly busy: () => boolean;
  readonly rides: () => readonly PortalTransfer[];
  readonly refused: () => readonly string[];
  step: (dt: number) => void;
  snapshot: () => PortalRideState;
  restore: (state: PortalRideState) => void;
}

/** the declared links with a portal; missing links never become portals */
export function declaredPortals(source: PortalSource): PortalLinkEntry[] {
  return source.entryways.flatMap(row => row.portal === undefined ? [] : [{ edge: row.edge, portal: row.portal }]);
}

/** the player's side of a ride: the hold, the checked transfer from a declared node, the resets facing the new heading */
export interface PortalRider {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  hold: (on: boolean) => void;
  teleport: (from: string) => PortalTransfer;
  settle: (yaw: number) => void;
}

/** The player as a rider: a grid frame rebinds its physics and motor, so they are read again per transfer. */
export function portalRider(player: PortalPlayer, physics: () => PortalTraversalPorts['physics'], source: PortalSource): PortalRider {
  const ports = { physics: physics(), motor: player.motor, feet: player.position }, traversal = createPortalTraversal(declaredPortals(source), source, ports), spawn = player.spawn.bind(player);
  return { position: player.position,
    hold: on => { if (on && player.hover) player.setHover(false); player.carried = on; },
    teleport: from => { ports.physics = physics(); ports.motor = player.motor; return traversal.teleport(from); },
    settle: yaw => { const p = player.position; spawn(p.x, p.z, yaw, p.y); } };
}

/** the ride's rings from its rows and the shardfile's links and director */
export function portalRings(source: PortalSource, rows: Pick<PortalRideRows, 'director' | 'trigger' | 'fade'>): RideRings {
  const stages = source.directors?.find(row => row.id === rows.director);
  if (stages === undefined) throw new Error(`Missing portal director ${rows.director}`);
  return { entries: declaredPortals(source), trigger: rows.trigger, fade: rows.fade, stages };
}

/** One ride: each frame's hold and checked transfer, the veil's amount, and a fact per declared landing. */
export function bindPortalRide(rider: PortalRider, veil: (amount: number) => void, rings: RideRings, landings: PortalRideRows['landings'] = [], facts: PortalFacts = () => undefined): PortalRide {
  return bindPortalLane(rider, veil, createPortalRide(rings), landings, facts);
}

/** One ride over a lane the caller made, which a page does to refuse a bad declaration before it mounts anything. */
export function bindPortalLane(rider: PortalRider, veil: (amount: number) => void, lane: PortalRideLane, landings: PortalRideRows['landings'], facts: PortalFacts): PortalRide {
  return { entered: lane.entered, busy: lane.busy, rides: lane.rides, refused: lane.refused, snapshot: lane.snapshot, restore: lane.restore,
    step: dt => {
      const frame = lane.observe(dt, rider.position);
      for (const command of frame.commands.slice(0, 3)) {
        if (command.kind === 'hold') { rider.hold(command.on); continue; }
        try {
          const transfer = rider.teleport(command.from); rider.settle(transfer.yaw); lane.complete(transfer);
          for (const row of landings) if (row.node === transfer.to) facts(row.fact, row.node);
        } catch (error) { lane.refuse(error instanceof Error ? error.message : String(error)); }
      }
      veil(frame.veil);
    } };
}

/** What the ride uses of the renderer-free host: its player, the player's fall, impulse, knockback, dash and board, its
 *  physics, and a fixed-step system with continuation. */
export interface RidePlayer {
  readonly position: PortalPlayer['position'] & { set: (x: number, y: number, z: number) => unknown }; yaw: number; readonly motor: PortalPlayer['motor'];
  readonly velocity: { y: number };
  readonly fall: { grounded: boolean };
  readonly impulse: { set: (x: number, y: number, z: number) => unknown };
  readonly shove: { t: number };
  readonly dash: { t: number };
  readonly board: { readonly on: boolean };
  setBoard: (on: boolean) => void;
}
export interface RideHost<Physics> {
  readonly players: ReadonlyMap<string, RidePlayer>;
  readonly physics: Physics;
  onStep: (id: string, run: (dt: number) => void, adapter: { snapshot: () => string; restore: (value: unknown) => void }) => unknown;
}

const finite = v.pipe(v.number(), v.finite());
const SeatSavedSchema = { held: v.nullable(v.strictObject({ x: finite, y: finite, z: finite })), ride: PortalRideStateSchema };
/** Alone, the first player's seat as it always saved; the rest beside it, only with company. */
const Saved = v.strictObject({ ...SeatSavedSchema, others: v.exactOptional(v.record(v.string(), v.strictObject(SeatSavedSchema))) });
interface Point { x: number; y: number; z: number }
interface SeatSaved { held: Point | null; ride: PortalRideState }

/** The host's ride on its fixed step under `id`: `carried` holds the feet still while the fade runs, `spawn` releases the
 *  motor and clears every velocity; the hold and the ride are exact continuation. */
export function installHostPortalRide(host: RideHost<PortalTraversalPorts['physics']>, id: string, source: PortalSource, rows: PortalRideRows, facts: PortalFacts, factsOf: (player: string) => PortalFacts = () => () => undefined): PortalRide {
  /** One player's ride and hold. */
  const seat = (player: RidePlayer, landed: PortalFacts) => {
    const holdPoint = { x: 0, y: 0, z: 0 }, spawnPoint = { x: 0, y: 0, z: 0 };
    let held: Point | null = null;
    const keep = (at: Point): void => {
      player.position.set(at.x, at.y, at.z); player.motor.resetAt(at);
      player.velocity.y = 0; player.fall.grounded = false; player.impulse.set(0, 0, 0); player.shove.t = 0;
    };
    const body: PortalPlayer = {
      // the motor is read each time: a restore rebuilds the player's motor on the restored physics after install
      position: player.position, get motor() { return player.motor; },
      get hover() { return player.board.on; },
      get carried() { return held !== null; },
      set carried(on) {
        holdPoint.x = player.position.x; holdPoint.y = player.position.y; holdPoint.z = player.position.z;
        held = on ? holdPoint : null;
        if (held !== null) keep(held);
      },
      setHover: (on) => { player.setBoard(on); },
      spawn: (x, z, yaw, y) => { player.yaw = yaw; player.motor.release(); player.dash.t = 0; spawnPoint.x = x; spawnPoint.y = y ?? player.position.y; spawnPoint.z = z; keep(spawnPoint); },
    };
    const ride = bindPortalRide(portalRider(body, () => host.physics, source), () => undefined, portalRings(source, rows), rows.landings, landed);
    return { ride, player, step: (dt: number): void => { if (held !== null) keep(held); ride.step(dt); }, save: (): SeatSaved => ({ held, ride: ride.snapshot() }),
      load: (saved: SeatSaved): void => { ride.restore(saved.ride); held = saved.held; } };
  };
  const [first] = host.players.values(); if (first === undefined) throw new Error('Simulation host has no player');
  const lead = seat(first, facts), others = new Map<string, ReturnType<typeof seat>>();
  /** Another player's seat: a body that left and came back rides anew. */
  const seatOf = (key: string, player: RidePlayer): ReturnType<typeof seat> => {
    const known = others.get(key);
    if (known?.player === player) return known;
    const made = seat(player, factsOf(key)); others.set(key, made); return made;
  };
  host.onStep(id, (dt) => {
    lead.step(dt);
    for (const key of others.keys()) if (!host.players.has(key)) others.delete(key);
    for (const [key, player] of host.players) if (player !== first) seatOf(key, player).step(dt);
  }, { snapshot: () => JSON.stringify({ ...lead.save(), ...(others.size === 0 ? {} : { others: Object.fromEntries([...others].map(([key, row]) => [key, row.save()])) }) }), restore: (value) => {
    if (typeof value !== 'string') throw new Error(`Invalid portal continuation (${id})`);
    const { others: saved = {}, ...own } = v.parse(Saved, JSON.parse(value));
    lead.load(own); others.clear();
    for (const [key, row] of Object.entries(saved)) {
      const player = host.players.get(key);
      if (player === undefined) throw new Error(`Invalid portal continuation (${id})`);
      seatOf(key, player).load(row);
    }
  } });
  return lead.ride;
}

import type { NetAct } from '@wildshard/wire/netCommand';
import type { NetClimateAct } from '../net/acts';
import type { SimHost } from '../../../server/engine/sim';

/** The tick command a named interaction is, as its owner reads it. */
export interface InteractRoute { readonly actorId: string; readonly value: number }
/** Where a net act lands in a host's tick commands. A shard's systems file these as they install; a room only reads them. */
export interface ActRoutes {
  /** Session seats to persistent player identities. Standalone accepts its device hello; dedicated hosts must bind verified identities. */
  readonly identities: Map<string, string>;
  /** Interaction row id to its tick command. A row a lash runs is not here: no client asks for it by name. */
  readonly interactions: Map<string, InteractRoute>;
  /** The script actor a player's loadout picks its slot from, on a shard with a native loadout. */
  equip: string | null;
  /** The script actor a LOCK press lands on, on a shard with a grapple. */
  lock: string | null;
  /** A player's riding act, on a shard with taming. */
  ride: ((player: string, action: Extract<NetAct, { kind: 'ride' }>['action']) => void) | null;
  /** Whether a creature takes a rider as it stands, on a shard with taming: what a client's prompt reads off its row. */
  mountable: ((id: string) => boolean) | null;
  /** A player's lean and look while they ride, on a shard with taming. */
  lean: ((player: string, lean: number, pitch: number) => void) | null;
  /** Whether a launcher input lands on an owner that takes it, on a shard with native items: a client names any slot. */
  launcher: ((slot: number, reload: boolean, fire: boolean) => boolean) | null;
  /** A `seen:` flag a player's client says they walked into, where a host keeps its places. */
  seen: ((player: string, flag: string) => void) | null;
  /** A reading a page finished, by the flag it raises: the server judges it against that player's own talk. */
  story: ((player: string, flag: string) => void) | null;
  /** A player's bond with a tamed body: what a story reads of it. */
  bonded: ((player: string, value: string) => void) | null;
  /** Whether a player stands in the shard's arena room, for a story that reads it. */
  inside: ((player: string) => boolean) | null;
  /** Whether the shard's open fight is tied down, for a story that reads it. */
  tied: (() => boolean) | null;
  /** A player's purchase, where a host keeps an exchange. */
  buy: ((player: string, good: number) => void) | null;
  /** A player's hand on the contract board, where a host keeps one. */
  board: ((player: string, op: 'claim' | 'tear', slot: number) => void) | null;
  /** A player puts on or takes off a cosmetic. */
  wear: ((player: string, id: string) => void) | null;
  /** A boss's intro holds whoever stands in its arena. Only a page's session asks: a tape's steps run on through one. */
  introLocks?: boolean;
  /** A Developer asked that a fight's blows not land: a lair's script sees it, as a page's did. */
  god?: boolean;
  /** A lone player's word on the sky, on a world with weather. */
  climate: ((act: Pick<NetClimateAct, 'op' | 'name' | 'at'>) => void) | null;
  /** A lone player's Developer time of day, on a world with a clock. */
  time: ((pick: string) => void) | null;
  /** A lone player's day, back from a room: the world held and the page's clock didn't. */
  day?: (phase: number) => void;
  /** The `mem` inputs a client's pose programs read: what a room tells it of a body beyond its rows. */
  readonly poseInputs: Set<string>;
  /** What a press takes by name with no prompt row of its own: a fight's reward. */
  readonly claims: Map<string, (player: string) => void>;
  /** Whether a player holds this tick's HOLD TO SKIP. */
  skipHeld: boolean;
  /** Inputs that fit the wire and that this world had no use for, until the room counts them. */
  refused: number;
}
/** A LOCK press as a script value: 1 picks nothing, and a hook the client named (its index in the course) is that plus 2. */
export const lockValue = (hook: number | undefined): number => hook === undefined ? 1 : hook + 2;
/** The hook a LOCK's script value names. */
export const lockedHook = (value: number): number | undefined => value < 2 ? undefined : value - 2;
const routes = new WeakMap<SimHost, ActRoutes>();
/** One host's routes (P1-E5.2c). */
export function actRoutes(host: SimHost): ActRoutes {
  let held = routes.get(host);
  if (held === undefined) { held = { identities: new Map(), interactions: new Map(), poseInputs: new Set<string>(), time: null, equip: null, lock: null, ride: null, mountable: null, lean: null, launcher: null, seen: null, story: null, bonded: null, inside: null, tied: null, buy: null, board: null, wear: null, climate: null, claims: new Map(), skipHeld: false, refused: 0 }; routes.set(host, held); }
  return held;
}

import type { StandingLook } from '@wildshard/engine/sim/shardRows';

/** What a page's traversal prompts name on the wire: a server has no prompt row for these, so both sides spell the id from a row they each hold. */
export const carryPrompt = (mover: string, end: number): string => `${mover}.ride.${String(end)}`;
/** MIRROR-SALT-ZONE MSZ9b: a vehicle's prompts by wire id: a free seat's; a player dock's (which spawns that player's vehicle and
 * seats them to drive); a seated rider's way out. A server's `VehicleRuntime` claims them, and each page spells them alike. */
export const vehicleSeatPrompt = (vehicle: string, seat: number): string => `${vehicle}.seat.${String(seat)}`;
export const vehicleDockPrompt = (dock: string): string => `${dock}.dock`;
export const vehicleLeavePrompt = (vehicle: string): string => `${vehicle}.leave`;
/** A per-player vehicle's id: its dock's, a colon, then its owner's (an act's id takes only `[a-zA-Z0-9._:-]`, and a dock's
 * id has no colon). A shared dock's vehicle goes by the dock's own id. */
export const playerVehicle = (dock: string, player: string): string => `${dock}:${player}`;
/** The dock a vehicle id came from. */
export const vehicleDockOf = (vehicle: string): string => { const cut = vehicle.indexOf(':'); return cut === -1 ? vehicle : vehicle.slice(0, cut); };
const SEAT_ROW = 'vehicle.seat|';
/** A taken seat's `state` row (MSZ9b): there while someone sits in it, gone when it empties; its value is 1. */
export const vehicleSeatRow = (vehicle: string, seat: number, player: string): string => `${SEAT_ROW}${vehicle}|${String(seat)}|${player}`;
/** A seat row's vehicle, seat and rider, or null for any other row. */
export function parseVehicleSeatRow(name: string): { readonly vehicle: string; readonly seat: number; readonly player: string } | null {
  if (!name.startsWith(SEAT_ROW)) return null;
  const [vehicle, seat, ...player] = name.slice(SEAT_ROW.length).split('|'), index = Number(seat);
  return vehicle === undefined || vehicle === '' || !Number.isInteger(index) || index < 0 || player.length === 0 ? null : { vehicle, seat: index, player: player.join('|') };
}
/** The view call a boss's strike goes by, with its id behind it: a page's telegraph has no body of its own to read one off. */
export const BOSS_STRIKE = 'boss.strike.';
/** What a roaming boss's fight tells its views, by name: a page on a server steps no fight. */
export const ROAMING_VIEW = { light: 'roaming.light', roar: 'roaming.roar', burst: 'roaming.burst', hazard: 'roaming.hazard', add: 'roaming.add', ring: 'roaming.ring', tell: 'roaming.tell', tellOff: 'roaming.tell.off', lane: 'roaming.lane', room: 'roaming.room', rig: 'roaming.rig', struck: 'roaming.struck' } as const;
/** A roaming fight's looks that stand once said. The rest come every tick while they last, or are cues that must not replay (FLIP-6). */
export const ROAMING_STANDING: readonly StandingLook[] = [{ name: ROAMING_VIEW.room }];
/** An arena fight's looks that stand once said, by the names its data binds. Rings, pours and sweeps are said every tick while they last. */
export const ARENA_STANDING: readonly StandingLook[] = [
  { name: 'arena.lid.open' }, { name: 'arena.shaft', slotted: true }, { name: 'adds.spot', slotted: true }, { name: 'boss.glow' }, { name: 'victory.heap' },
  { name: 'arena.shield', endedBy: ['arena.fx.hide'] }, { name: 'arena.shield.at', endedBy: ['arena.fx.hide'] }, { name: 'strike.arc', endedBy: ['strike.arc.off', 'arena.fx.hide'] },
];
/** What an open arena's fight tells its views, by name: a page on a server steps no fight, so it draws what these say. */
export const OPEN_ARENA_VIEW = { look: 'open-arena.look', tell: 'open-arena.tell', whirl: 'open-arena.whirl', fire: 'open-arena.fire', cells: 'open-arena.cells' } as const;
/** A tell's calls, as `OPEN_ARENA_VIEW.tell` numbers them. */
export const ARENA_TELL_CALLS = ['ring', 'lane', 'wedge', 'hide'] as const;
/** A tell's slot on the wire: its id's place in the arena's tell rows, and which of that id. */
export const arenaTellSlot = (id: number, index: number): number => id * 16 + index;
/** A hazard's beats, as `ROAMING_VIEW.hazard` numbers them. */
export const ROAMING_HAZARD_EVENTS = ['drop', 'fall', 'land', 'burn', 'out', 'placed'] as const;
/** The view calls an elite's ground tells go by. */
/** The word a server's spawn script says its cues under: a cue's id, then where it landed. */
export const spawnCueWord = (script: string): string => `spawn.cue:${script}`;
export const ELITE_TELL = { lane: 'elite.tell.lane', ring: 'elite.tell.ring', cue: 'elite.cue', hit: 'elite.hit' } as const;
/** The arrow a patrol's rider looses: where it leaves, then its velocity. */
export const PATROL_SHOT = 'patrol.shot';
/** Each step a rider is dying: where it tears. */
export const PATROL_TEAR = 'patrol.tear';
/** One slot of a thrown volley, as a script row. */
export const volleyRow = (owner: string, slot: number): string => `volley.${owner}.${String(slot)}`;
/** A socket lift's deck, by the call it takes. */
export const liftPrompt = (mover: string, action: 1 | 2 | 3): string => `${mover}.lift.${String(action)}`;

/**
 * The PERF LAP's gate and its host (E350 F-J1, Jake: "Automate it" — one tap in the fps panel stands you at each of the
 * shard's spots in turn, records the frames while the view turns a slow 360°, brings you back, and prints a summary to
 * copy). src/client/engine/ui/perfLap.ts runs the lap; the shard that can be lapped registers a host here (Pine Hollow:
 * src/shards/pine-hollow/runtime/dev/perfLap.ts).
 *
 * `perfLap.active` is true for the whole lap. A teleport must not play the game: every check that reads the player's
 * x / z and saves something (a place discovered, the journal, an elite's lair found, the King's clearing, the stag, the
 * night thralls) asks this first, like `practiceRoom.open` — no quest flag, save or fight comes out of a lap.
 */
import type { Game } from '../../../client/engine/core/Game';

/** a spot the lap stands at: feet at (x, z) (on the ground, or at `y`), facing (−sin yaw, −cos yaw) before the turn */
export interface LapSpot { id: string; x: number; z: number; yaw: number; y?: number }

/** the player as the lap moves it (src/client/engine/player/Player.ts) */
export interface LapPlayer {
  readonly position: { x: number; y: number; z: number };
  yaw: number; pitch: number;
  spawn: (x: number, z: number, yaw: number, y?: number) => void;
}

export interface PerfLapHost {
  /** the shard's game: a parked shard's host never laps the running one */
  game: Game;
  shard: string;
  spots: readonly LapSpot[];
  player: LapPlayer;
  /** why the lap cannot start (or must stop) now — a practice room, a fight, a ride — or null */
  busy: () => string | null;
  /** the lap starts (true) / ends (false): the host quiets what `perfLap.active` does not cover (the herds' notice) */
  hold: (on: boolean) => void;
  toast: (text: string) => void;
}

/** the PERF LAP's gate (`active` for the whole lap) and the host a lappable level registers */
export const perfLap: { active: boolean; host: PerfLapHost | null } = { active: false, host: null };

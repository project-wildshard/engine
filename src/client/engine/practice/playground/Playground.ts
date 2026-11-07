/**
 * A feature playground (E307): a standalone dev level for one shard's own verb, entered from the Explore hub the way the
 * Practice arena is (main.ts `enterPlayground`), with the shard's real code — Nine Dragon's Fei Zhua, Nalati's riding.
 *
 *   const pg = await loadPlayground('grapple', host)   // src/client/engine/practice/playground/load.ts: the scene's module on the tap
 *   pg.enter()        // built on first entry (its colliders registered then), the player put on its start
 *   pg.exit()         // pause ▸ Exit to Explore (or to the title): the room is hidden, the shard's own rules come back
 *
 * Like the Practice arena, a playground hangs high over the shard it belongs to — so high (PLAYGROUND_Y) that the whole
 * shard is past the camera's 2.6 km far plane and frustum-culled while you play: the scene draws only the playground.
 * It dispatches `ws:practice-active` (a practice room is up: no city grade, no drizzle, a depth-tested sun halo) and asks
 * mobile for 60 fps like the arena does (tier.ts practiceFps). That event is `practiceRoom.open` (src/client/engine/core/practiceRoom.ts):
 * the shard's open-world systems read it and step aside while you play (E321: no crouch / stealth off the grass 3 km under
 * you, no elites or night riders); the minimap draws the room's own `map`.
 */
import type * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Player } from '../../player/Player';
import type { Physics } from '../../../../shared/engine/physics/Physics';
import type { WorldRegistry } from '../../world/registry';
import type { RowBodiesView } from '../../entities/RowBodies';
import type { PlaygroundId } from './catalog';
import type { RoomMap } from '../../ui/roomMap';

/** metres over the shard's datum a playground's floor stands: every shard (≤ ~300 m tall) is past the 2 600 m far plane */
export const PLAYGROUND_Y = 3000;

export interface PlaygroundHost {
  game: Game;
  player: Player;
  registry: WorldRegistry;
  physics: Physics;
  /** the shard's spawn: the playground stands over it (x, z) */
  spawn: { x: number; z: number };
  toast: (text: string) => void;
  animals: RowBodiesView;
}

export interface Playground {
  readonly id: PlaygroundId;
  readonly title: string;
  readonly entered: boolean;
  /** the room's centre */
  readonly center: { x: number; z: number };
  /** the room's own map (E321): the minimap and the full map draw it while the room is up, not the shard's (main.ts
   *  `minimap.setRoom(pg.map)`; src/client/engine/ui/roomMap.ts) */
  readonly map: RoomMap;
  enter: () => void;
  exit: () => void;
  /** the scene's root (tests and captures read it) */
  readonly root: THREE.Object3D;
}

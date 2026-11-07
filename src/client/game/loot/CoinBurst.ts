/**
 * CoinBurst — a kill's doubloons in the world (E314 L1, board 1 A): the coins burst out of the body in a short arc,
 * hang a beat, then fly to you (a magnet) and are counted on arrival. One InstancedMesh for every coin in flight (the
 * interactables kit's faceted gold `coinModel`, unlit so it reads in the jungle shade); a fixed pool, no allocation per
 * frame, one draw call. A coin that can't reach you (you teleported, a cut-scene) lands anyway after `MAX_LIFE`.
 *
 *   const burst = new CoinBurst(scene);
 *   burst.spawn(a.position, 5, (n) => purse.add(n), () => sfx.interact('chime'));  // 5 coins' worth: each coin carries its share
 *   game.onUpdate((dt) => burst.update(dt, player.position));                      // the target is the player's chest
 *   burst.dispose()
 */
import type { Scene } from 'three';
import { app } from '@wildshard/engine/app/runtime';
import { CoinMotion } from './CoinMotion';

/** Page adapter: preserve the original lazy cosmetic RNG lookup. */
export class CoinBurst extends CoinMotion {
  constructor(scene: Scene, random: () => number = () => app.rng.stream('cosmetic').next()) { super(scene, random); }
}

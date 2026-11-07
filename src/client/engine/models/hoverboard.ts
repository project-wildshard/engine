/**
 * The hoverboard (E348, the E315 M5 leftover): one shared model on every shard — the board the player rides in hover mode
 * (Player.hover, the H key / the HOVER tab): a rounded dark deck (0.9 × 0.28 m) with a cyan edge strip, a nose lamp and an
 * inlay, and two glowing repulsor discs underneath. The viewmodel (src/client/game/systems/tools/hoverboard.ts) keeps drawing the one you
 * ride — its own depth clear, render queue and pulsing glow; the card is a SEPARATE build by the same builder
 * (`buildHoverboard`) on its own materials, in the normal queue, so nothing the Explorer does reaches the board under you.
 * Listed on every shard (src/client/engine/models/roster.ts), one copy: the player's.
 */
import * as THREE from 'three';
import { buildHoverboard } from '../render/hoverboardGeometry';
import { defineModel, type ModelDef } from './model';

/** how far the halos hang under the deck's centre (Hoverboard.ts: THICK / 2 + 0.045 + the halo's own 0) */
const UNDER = 0.032 / 2 + 0.045;

export const hoverboard: ModelDef<object> = defineModel<object>({
  id: 'shared/hoverboard', name: 'Hoverboard', category: 'gear', pipeline: 'code', file: 'src/client/engine/models/hoverboard.ts', surface: 'metal',
  defaults: {},
  build: () => {
    const board = new THREE.Group();
    const { glow } = buildHoverboard(board);
    board.traverse((o) => { if (o instanceof THREE.Mesh && o.material !== glow) { o.castShadow = true; o.receiveShadow = true; } });
    board.position.y = UNDER; // the specimen stands on its halos (the model's foot)
    const holder = new THREE.Group();
    holder.name = 'hoverboard';
    holder.add(board);
    return holder;
  },
});

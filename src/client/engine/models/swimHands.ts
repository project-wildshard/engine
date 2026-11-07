import { engineString } from '../../../shared/engine/strings';
/**
 * The swimming hands (E348, the E315 M5 leftover): a shared model — the white-gloved forearms and mitten hands you see
 * while swimming on a shard without its own arm rig (Nalati's river, Pine Hollow's pond and creek; Driftwood swims in the
 * castaway's arms, its gear cards). The viewmodel (src/client/engine/player/Hands.ts) keeps drawing the pair at the water line, with
 * its own depth clear and render queue, and strokes them every frame; the card is a SEPARATE build by the same builder
 * (`buildSwimGloves`) on its own materials, standing in the tread pose (the hands out to the sides, the forearms aimed
 * from the elbows), lifted onto the turntable's disc. Variants: the smooth gloves every shard wears and the faceted ones
 * a low-poly shard would. One copy: the player's.
 */
import * as THREE from 'three';
import { buildSwimGloves, ELBOW, IDLE, type SwimStyle } from '../player/Hands';
import { defineModel, type ModelDef } from './model';

export interface SwimHandsParams { readonly style: SwimStyle }

const FWD = new THREE.Vector3(0, 0, -1);

/** the first-person swimming hands, smooth or faceted */
export const swimHands: ModelDef<SwimHandsParams> = defineModel<SwimHandsParams>({
  id: 'shared/swim-hands', name: 'Swimming hands', category: 'gear', pipeline: 'code', file: 'src/client/engine/models/swimHands.ts', surface: 'flesh',
  defaults: { style: 'pbr' },
  variants: [{ id: 'smooth', label: engineString('s_da5193877772'), params: { style: 'pbr' } }, { id: 'faceted', label: engineString('s_e272f5b4fded'), params: { style: 'toon' } }],
  build: (ctx, p) => {
    const pair = new THREE.Group();
    buildSwimGloves(ctx.sky, p.style).forEach((arm, i) => {
      const side = i === 0 ? 1 : -1;
      // Hands.update treading water, at rest: the wrist at IDLE (mirrored for the left), the forearm from the elbow to it
      const wrist = new THREE.Vector3(IDLE.x * side, IDLE.y, IDLE.z);
      arm.position.copy(wrist);
      arm.quaternion.setFromUnitVectors(FWD, wrist.clone().sub(new THREE.Vector3(ELBOW.x * side, ELBOW.y, ELBOW.z)).normalize());
      arm.rotateZ(-side * 0.15);
      arm.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      pair.add(arm);
    });
    // camera space → the disc: centred over the origin, the lowest point on it
    const box = new THREE.Box3().setFromObject(pair);
    pair.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const holder = new THREE.Group();
    holder.name = 'swim-hands';
    holder.add(pair);
    return holder;
  },
});

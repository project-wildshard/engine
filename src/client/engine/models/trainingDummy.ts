/**
 * The training dummy (E285 / E289; E306 / E315 M5): one shared model on every shard — the practice arena's figures, three
 * TRELLIS.2 casts skinned in Blender (scripts/practice/build_dummies.sh: reference → TRELLIS.2 → closed bake → clean + rig
 * → pack; public/assets/practice/dummies/*.glb), the procedural figure (src/client/engine/practice/TrainingDummy.ts) standing in when a
 * file fails. Variants: the three armours. The arena stands its three up and swings them on springs
 * (src/client/engine/practice/TrainingArena.ts, DummyMotion.ts); the Explorer's specimen is lit with the arena's studio set
 * (DummyStudio.ts, E289), and waits for its file as the arena does: a wireframe box until it lands.
 *
 * E348: the arena's dummies go through the contract. Its lineup is placements of this model (src/client/engine/practice/lineup.ts, one
 * armour per spot: `paramsOf` reads each copy's variant), and every copy is built here — `dummyFigure`, and `dummyStandIn`
 * while the files load — so the arena's figures and the card's specimen are one builder.
 */
import * as THREE from 'three';
import { DUMMY_VARIANTS, TRAINING_DUMMY_HEIGHT } from '../practice/dummyMetadata';
import type { DummyVariant } from '../practice/TrainingDummy';
import { defineModel, type ModelDef } from './model';

export interface TrainingDummyParams { readonly variant: DummyVariant }

const ID = 'shared/training-dummy';

/** the wireframe box a specimen shows while its file loads */
function loadingBox(): THREE.Mesh {
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.58, TRAINING_DUMMY_HEIGHT, 0.34), new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.22, wireframe: true, depthWrite: false }));
  box.position.y = TRAINING_DUMMY_HEIGHT / 2;
  return box;
}

export const trainingDummy: ModelDef<TrainingDummyParams> = defineModel<TrainingDummyParams>({
  id: 'shared/training-dummy', name: 'Training dummy', category: 'props', pipeline: ['trellis', 'blender'], file: 'src/client/engine/models/trainingDummy.ts', surface: 'wood',
  defaults: { variant: 'wood' },
  variants: DUMMY_VARIANTS.map((v) => ({ id: v.id, label: v.label, params: { variant: v.id } })),
  build: (ctx, p) => {
    const holder = new THREE.Group();
    holder.add(loadingBox());
    void (async (): Promise<void> => {
      const [{ dummyFigure }, { applyDummyStudio }] = await Promise.all([import('./trainingDummyFigure'), import('../practice/DummyStudio')]);
      const figure = (await dummyFigure(p.variant, 'Model Explorer')).root;
      if (ctx.renderer) applyDummyStudio(figure, ctx.renderer); // the arena's studio set, emissive 0 (E289)
      holder.clear();
      holder.add(figure);
      if ('document' in globalThis) document.dispatchEvent(new CustomEvent('ws:model-ready', { detail: { id: ID } }));
    })();
    return holder;
  },
});

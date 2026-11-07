/**
 * The interactables' model helpers (E306 / E315 M1): a lit part (the shared low-poly material), a glowing one (unlit,
 * as the runtime's glow batch) and a floating pickup. The props and their models are content, the game's
 * (src/client/game/systems/props/interact.ts, src/client/game/models/interact.ts, E405 E417); the runtime (../world/interact/Interactables.ts)
 * places them as each kind's rows.
 */
import * as THREE from 'three';
import { lowPolyLookMaterial } from '../world/lowpolyKit';
import { defineModel, type ModelContext, type ModelDef, type ModelPart } from './model';

const FILE = 'src/client/engine/models/interact.ts';

/** a lit part (the shared low-poly material) and a glowing one (unlit, as the kit's glow batch), posed at `m` */
export const lit = (ctx: ModelContext, g: THREE.BufferGeometry, m?: THREE.Matrix4): ModelPart =>
  ({ geometry: m ? g.applyMatrix4(m) : g, material: lowPolyLookMaterial(ctx.sky), castShadow: true, receiveShadow: true });
export const glow = (ctx: ModelContext, g: THREE.BufferGeometry, m?: THREE.Matrix4): ModelPart =>
  ({ geometry: m ? g.applyMatrix4(m) : g, material: ctx.once('shared/interact:glow', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: true })) });

/** a pickup: its part floating at its bob's rest height (the kit spins and bobs it round there) */
export function pickup(id: string, name: string, height: number, make: (ctx: ModelContext) => ModelPart[], file: string = FILE): ModelDef<Record<string, never>> {
  return defineModel<Record<string, never>>({ id, name, category: 'props', pipeline: 'code', file, defaults: {}, build: (ctx) => {
    const parts = make(ctx);
    for (const part of parts) part.geometry.translate(0, height, 0);
    return parts;
  } });
}

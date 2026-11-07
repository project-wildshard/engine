/**
 * three's `compile()` renders the target scene's whole shadow pass first when a nodes handler is installed, only so node
 * materials find the shadow maps when they are built (three.module `compile`: "node materials reference the shadow map").
 * The engine installs none since NF18 retired the TSL back-end, so today the skip below never triggers.
 * A warm-up issues one compile per job, so every job redrew every caster in the live scene: a 64 ms shadow pass inside one
 * 100 ms Pine drive frame on desktop Chromium. The pass draws the live scene, never the job's own stand-ins (their depth
 * variants are shadowJobs' work), and the real frame draws the same shadows anyway. So while every shadow light already
 * has its map, a shadow pass asked for inside `compile()` is skipped; a light still without one gets the pass as before.
 */
import { LightShadow, type Light } from 'three';
import type { Renderer } from './renderer';

// a light type with no shadow of its own reads as mapless, so its pass is never skipped
const hasMap = (light: Light): boolean => { const shadow: unknown = Reflect.get(light, 'shadow'); return shadow instanceof LightShadow && shadow.map !== null; };

type CompileRenderer = Pick<Renderer, 'compile'> & { shadowMap: Pick<Renderer['shadowMap'], 'render'> };

export function installCompileShadowSkip(renderer: CompileRenderer): void {
  let compiling = 0;
  const compile = renderer.compile.bind(renderer), shadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.compile = (scene, camera, target) => {
    compiling++;
    try { return compile(scene, camera, target); } finally { compiling--; }
  };
  renderer.shadowMap.render = (lights, scene, camera) => {
    if (compiling > 0 && lights.every(hasMap)) return;
    shadows(lights, scene, camera);
  };
}

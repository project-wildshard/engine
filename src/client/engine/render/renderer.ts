/**
 * The renderer handle (E357 X6, decision 22: WebGPU containment). Outside `src/client/engine/render/**` code names
 * `Renderer`, never three's WebGL class (`wildshard/no-renderer-type`), so a future port changes this file and the
 * inventory's checklist (docs/design/webgpu-port-inventory.md), not every module that is handed the renderer.
 * No TSL, no WebGPURenderer (X6).
 */
import { clearCreationErrors } from './contextErrors';
import * as THREE from 'three';
import { installGpuLabels, labelledCreation } from './gpuLabels';
import { installFrameCounter } from './frameCounter';
import { installTextureUploadEvents } from './textureUploadEvents';
import { installCompressedTextureRetirement } from './compressedTextureRetirement';
import { installDiagnosticJournal } from './diagnosticJournal';
import { installDoubleElements } from './doubleElements';
import { installUniformCacheKinds } from './uniformCaches';
import { installCompileShadowSkip } from './compileShadows';
import { installSkinnedSortSpheres } from './skinnedSpheres';
import { isDev, onDev } from '../core/devMode';
import { installShadowMaterialOwnership } from './shadowMaterialOwnership';
import { gltfOpaqueSort } from './gltfMaterialOrder';
import type { AssetService } from '../app/assets';
import type { Scope } from '../../../shared/engine/app/scope';
import type { UploadOwnership } from './uploadOwnership';

/** the renderer every layer is handed (today three's WebGL renderer) */
export type Renderer = THREE.WebGLRenderer;

/** a throw-away renderer on its own canvas, to probe the GPU's formats before the game's exists (KTX2 support) */
export function probeRenderer(): Renderer {
  return labelledCreation('engine/renderer', 'builtin/probe-renderer', () => new THREE.WebGLRenderer({ canvas: document.createElement('canvas') }));
}


/** Create the client renderer and install upload observation before native shadow-cache ownership. */
export function createRenderer(canvas: HTMLCanvasElement, context: WebGL2RenderingContext, ownership: { assets: AssetService; scope: Scope; uploads: UploadOwnership }): Renderer {
  clearCreationErrors(context);
  installDoubleElements();
  installSkinnedSortSpheres();
  const stopJournal = installDiagnosticJournal(context);
  const renderer = labelledCreation('engine/renderer', 'builtin/renderer-initialization', () => new THREE.WebGLRenderer({ canvas, context, antialias: false, stencil: false, depth: true }));
  // D176: three's link check read three driver info logs on every program's first use (~1.4 ms of sync round-trips a
  // program: 175 ms of a Nalati crossing's shader warm-up); the warm-up reads one link status instead and reports a
  // failure as three would (precompile.ts reportLinkFailure)
  renderer.debug.checkShaderErrors = false;
  renderer.setOpaqueSort(gltfOpaqueSort);
  installUniformCacheKinds(renderer); // D180: float uniform caches keep double elements (uniformCaches.ts)
  ownership.uploads.attach(renderer);
  installShadowMaterialOwnership(renderer, ownership.assets, ownership.scope);
  installCompileShadowSkip(renderer);
  const stopLabels = installDeveloperLabels(renderer);
  const dispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => { try { dispose(); } finally { stopLabels(); stopJournal(); } };
  installFrameCounter(renderer); // SF59: the engine counts its own renders (frameCounter.ts)
  installTextureUploadEvents(renderer);
  installCompressedTextureRetirement(renderer);
  return renderer;
}

/** T10: the GPU labels are Developer's (and the census harnesses'), like the allocation journal: the public build's draws,
 *  renders and compiles skip their wrappers altogether (an extra call layer on every draw of a Pine frame). Turning
 *  Developer on installs them from then on (a new diagnostic interval); they stay until the renderer goes. */
function installDeveloperLabels(renderer: Renderer): () => void {
  const census = typeof window !== 'undefined' && typeof Reflect.get(window, '__sc_label_gl') === 'function';
  if (census || isDev()) { installGpuLabels(renderer); return () => undefined; }
  let stop: (() => void) | undefined;
  stop = onDev(on => { if (!on || stop === undefined) return; stop(); stop = undefined; installGpuLabels(renderer); });
  return () => { stop?.(); stop = undefined; };
}

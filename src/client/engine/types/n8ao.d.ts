// n8ao ships no types: the slice of N8AOPostPass that Game.ts and aoTransparency.ts use (constructor, the `configuration`
// proxy, `renderTransparency` and its two targets, the compositer's own output target and copy).
declare module 'n8ao' {
  import type * as THREE from 'three';
  import type * as PP from 'postprocessing';
  import type { Renderer } from '@wildshard/engine/render/renderer';

  /** the `configuration` proxy: every write re-tunes the pass (see n8ao's N8AOPostPass source) */
  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: 0 | 1 | 2 | 3 | 4;
    biasOffset: number;
    biasMultiplier: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    depthBufferType: 1 | 2 | 3;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    neuralDenoise: boolean;
  }

  export class N8AOPostPass extends PP.Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** the transparency-aware pre-passes (two extra renders of the scene); aoTransparency.ts wraps it (PH-P2, SF69) */
    renderTransparency(renderer: Renderer): void;
    /** the pre-passes' targets (depth-free transparents; depth-writing ones, with a depth texture); unset until transparency-aware */
    transparencyRenderTargetDWFalse?: THREE.WebGLRenderTarget | null | undefined;
    transparencyRenderTargetDWTrue?: THREE.WebGLRenderTarget | null | undefined;
    /** the full-screen pass that copies the scene depth into a pre-pass target (made with the targets) */
    depthCopyPass?: { material: THREE.ShaderMaterial; render: (renderer: Renderer) => void } | null | undefined;
    /** walk the scene every frame for a transparent material, switching `transparencyAware` on at the first */
    autoDetectTransparency: boolean;
    /** the scene depth it reads (the composer hands it over) */
    depthTexture?: THREE.Texture | null | undefined;
    /** the compositer's full-resolution target, copied into the output buffer by `copyQuad` (aoTransparency.ts cut 5) */
    outputTargetInternal?: THREE.WebGLRenderTarget;
    /** the full-screen texel copy of `outputTargetInternal` into the output buffer (or the screen) */
    copyQuad?: { render: (renderer: Renderer) => void };
  }
}

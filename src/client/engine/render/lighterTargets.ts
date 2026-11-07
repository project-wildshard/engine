/**
 * G713 / G749 (Jake picked B, the lighter render-target chain, for every shard): the engine composer's targets. Each cut
 * keeps the passes, their order and their programs' work; only the targets they draw into shrink:
 *
 * - the composer's output buffer holds 8-bit sRGB when every pass that writes it runs after the tone map (the scene pass
 *   draws into the input buffer; with no AO or shard pass between the scene and the colour pass, the output only ever
 *   holds the graded frame and the anti-aliasing reads it back): 4 → 8 bytes a pixel less, as postprocessing's own
 *   `frameBufferType: UnsignedByteType` stores it;
 * - bloom's luminance pass at a quarter of the frame (the engine's default is half) and its mip chain one level smaller;
 * - the god rays' light mask (the sun disc against the scene's depth) at half the frame: the rays themselves are drawn at
 *   the tier's `godRaysScale` and blurred, from that mask.
 *
 * and anti-aliasing is one FXAA pass (Game.buildComposer), never SMAA's edge and weight targets.
 */
import * as THREE from 'three';
import type { BloomEffect, EffectComposer, GodRaysEffect } from 'postprocessing';

/** the composer's output buffer as an 8-bit sRGB target with no depth (dropOutputDepth's shape), sized like the input */
export function ldrOutputBuffer(composer: EffectComposer): void {
  const old = composer.outputBuffer;
  if (old.texture.type === THREE.UnsignedByteType) return;
  // postprocessing's own createBuffer, typed for UnsignedByteType (it is not public API)
  const next = new THREE.WebGLRenderTarget(composer.inputBuffer.width, composer.inputBuffer.height, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType });
  if (composer.getRenderer().outputColorSpace === THREE.SRGBColorSpace) next.texture.colorSpace = THREE.SRGBColorSpace;
  next.texture.name = 'EffectComposer.Buffer';
  next.texture.generateMipmaps = false;
  old.dispose();
  composer.outputBuffer = next;
}

/** bloom's luminance at a quarter of the frame and its mipmap blur's chain starting there (its first level at an eighth) */
export function quarterBloom(bloom: BloomEffect): void {
  bloom.luminancePass.resolution.scale = 0.25;
  const blur = bloom.mipmapBlurPass, setSize = blur.setSize.bind(blur);
  blur.setSize = (width: number, height: number): void => { setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))); };
}

/** the god rays' light mask at half the frame (postprocessing sizes it to the full frame on every resize) */
export function halfGodRaysMask(rays: GodRaysEffect): void {
  const setSize = rays.setSize.bind(rays);
  rays.setSize = (width: number, height: number): void => {
    setSize(width, height);
    const light: unknown = Reflect.get(rays, 'renderTargetLight');
    if (light instanceof THREE.WebGLRenderTarget) light.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  };
}

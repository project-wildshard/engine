import { DataTexture, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderTarget } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import type { CompileJob } from './precompile';
import { engineString } from '../../../shared/engine/strings';

const held = new WeakMap<Pick<Scope, 'onDispose'>, CompileJob>();

/** Keep the ordinary sRGB texture-readback shader linked for later streamed content. Only one white texel is owned;
 * sampled content textures are never retained. Match core/ktx2.readTexturePixelsAsync's geometry, target and material flags. */
export function readbackPreparation(owner: Pick<Scope, 'onDispose'>): CompileJob {
  const existing = held.get(owner);
  if (existing !== undefined) return existing;
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
  const material = new MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false });
  const geometry = new PlaneGeometry(2, 2), root = new Mesh(geometry, material);
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false }); target.texture.colorSpace = SRGBColorSpace;
  const job: CompileJob = { label: engineString('s_178612197e2b'), kind: 'readback', root, target: new Scene(), rt: target,
    camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  held.set(owner, job);
  owner.onDispose(() => { held.delete(owner); geometry.dispose(); material.dispose(); texture.dispose(); target.dispose(); });
  return job;
}

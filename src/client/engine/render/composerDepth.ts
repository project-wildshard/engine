import type { EffectComposer } from 'postprocessing';
import { Texture } from 'three';
import { Scope } from '../../../shared/engine/app/scope';

/** Release the stable depth sampler even when its target was never bound.
 * postprocessing delegates disposal to its render target, but Three registers
 * that target's native cleanup only when the target is initialized. Depth-slice
 * effects can upload/sample its texture without initializing the target. Keep
 * the original teardown and dispose only a detached sampler it did not release.
 */
export function ownComposerDepth(composer: EffectComposer): void {
  const remove: unknown = Reflect.get(composer, 'deleteDepthTexture');
  if (typeof remove !== 'function') throw new Error('Composer depth disposal contract changed');
  Reflect.set(composer, 'deleteDepthTexture', () => {
    const depth: unknown = Reflect.get(composer, 'stableDepthTexture');
    if (!(depth instanceof Texture)) { Reflect.apply(remove, composer, []); return; }
    let disposed = false;
    const released = (): void => { disposed = true; };
    const teardown = new Scope('composer.depth.retire');
    teardown.listenOnceEmitter(depth, 'dispose', released);
    try { Reflect.apply(remove, composer, []); } finally {
      teardown.dispose();
      if (!disposed && Reflect.get(composer, 'stableDepthTexture') !== depth) depth.dispose();
    }
  });
}

import type { Mesh, InstancedMesh, Object3D } from 'three';
import { installScopeEnvironment } from '../../../../shared/engine/app/scopeEnvironment';
import { SharedFrameScheduler } from './frameScheduler';
import { emitFault } from '../../../../shared/engine/core/faults';

let frames: SharedFrameScheduler | undefined;
let framesActive = true;
function sharedFrames(): SharedFrameScheduler {
  if(frames===undefined){
    frames=new SharedFrameScheduler({frame:render=>requestAnimationFrame(render),cancel:id=>cancelAnimationFrame(id),
      failed:error=>{emitFault({system:'frame.callback',error,verdict:'uncaught'});}});
    frames.setActive(framesActive);
  }
  return frames;
}
/** The page host parks pending frame requests without losing their owners. */
export function setBrowserFramesActive(active: boolean): void { framesActive=active;frames?.setActive(active); }

/** Install browser scheduling before entry; the rendered host supplies its native mesh classes after download. */
export function installBrowserScopeEnvironment(classes?: { Mesh: typeof Mesh; InstancedMesh: typeof InstancedMesh }): void {
  const isPrimitive = (node: Object3D): node is Mesh => classes !== undefined && node instanceof classes.Mesh;
  installScopeEnvironment({
    ...(classes === undefined ? {} : { primitives: (root: Object3D, own: (resource: { dispose: () => void }) => void, instances: boolean) => {
      root.traverse(node => {
        if (!isPrimitive(node)) return;
        own(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) own(material);
        if (instances && node instanceof classes.InstancedMesh) own(node);
      });
    } }),
    targetKind: (target) => typeof window !== 'undefined' && target === window ? 'window'
      : typeof document !== 'undefined' && target === document ? 'document'
        : typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement ? 'canvas' : 'other',
    frame: render => sharedFrames().frame(render), cancelFrame: id => {frames?.cancel(id);},
    sharedFrames: true, framePending: () => frames?.pending ?? false,
    // a renderer-free fixture installs this page environment in Node, where no native frame exists
    framesAvailable: () => typeof requestAnimationFrame === 'function',
  });
}

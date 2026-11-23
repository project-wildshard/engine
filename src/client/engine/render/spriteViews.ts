import * as THREE from 'three';
import { app } from '../app/runtime';
import { FOLD_EXEMPT } from './programFold';

/** ONE-FORMAT CC55: a creature's views for its far cards (entities/herdSprites.ts), shot once into one atlas row. */
export interface SpriteViews {
  readonly texture: THREE.Texture;
  readonly views: number;
  /** the card's size in metres at scale 1 (the views' shared frame), its foot at y = 0 */
  readonly width: number;
  readonly height: number;
  /** the frame's centre's x offset from the creature's root, in metres (a body off its root) */
  readonly offsetY: number;
}

export interface SpriteShot {
  readonly views: number;
  readonly size: number;
  /** A hidden shader-warm shot only. Its atlas is never used by a visible card. */
  readonly warmFrame?: { readonly y: number; readonly half: number };
}

/** Shoot `object`'s views (as it stands, root at the origin) into one atlas row of `size`² cells. Restores the renderer. */
export function bakeSpriteViews(renderer: THREE.WebGLRenderer, object: THREE.Object3D, opts: SpriteShot): SpriteViews {
  const { views, size, warmFrame } = opts;
  const holder = object.parent, at = object.position.clone(), turn = object.quaternion.clone();
  const scene = new THREE.Scene();
  scene.userData[FOLD_EXEMPT] = true; // one program for the shot at boot and in play (`debug.programFold`, programFold.ts)
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3b2a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(30, 60, 20); scene.add(sun);
  const before = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), colour: renderer.getClearColor(new THREE.Color()), autoClear: renderer.autoClear, scissor: renderer.getScissorTest() };
  scene.add(object); object.position.set(0, 0, 0); object.quaternion.identity(); object.updateMatrixWorld(true);
  const centre = new THREE.Vector3(0, warmFrame?.y ?? 0, 0);
  let half = warmFrame?.half ?? 1;
  if (warmFrame === undefined) {
    const box = new THREE.Box3().setFromObject(object, true);
    box.getCenter(centre);
    half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y) / 2 * 1.05;
  }
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, half * 8), restored: THREE.Object3D[] = [];
  const target = new THREE.WebGLRenderTarget(size * views, size, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  // The warm pass still submits the rig and its materials. Its own frustum
  // test would otherwise compute a fresh skinned sphere vertex by vertex.
  if (warmFrame !== undefined) object.traverse(node => {
    if (node.frustumCulled) { restored.push(node); node.frustumCulled = false; }
  });
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    for (let v = 0; v < views; v++) {
      const a = (v / views) * Math.PI * 2;
      camera.position.set(centre.x + Math.sin(a) * half * 4, centre.y, centre.z + Math.cos(a) * half * 4);
      camera.lookAt(centre);
      target.viewport.set(v * size, 0, size, size); target.scissor.set(v * size, 0, size, size);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    renderer.setScissorTest(before.scissor); renderer.autoClear = before.autoClear;
    renderer.setClearColor(before.colour, before.alpha); renderer.setRenderTarget(before.target);
    for (const node of restored) node.frustumCulled = true;
    scene.remove(object); holder?.add(object); object.position.copy(at); object.quaternion.copy(turn); object.updateMatrixWorld(true);
  }
  return { texture: target.texture, views, width: half * 2, height: half * 2, offsetY: centre.y - half };
}

/** `object`'s views shot with the page's renderer; null before it has one (a headless sim, a test). */
export function shootViews(object: THREE.Object3D, opts: SpriteShot): SpriteViews | null {
  const renderer = app.render?.renderer;
  return renderer === undefined ? null : bakeSpriteViews(renderer, object, opts);
}

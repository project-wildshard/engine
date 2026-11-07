import type { Object3D } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';

/**
 * Static scene pieces off the per-frame matrix walk (G639 / G669).
 *
 * three recomposes every node's local matrix each frame (`matrixAutoUpdate`) and, because that marks it changed, multiplies
 * every child's world matrix again too: Nalati's look window spent ~2.6 ms a frame on that walk at phone 4x, for pieces that
 * never move. `holdStaticMatrices` brings a subtree up to date once and turns its nodes' auto update off, so the walk only
 * visits them. A node that does move after all (code that sets its pose without being a registered mover) is caught by a
 * check every step for its first `EAGER_STEPS`, then every `CHECK_FRAMES`: its matrix is brought up to date, its auto update comes back for good, and it is
 * reported once.
 *
 * A held subtree also leaves the walk itself: three still visited and multiplied every node of it each frame (the parent's
 * own update forces its children), the region's share of the largest render frame left of a steady Nalati Simulator
 * profile (Three.updateMatrixWorld 192 of 4940 samples). Its root skips the walk while the matrices it would compute are
 * the ones it holds: walked again (whole, as three would) once the parent's world matrix differs from the one it was
 * walked under, or anything marks the root's world stale; and for good once a held node moves (the check above) or
 * anything is attached to or detached from any node of it (three's childadded / childremoved: a new node is not held).
 */
const CHECK_FRAMES = 30;
/** steps after the hold checked every time: a node that animates from the start (a mill's hub) lags one step, not 30 */
const EAGER_STEPS = 120;
interface Held { readonly node: Object3D; readonly pose: Float64Array }
const pose = (node: Object3D, out: Float64Array): Float64Array => {
  const p = node.position, q = node.quaternion, s = node.scale;
  out[0] = p.x; out[1] = p.y; out[2] = p.z; out[3] = q.x; out[4] = q.y; out[5] = q.z; out[6] = q.w; out[7] = s.x; out[8] = s.y; out[9] = s.z;
  return out;
};
/** Read the complete pose before comparing, as the original scratch-array capture did. */
const moved = (held: Held): boolean => {
  const p = held.node.position, q = held.node.quaternion, s = held.node.scale;
  const px = p.x, py = p.y, pz = p.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w, sx = s.x, sy = s.y, sz = s.z;
  const prior = held.pose;
  return px !== prior[0] || py !== prior[1] || pz !== prior[2] || qx !== prior[3] || qy !== prior[4]
    || qz !== prior[5] || qw !== prior[6] || sx !== prior[7] || sy !== prior[8] || sz !== prior[9];
};
const reported = new WeakSet<Object3D>();
const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function same(a: ArrayLike<number>, b: Float64Array): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
function report(node: Object3D): void {
  if (reported.has(node)) return;
  reported.add(node);
  const path: string[] = []; for (let n: Object3D | null = node; n !== null && path.length < 6; n = n.parent) path.unshift(n.name || n.type);
  console.warn(`[staticMatrices] moved, back on auto update: ${path.join('/')}`);
}

/** Hold `root`'s subtree (every node still on auto update; `subtree: false` holds `root` alone) off the per-frame matrix
 *  walk while `scope` lives; `frame` registers the owner's per-frame check. */
export function holdStaticMatrices(root: Object3D, scope: Scope, frame: (check: () => void) => void, options: { subtree?: boolean } = {}): void {
  if (scope.disposed) return;
  root.updateMatrixWorld(true);
  const held: Held[] = [];
  const hold = (node: Object3D): void => { if (node.matrixAutoUpdate) held.push({ node, pose: pose(node, new Float64Array(10)) }); };
  if (options.subtree === false) hold(root); else root.traverse(hold);
  for (const row of held) row.node.matrixAutoUpdate = false;
  scope.onDispose(() => { for (const row of held) row.node.matrixAutoUpdate = true; held.length = 0; });
  // the walk skip (module comment): a whole held subtree only
  let skippable = options.subtree !== false;
  if (skippable) {
    const walk = root.updateMatrixWorld.bind(root), seen = new Float64Array(16);
    let walked = false;
    const stop = (): void => { skippable = false; };
    root.traverse((node) => { scope.listenEmitter(node, 'childadded', stop); scope.listenEmitter(node, 'childremoved', stop); });
    const skip = (force?: boolean): void => {
      const parent = root.parent === null ? IDENTITY : root.parent.matrixWorld.elements;
      if (skippable && walked && !root.matrixWorldNeedsUpdate && same(parent, seen)) return;
      walk(force); seen.set(parent); walked = true;
    };
    root.updateMatrixWorld = skip;
    scope.onDispose(() => { if (root.updateMatrixWorld === skip) Reflect.deleteProperty(root, 'updateMatrixWorld'); });
  }
  let frames = 0, steps = 0;
  frame(() => {
    if (++steps > EAGER_STEPS && ++frames < CHECK_FRAMES) return;
    frames = 0;
    for (let i = held.length - 1; i >= 0; i--) {
      const row = held[i]; if (row === undefined || !moved(row)) continue;
      report(row.node);
      const node = row.node;
      node.matrixAutoUpdate = true; node.updateMatrix(); node.matrixWorldNeedsUpdate = true;
      held.splice(i, 1); skippable = false;
    }
  });
}

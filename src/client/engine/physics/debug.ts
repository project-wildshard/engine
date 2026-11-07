/**
 * `?physics=debug`: draws every collider as lines (Rapier's `debugRender`), the authoring view for the colliders the
 * phases add (PHYSICS.md §Architecture). Dev only: nothing is built without the param.
 *
 * The world is static until P7, so the lines are rebuilt only when the collider count changes, checked twice a
 * second, not every frame. They sit 2 cm up, so they draw over the terrain they trace.
 */
import * as THREE from 'three';
import type { Physics } from '../../../shared/engine/physics/Physics';
import { tagOf } from '../../../shared/engine/physics/surface';
import { app } from '../app/runtime';

const LIFT = 0.02;

export function installPhysicsDebug(physics: Physics, scene: THREE.Scene, params: URLSearchParams): void {
  if (params.get('navmesh') === 'debug') installNavmeshDebug(scene);
  if (params.get('physics') !== 'debug') return;
  // for probes: which collider (and whose, what material) a query hit — `window.__physics.tagOf(collider)`
  (app.levelScope ?? app.engineScope).expose(window, '__physics', { physics, tagOf });
  const geo = new THREE.BufferGeometry();
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, fog: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 10;
  lines.name = 'physics-debug';
  scene.add(lines);
  let count = -1;
  const rebuild = () => {
    const n = physics.world.colliders.len();
    if (n === count) return;
    count = n;
    const { vertices, colors } = physics.world.debugRender();
    const pos = new Float32Array(vertices);
    for (let i = 1; i < pos.length; i += 3) pos[i] = (pos[i] ?? 0) + LIFT;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 4));
    geo.computeBoundingSphere();
  };
  rebuild();
  (app.levelScope ?? app.engineScope).interval(500, rebuild);
}

/**
 * `?navmesh=debug`: the shard's baked navmesh (src/shared/engine/physics/navmesh.ts, its smallest layer) drawn over the world — navcat's
 * own helper (the polys filled, their edges), lifted 5 cm and drawn over everything, for the bake's authoring views
 * (NALATI-MERGE P3). Dev only: navcat's three helpers load only with the param.
 */
function installNavmeshDebug(scene: THREE.Scene): void {
  const layer = app.navmesh?.layers[0];
  if (layer === undefined) { console.warn('[navmesh] ?navmesh=debug: this level has no navmesh'); return; }
  void (async () => {
    const { createNavMeshHelper } = await import('navcat/three');
    const { object } = createNavMeshHelper(layer.mesh);
    object.name = 'navmesh-debug';
    object.position.y = 0.05;
    object.renderOrder = 11;
    object.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Line)) return;
      const m: unknown = o.material;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (!(mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.LineBasicMaterial)) continue;
        // one readable colour over the painted world: the polys cyan, their edges dark teal
        mat.vertexColors = false; mat.color.set(o instanceof THREE.Mesh ? 0x22e0ff : 0x006070);
        mat.depthTest = false; mat.transparent = true; mat.opacity = o instanceof THREE.Mesh ? 0.32 : 0.9; mat.fog = false; mat.needsUpdate = true;
      }
    });
    scene.add(object);
  })();
}

/**
 * The soft wall's look (SHARD-PLATFORM SF17b look, G85 "B: shimmer barrier"): while a neighbour isn't ready its edge holds
 * as a closed wall (SF18d `ReadinessWalls`); this draws that wall as a translucent cyan hex shimmer near the traveller. The
 * same language as G89's void rail. Why it can't be entered, and every loading step, is G555's step-by-step loading
 * screen (`cellLoading.ts`), opened as the traveller reaches the wall.
 *
 * One draw for every wall (a curtain quad per edge, additive, faded out past ~70 m so a 500 m wall never dominates the
 * view). Which walls are closed comes from the session each fixed step; a wall opens the moment its neighbour is ready.
 *
 * GC12 (Jake, 2026-11-13 ~22:50 Cancún, board A): the wall shows only when a player meets a closed edge. A closed wall is drawn
 * while the traveller's feet stand within `MEET_METRES` of it, so a warm crossing (or a wall seen from across the cell) never
 * shows it; the readiness wall itself still holds at every closed edge.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, Mesh, type Object3D, ShaderMaterial } from 'three';
import type { LookScope } from '../../../shared/game/grid/roadLayout';

/** A wall in the home frame: the edge's centre, the axis its thin side faces, its half length; whose wall it is. */
export interface SoftWallEdge { readonly instance: string; readonly x: number; readonly z: number; readonly axis: 'x' | 'z'; readonly halfLength: number; readonly height?: number }
/** What the look reads each fixed step. */
export interface SoftWallPorts {
  readonly closed: (instance: string) => boolean;
  /** the traveller's feet in the home frame; absent: every closed wall shows, as before GC12 */
  readonly feet?: () => { readonly x: number; readonly z: number };
}
/** GC12: how near a closed edge the feet must stand for its wall to show (a player at the wall, a stride or two short of it). */
export const MEET_METRES = 6;
/** Distance from the feet to an edge's wall segment, in the home frame. */
export function edgeDistance(edge: SoftWallEdge, feet: { readonly x: number; readonly z: number }): number {
  const dx = feet.x - edge.x, dz = feet.z - edge.z;
  const across = edge.axis === 'x' ? dx : dz, along = edge.axis === 'x' ? dz : dx;
  return Math.hypot(across, Math.max(0, Math.abs(along) - edge.halfLength));
}
/** The readout: how many neighbour edges are closed, and how many of those show (GC12: the ones the traveller meets). */
export interface SoftWallState { readonly closed: number; readonly shown: number }

const HEIGHT = 7, CYAN = new Color(0x38e6ff);

const vertex = /* glsl */ `
attribute float aClosed;
attribute float aHeight;
varying float vClosed;
varying float vHeight;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vClosed = aClosed; vHeight = aHeight; vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragment = /* glsl */ `
uniform vec3 uColour;
uniform float uTime;
varying float vClosed;
varying float vHeight;
varying vec2 vUv;
varying vec3 vWorld;
// distance to the nearest hex cell edge (cells ~0.9 m)
float hexEdge(vec2 p) {
  p /= 0.9;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
}
void main() {
  if (vClosed < 0.5) discard;
  float d = length(vWorld.xz - cameraPosition.xz);
  float near = 1.0 - smoothstep(25.0, 70.0, d);
  if (near <= 0.0) discard;
  float e = hexEdge(vUv);
  float line = 1.0 - smoothstep(0.0, 0.06, e);
  float wave = 0.5 + 0.5 * sin(vUv.y * 1.3 - uTime * 2.2 + vUv.x * 0.15);
  float ground = 1.0 - smoothstep(0.0, 0.6, vUv.y); // a bright foot where the wall meets the ground
  float top = 1.0 - smoothstep(vHeight * ${(Number((HEIGHT * 0.55).toFixed(1)) / HEIGHT).toPrecision(16)}, vHeight, vUv.y);
  float a = (0.07 + line * (0.35 + 0.25 * wave) + ground * 0.35) * top * near;
  gl_FragColor = vec4(uColour * a, 1.0);
}`;

function curtain(edges: readonly SoftWallEdge[]): BufferGeometry {
  const position = new Float32Array(edges.length * 12), uv = new Float32Array(edges.length * 8), closed = new Float32Array(edges.length * 4), heights = new Float32Array(edges.length * 4), index: number[] = [];
  edges.forEach((edge, k) => {
    const along = edge.axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 }, h = edge.halfLength;
    const height = edge.height ?? HEIGHT;
    const corners = [[-h, 0], [h, 0], [h, height], [-h, height]] as const;
    corners.forEach(([s, y], c) => {
      position.set([edge.x + along.x * s, y, edge.z + along.z * s], (k * 4 + c) * 3);
      uv.set([s + h, y], (k * 4 + c) * 2);
      heights[k * 4 + c] = height;
    });
    const b = k * 4; index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3)).setAttribute('uv', new BufferAttribute(uv, 2))
    .setAttribute('aClosed', new BufferAttribute(closed, 1).setUsage(DynamicDrawUsage)).setAttribute('aHeight', new BufferAttribute(heights, 1)).setIndex(index);
  // aClosed is rewritten whenever a wall opens or closes: dynamic, so the memory saver never releases it (a write after
  // its release read the buffer back from the GPU, a 136 ms stall on Pine's crossing at phone CPU speed)
  g.computeBoundingSphere();
  return g;
}

/** Draw the soft walls; `step` runs each fixed step (which walls are closed), `time` feeds the shimmer. */
export function installSoftWallLook(input: { readonly edges: readonly SoftWallEdge[]; readonly ports: SoftWallPorts; readonly scene: Object3D; readonly scope: LookScope; readonly time: () => number }): { step: () => void; state: () => SoftWallState } {
  const { edges, ports, scene, scope } = input, group = new Group();
  group.name = 'grid-soft-walls';
  const uTime = { value: 0 };
  const material = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
    uniforms: { uColour: { value: CYAN }, uTime } });
  const wall = new Mesh(curtain(edges), material);
  wall.name = 'grid-soft-wall'; wall.frustumCulled = false; wall.renderOrder = 2;
  const closedAttr = wall.geometry.getAttribute('aClosed');
  group.add(wall); scene.add(group);
  const flags = edges.map(() => -1);
  let closedCount = 0, shownCount = 0;
  const step = (): void => {
    uTime.value = input.time();
    closedCount = 0; shownCount = 0;
    const feet = ports.feet?.();
    for (let k = 0; k < edges.length; k++) {
      const edge = edges[k];
      if (edge === undefined) continue;
      const closed = ports.closed(edge.instance);
      if (closed) closedCount++;
      const shown = closed && (feet === undefined || edgeDistance(edge, feet) <= MEET_METRES) ? 1 : 0;
      shownCount += shown;
      if (flags[k] !== shown) { flags[k] = shown; for (let c = 0; c < 4; c++) closedAttr.setX(k * 4 + c, shown); closedAttr.needsUpdate = true; }
    }
  };
  scope.onDispose(() => { group.removeFromParent(); wall.geometry.dispose(); material.dispose(); });
  return { step, state: () => ({ closed: closedCount, shown: shownCount }) };
}

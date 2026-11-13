/**
 * The VR void past the outer road (SHARD-PLATFORM SF17b look, G77 / G89 "A: Tron grid + rail"): a black unlit floor with
 * cyan grid lines to the horizon, starting on the outer road's shoulder, and the thin glowing cyan rail itself on short
 * posts. SA34: the floor is walkable out to the rail on the 7 × 7's outer shoulder (`voidFloor.ts`), and an empty cell inside
 * the placed rectangle is a square of the same floor. The rail is where the grid's closed rim walls stand (`session.ts`
 * `rimEdges`), so the wall you bump is the rail you see.
 *
 * Cheap by construction: the floor is one square annulus (8 triangles) plus two per empty-cell square, with a grid shader (no textures, no lights, no fog);
 * the rail and posts are part of the road system's one solid material (`roadSolid.ts`). Lines are anti-aliased with screen derivatives and fade
 * as they shrink under a pixel, so the horizon stays clean instead of shimmering.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, type Object3D, ShaderMaterial } from 'three';
import { uniformPart, type SolidPart } from './roadSolid';
import type { GridCell } from '../../../shared/game/grid/assembly';
import type { CellSquare, LookScope, RailBox } from '../../../shared/game/grid/roadLayout';
import type { PlatformRenderAdmission, PlatformRenderBytePlan } from './renderResidency';

/** The void floor's reach past its edge (to the grid camera's 6 km far plane, `FAR_RING.drawDistance`). */
const REACH = 6000;
/** The floor sits a hair above road level so it covers the outer strip beyond the rail. */
const FLOOR_Y = 0.04;
const RAIL_Y = 0.95, POST_STEP = 6, RAIL_PIECE = 50;
const CYAN = new Color(0x38e6ff);

const vertex = /* glsl */ `
uniform vec2 uOrigin;
varying vec2 vGrid;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vGrid = world.xz + uOrigin;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragment = /* glsl */ `
uniform vec3 uLine;
uniform float uOwned; // G321: how much a cell's own sky owns the horizon (0: the floor is whole)
uniform vec3 uBase;
uniform vec4 uRail; // minX, maxX, minZ, maxZ in the home frame
varying vec2 vGrid;
varying vec3 vWorld;
float lines(vec2 p, float cell, float width) {
  vec2 g = p / cell;
  vec2 w = fwidth(g);
  vec2 d = abs(fract(g - 0.5) - 0.5) / max(w, vec2(1e-5));
  float line = 1.0 - min(min(d.x, d.y) / width, 1.0);
  // fade a family of lines out as a cell shrinks toward a pixel (no moire at the horizon)
  return line * (1.0 - smoothstep(0.12, 0.45, max(w.x, w.y)));
}
void main() {
  // G321: across a cell's edge band the floor thins out in a screen-door dither (no blending, no second program), so its
  // shard's backdrop shows through where the floor leaves no depth; inside the cell the mesh is not drawn at all
  if (uOwned > 0.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < uOwned) discard;
  float minor = lines(vGrid, 20.0, 1.0);
  float major = lines(vGrid, 100.0, 1.6);
  float d = length(vWorld.xz - cameraPosition.xz);
  float edge = min(min(vWorld.x - uRail.x, uRail.y - vWorld.x), min(vWorld.z - uRail.z, uRail.w - vWorld.z));
  edge = max(edge, -min(min(uRail.x - vWorld.x, vWorld.x - uRail.y), min(uRail.z - vWorld.z, vWorld.z - uRail.w)));
  float glow = exp(-abs(edge) / 6.0) * 0.35; // the floor brightens at the rail
  float fade = exp(-d / 1400.0);
  float lit = max(minor * 0.55, major) * (0.35 + 0.65 * fade) + glow * fade;
  vec3 colour = uBase + uLine * lit;
  gl_FragColor = vec4(colour, 1.0);
}`;

/**
 * The void's floor material: black, unlit, cyan grid lines on the world grid, brightening toward the rectangle `rail`
 * (minX, maxX, minZ, maxZ in the home frame).
 */
function voidFloorMaterial(home: GridCell, rail: readonly [number, number, number, number], owned: { value: number }): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, fog: false, lights: false,
    uniforms: { uOrigin: { value: [home.origin.x, home.origin.z] }, uLine: { value: CYAN.clone().multiplyScalar(0.9) }, uBase: { value: new Color(0x02050a) }, uRail: { value: [...rail] }, uOwned: owned },
  });
  material.name = 'grid-void-floor';
  return material;
}

/** The void floor: a square annulus from the floor's edge box out to REACH, and one square per empty cell (SA34), in the home frame. */
function floorGeometry(box: RailBox, holes: readonly CellSquare[], home: GridCell): BufferGeometry {
  const x0 = box.minX - home.origin.x, x1 = box.maxX - home.origin.x, z0 = box.minZ - home.origin.z, z1 = box.maxZ - home.origin.z;
  const X0 = x0 - REACH, X1 = x1 + REACH, Z0 = z0 - REACH, Z1 = z1 + REACH;
  // inner ring 0..3 (sw, se, ne, nw), outer ring 4..7, then four corners per hole
  const p = [x0, z0, x1, z0, x1, z1, x0, z1, X0, Z0, X1, Z0, X1, Z1, X0, Z1];
  for (const hole of holes) {
    const hx0 = hole.x - hole.hx - home.origin.x, hx1 = hole.x + hole.hx - home.origin.x, hz0 = hole.z - hole.hz - home.origin.z, hz1 = hole.z + hole.hz - home.origin.z;
    p.push(hx0, hz0, hx1, hz0, hx1, hz1, hx0, hz1);
  }
  const count = p.length / 2, position = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) { position[k * 3] = p[k * 2] ?? 0; position[k * 3 + 1] = FLOOR_Y; position[k * 3 + 2] = p[k * 2 + 1] ?? 0; }
  // each side a quad between inner edge (a, b) and outer edge (A, B), wound to face up
  const ring = [0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  for (let k = 0; k < ring.length; k += 3) { const b = ring[k + 1] ?? 0; ring[k + 1] = ring[k + 2] ?? 0; ring[k + 2] = b; }
  // a hole's square (sw, se, ne, nw), wound to face up
  for (let h = 0; h < holes.length; h++) { const o = 8 + h * 4; ring.push(o, o + 2, o + 1, o, o + 3, o + 2); }
  const index = new Uint16Array(ring);
  const g = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3)).setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

/** G144's preflight for the void: the floor's retained position and index buffers (CPU + GPU; no texture): the annulus's 8
 *  corners and 24 indices, and 4 corners and 6 indices per empty-cell square. The rail and its posts belong to the deck's plan. */
export function voidFloorPlan(holes = 0): PlatformRenderBytePlan {
  const bytes = (8 + 4 * holes) * 3 * Float32Array.BYTES_PER_ELEMENT + (24 + 6 * holes) * Uint16Array.BYTES_PER_ELEMENT;
  return { id: 'road.void', jsBytes: bytes, gpuBytes: bytes };
}

/** The readout, and the floor's fade. */
export interface VoidLookState {
  readonly rail: RailBox; readonly posts: number;
  /**
   * G321: how much a cell's own sky owns the horizon (the grid frame's `horizon`, 0..1): the floor dithers out across the
   * edge band and is not drawn at 1, so inside the cell its shard's backdrop, not the road's floor, meets the sky
   */
  readonly fade: (owned: number) => void;
}

/** A box builder for the rail and posts (sides and top, outward normals, vertex colours). */
class SolidMesher {
  private readonly p: number[] = []; private readonly n: number[] = []; private readonly c: number[] = []; private readonly i: number[] = [];
  private quad(corners: readonly (readonly [number, number, number])[], normal: readonly [number, number, number], colour: Color): void {
    const base = this.p.length / 3;
    for (const [x, y, z] of corners) { this.p.push(x, y, z); this.n.push(...normal); this.c.push(colour.r, colour.g, colour.b); }
    // wind so the face looks along its normal
    const [a, b, c] = corners, e = (k: number, o: number): number => (corners[k]?.[o] ?? 0) - (a?.[o] ?? 0);
    const cx = e(1, 1) * e(2, 2) - e(1, 2) * e(2, 1), cy = e(1, 2) * e(2, 0) - e(1, 0) * e(2, 2), cz = e(1, 0) * e(2, 1) - e(1, 1) * e(2, 0);
    if (b === undefined || c === undefined || cx * normal[0] + cy * normal[1] + cz * normal[2] >= 0) this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  beam(a: { x: number; z: number }, b: { x: number; z: number }, y0: number, width: number, height: number, colour: Color): void {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < 1e-4) return;
    const ux = dx / len, uz = dz / len, ox = -uz * width / 2, oz = ux * width / 2, y1 = y0 + height;
    const A = [a.x - ox, a.z - oz] as const, B = [b.x - ox, b.z - oz] as const, C = [b.x + ox, b.z + oz] as const, D = [a.x + ox, a.z + oz] as const;
    this.quad([[A[0], y1, A[1]], [B[0], y1, B[1]], [C[0], y1, C[1]], [D[0], y1, D[1]]], [0, 1, 0], colour);
    const side = (p: readonly [number, number], q: readonly [number, number], nx: number, nz: number): void => { this.quad([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]], [nx, 0, nz], colour); };
    side(D, C, -uz, ux); side(B, A, uz, -ux); side(A, D, -ux, -uz); side(C, B, ux, uz);
  }
  part(): { positions: Float32Array; normals: Float32Array; colours: Float32Array; uvs: Float32Array; indices: Uint32Array } {
    return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), colours: new Float32Array(this.c), uvs: new Float32Array((this.p.length / 3) * 2), indices: new Uint32Array(this.i) };
  }
}

/**
 * Draw the void and its rail; everything is disposed with the scope. The floor is its own always-drawn mesh; the rail
 * (unlit cyan, in ≤ 50 m beams so the per-view cull can drop what is out of view) and its posts go to `solid`, the road
 * system's one solid material (SF17b per-view budget).
 */
export function installVoidLook(input: { readonly rail: RailBox; readonly edge: RailBox; readonly holes: readonly CellSquare[]; readonly home: GridCell; readonly scene: Object3D; readonly scope: LookScope; readonly solid: (part: SolidPart) => void; readonly admission?: PlatformRenderAdmission }): VoidLookState {
  const { rail: box, edge, holes, home, scene, scope } = input, group = new Group();
  group.name = 'grid-void';
  const x0 = box.minX - home.origin.x, x1 = box.maxX - home.origin.x, z0 = box.minZ - home.origin.z, z1 = box.maxZ - home.origin.z;
  const owned = { value: 0 };
  let drawn: Mesh | null = null;
  const build = (owner: LookScope): void => {
    const floorMaterial = voidFloorMaterial(home, [x0, x1, z0, z1], owned);
    const floor = new Mesh(floorGeometry(edge, holes, home), floorMaterial);
    floor.visible = owned.value < 1; drawn = floor;
    floor.name = 'grid-void-floor'; floor.frustumCulled = false;
    floor.castShadow = false; floor.receiveShadow = false; floor.matrixAutoUpdate = false; floor.updateMatrix(); group.add(floor);
    owner.onDispose(() => { if (drawn === floor) drawn = null; floor.removeFromParent(); floor.geometry.dispose(); floorMaterial.dispose(); });
  };
  if (input.admission === undefined) build(scope); else input.admission.allocate(voidFloorPlan(holes.length), build);
  // the rail: thin beams along the four sides (unlit, the HUD's cyan); short dark posts carry it
  const sides: readonly [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  const rail = new SolidMesher(), posts = new SolidMesher(), cyan = CYAN.clone().multiplyScalar(1.6), dark = new Color(0x2b3036);
  let count = 0;
  for (const [ax, az, bx, bz] of sides) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, pieces = Math.max(1, Math.ceil(len / RAIL_PIECE));
    for (let i = 0; i < pieces; i++) {
      const s0 = i === 0 ? -0.035 : len * i / pieces, s1 = i === pieces - 1 ? len + 0.035 : len * (i + 1) / pieces;
      rail.beam({ x: ax + ux * s0, z: az + uz * s0 }, { x: ax + ux * s1, z: az + uz * s1 }, RAIL_Y - 0.035, 0.07, 0.07, cyan);
    }
    const n = Math.max(1, Math.floor(len / POST_STEP));
    for (let i = 0; i < n; i++) {
      const t = i / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      posts.beam({ x: px - ux * 0.04, z: pz - uz * 0.04 }, { x: px + ux * 0.04, z: pz + uz * 0.04 }, 0, 0.08, RAIL_Y, dark); count++;
    }
  }
  input.solid(uniformPart(rail.part(), 'white', true)); input.solid(uniformPart(posts.part(), 'white'));
  scene.add(group);
  scope.onDispose(() => { group.removeFromParent(); });
  return { rail: box, posts: count, fade: (w) => {
    owned.value = Math.min(1, Math.max(0, w));
    if (drawn !== null) drawn.visible = owned.value < 1;
  } };
}

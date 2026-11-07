/**
 * The shard's navmesh (project/archive/2026-09-23-physics.md P6b): where a creature can walk, baked offline per shard by
 * scripts/bake-navmesh.mjs (navcat's recast port over the baked terrain + every static builder's ColliderDescs, the water
 * left out) into public/assets/baked/<slug>/navmesh.bin — a declared boot file (src/client/engine/boot/manifest.ts, `physics`), loaded
 * in the `physics` step. Queried with navcat (pure JS, detour's queries).
 *
 * Renderer-free (SF72): the format, the parse and the queries, which the browser and the headless runtimes (Node) share;
 * the app binding (the active level's navmesh and its fetch) is src/client/engine/physics/navmeshLoad.ts.
 *
 * The file holds one layer per agent class (Driftwood: 0.3 m for crabs / monkeys / sailors, 0.5 m for the rest; Pine Hollow: 0.5 m);
 * a query takes the creature's radius and runs on the smallest layer that covers it (the largest when none does).
 * Points are world space; a path's y is the navmesh's (loose — ~0.8 m on hills: the creature's own ground / motor
 * decides its height). The character motor still resolves every move: the navmesh only says where to head.
 */
import * as THREE from 'three';
import {
  addTile, buildTile, createFindNearestPolyResult, createNavMesh, createSlicedNodePathQuery, DEFAULT_QUERY_FILTER, finalizeSlicedFindNodePath,
  findNearestPoly, findRandomPointAroundCircle, findStraightPath, initSlicedFindNodePath, raycast, SlicedFindNodePathStatusFlags, updateSlicedFindNodePath,
  type NavMesh, type Vec3,
} from 'navcat';
import { decodeNavigation, type NavigationLayerData } from '@wildshard/format/navigationBytes';
import { terrainDatum } from '../world/terrainHeight';
import type { WorkSlice } from '../core/workSlice';


/** One agent class's mesh. */
export interface NavLayer { radius: number; height: number; climb: number; mesh: NavMesh }

interface XYZ { x: number; y: number; z: number }

/** Search box for snapping a point onto the mesh: ±2 m across, ±3 m up and down (a deck over the ground stays apart). */
const SNAP: Vec3 = [2, 3, 2];
/** A path search visits at most this many polys (~0.3 ms); past it the path runs to the poly nearest the goal so far. */
export const MAX_SEARCH_NODES = 1024;

function layerMesh(layer: NavigationLayerData): NavMesh {
  const mesh = createNavMesh();
  mesh.origin = layer.origin; mesh.tileWidth = mesh.tileHeight = layer.tileSize;
  return mesh;
}
function addLayerTile(mesh: NavMesh, layer: NavigationLayerData, tile: NavigationLayerData['tiles'][number]): void {
  addTile(mesh, buildTile({ ...tile, cellSize: layer.cellSize, cellHeight: layer.cellHeight,
    walkableHeight: layer.height, walkableRadius: layer.radius, walkableClimb: layer.climb }));
}
function readLayer(layer: NavigationLayerData): NavLayer {
  const mesh = layerMesh(layer);
  for (const tile of layer.tiles) addLayerTile(mesh, layer, tile);
  return { radius: layer.radius, height: layer.height, climb: layer.climb, mesh };
}

/** a world point into the navmesh's frame: the bake is the level's authored frame, so a level shifted at runtime (its
 *  terrain datum, G164) queries `y − datum` and every point out adds it back (datum 0: the point exactly) */
const toVec3 = (p: XYZ, out: Vec3, datum: number): Vec3 => { out[0] = p.x; out[1] = p.y - datum; out[2] = p.z; return out; };

export class Navmesh {
  /** by radius, smallest first */
  readonly layers: readonly NavLayer[];
  /** query cost, for the perf meter / bench: calls and total ms since load (or the last `resetStats`) */
  readonly stats = { queries: 0, ms: 0 };
  /** where each query's cost also goes: nowhere by default; the browser's loader points it at the perf meter
   *  (navmeshLoad.ts → frameCost.nav), so this module stays renderer-free */
  costSink: (ms: number) => void = () => undefined;
  /** the level's vertical datum its queries read (m): by default the active level's (terrainHeight.ts, bound by the
   *  Heightfield, which refuses with no level configured). A renderer-free host that configures no level and shifts nothing
   *  says so on its own instance (`() => 0`, SF72): never a silent fallback in the browser */
  datum: () => number = terrainDatum;
  private readonly nearest = createFindNearestPolyResult();
  private readonly nearest2 = createFindNearestPolyResult();
  private readonly query = createSlicedNodePathQuery();
  private readonly a: Vec3 = [0, 0, 0];
  private readonly b: Vec3 = [0, 0, 0];

  readonly bytes: number;
  constructor(layers: NavLayer[], bytes = 0) {
    this.bytes = bytes;
    if (layers.length === 0) throw new Error('Navmesh: no layers');
    this.layers = [...layers].sort((x, y) => x.radius - y.radius);
  }

  /** The smallest layer whose radius covers `agentRadius`; the largest when none does. */
  layerFor(agentRadius: number): NavLayer {
    const all = this.layers, last = all[all.length - 1];
    if (last === undefined) throw new Error('Navmesh: no layers');
    return all.find((l) => l.radius >= agentRadius - 1e-3) ?? last;
  }

  resetStats(): void { this.stats.queries = 0; this.stats.ms = 0; }

  /**
   * A walkable route from `from` to `to` for a creature of `agentRadius`: the string-pulled corners, `from`'s snapped
   * point first and the goal (or, when the goal can't be reached or the search ran past MAX_SEARCH_NODES, the reachable
   * point nearest it) last. Written into `out` (reused vectors); null when `from` is nowhere near the mesh.
   */
  findPath(from: XYZ, to: XYZ, agentRadius: number, out: THREE.Vector3[] = [], maxNodes: number = MAX_SEARCH_NODES): THREE.Vector3[] | null {
    const t0 = performance.now();
    try {
      const { mesh } = this.layerFor(agentRadius);
      const s = findNearestPoly(this.nearest, mesh, toVec3(from, this.a, this.datum()), SNAP, DEFAULT_QUERY_FILTER);
      if (!s.success) return null;
      const e = findNearestPoly(this.nearest2, mesh, toVec3(to, this.b, this.datum()), SNAP, DEFAULT_QUERY_FILTER);
      const endRef = e.success ? e.nodeRef : s.nodeRef, endPos = e.success ? e.position : s.position;
      initSlicedFindNodePath(mesh, this.query, s.nodeRef, endRef, s.position, endPos, DEFAULT_QUERY_FILTER);
      updateSlicedFindNodePath(mesh, this.query, maxNodes);
      const nodes = finalizeSlicedFindNodePath(mesh, this.query);
      if ((nodes.status & SlicedFindNodePathStatusFlags.SUCCESS) === 0 || nodes.path.length === 0) return null;
      // the goal off the mesh: head for where it would be (findStraightPath clamps it to the last poly)
      const straight = findStraightPath(mesh, s.position, e.success ? endPos : toVec3(to, this.b, this.datum()), nodes.path);
      if (!straight.success) return null;
      const datum = this.datum();
      straight.path.forEach((pt, i) => { out[i] = (out[i] ?? new THREE.Vector3()).set(pt.position[0], pt.position[1] + datum, pt.position[2]); });
      out.length = straight.path.length;
      return out;
    } finally { this.count(t0); }
  }

  /** The nearest walkable point to `p` (within ±2 m across, ±3 m vertically) for a creature of `agentRadius`, or null. */
  closestWalkable(p: XYZ, agentRadius = 0, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | null {
    const t0 = performance.now();
    try {
      const r = findNearestPoly(this.nearest, this.layerFor(agentRadius).mesh, toVec3(p, this.a, this.datum()), SNAP, DEFAULT_QUERY_FILTER);
      return r.success ? out.set(r.position[0], r.position[1] + this.datum(), r.position[2]) : null;
    } finally { this.count(t0); }
  }

  /**
   * A random walkable point about `radius` from `p` and reachable from it (the polys searched are connected to `p`'s),
   * for a creature of `agentRadius` — a wander target. Null when `p` is off the mesh.
   * navcat bounds the polys it searches, not the point: in open ground one big poly can put the point 2× `radius` away
   * (E143's thinner forest: 46 m for 20 asked), so up to 4 draws, the first within 1.5 × `radius`, else the nearest.
   */
  randomPointNear(p: XYZ, radius: number, agentRadius = 0, rand: () => number = Math.random, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | null {
    const t0 = performance.now();
    try {
      const { mesh } = this.layerFor(agentRadius);
      const s = findNearestPoly(this.nearest, mesh, toVec3(p, this.a, this.datum()), SNAP, DEFAULT_QUERY_FILTER);
      if (!s.success) return null;
      let best = Infinity;
      for (let i = 0; i < 4 && best > radius * 1.5; i++) {
        const r = findRandomPointAroundCircle(mesh, s.nodeRef, s.position, radius, DEFAULT_QUERY_FILTER, rand);
        if (!r.success) continue;
        const d = Math.hypot(r.position[0] - s.position[0], r.position[2] - s.position[2]);
        if (d < best) { best = d; out.set(r.position[0], r.position[1] + this.datum(), r.position[2]); }
      }
      return best < Infinity ? out : null;
    } finally { this.count(t0); }
  }

  /**
   * How far a creature of `agentRadius` can walk from `p` along the bearing `yaw` (three's: +z at 0, +x at π/2) within
   * `dist` m, over the navmesh: `clear` 1 = the whole way, else the fraction to the wall it meets (a hole round a yurt,
   * a fence, the water's edge, ground past 40°) and that wall's normal (xz). Null when `p` is off the mesh.
   */
  clearAhead(p: XYZ, yaw: number, dist: number, agentRadius = 0): { clear: number; normalX: number; normalZ: number } | null {
    const t0 = performance.now();
    try {
      const { mesh } = this.layerFor(agentRadius);
      const s = findNearestPoly(this.nearest, mesh, toVec3(p, this.a, this.datum()), SNAP, DEFAULT_QUERY_FILTER);
      if (!s.success) return null;
      const b = this.b;
      b[0] = s.position[0] + Math.sin(yaw) * dist; b[1] = s.position[1]; b[2] = s.position[2] + Math.cos(yaw) * dist;
      const r = raycast(mesh, s.nodeRef, s.position, b, DEFAULT_QUERY_FILTER);
      if (r.t >= 1) return { clear: 1, normalX: 0, normalZ: 0 };
      return { clear: Math.max(0, r.t), normalX: r.hitNormal[0], normalZ: r.hitNormal[2] };
    } finally { this.count(t0); }
  }

  private count(t0: number): void { const ms = performance.now() - t0; this.stats.queries++; this.stats.ms += ms; this.costSink(ms); }
}

/**
 * `parseNavmesh` over layers a caller already decoded (and checked), its tiles built under `slice`: a region's navigation
 * built every tile in one task (~90 ms of Nalati's and Nine Dragon's crossing at phone 4× CPU). Same tiles, same order.
 */
export async function buildNavmesh(layers: readonly NavigationLayerData[], bytes: number, slice: WorkSlice): Promise<Navmesh> {
  const built: NavLayer[] = [];
  for (const layer of layers) {
    const mesh = layerMesh(layer);
    for (const tile of layer.tiles) {
      addLayerTile(mesh, layer, tile);
      // Only a spent slice yields. Awaiting undefined after each tile also
      // interleaves unrelated preparation while this batch still has budget.
      const pause = slice.check();
      if (pause !== undefined) await pause;
    }
    built.push({ radius: layer.radius, height: layer.height, climb: layer.climb, mesh });
  }
  return new Navmesh(built, bytes);
}

/** Parse a navmesh.bin (scripts/bake-navmesh.mjs's format); null when it isn't one of this version. */
export function parseNavmesh(buf: ArrayBuffer): Navmesh | null {
  try {
    return new Navmesh(decodeNavigation(new Uint8Array(buf)).map(readLayer), buf.byteLength);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** Own an admitted navigation payload and bind its explicit query datum; missing or malformed bytes refuse. */
export function readNavmesh(bytes: Uint8Array | undefined, refusal: string, datum: () => number): Navmesh {
  const nav = bytes === undefined ? null : parseNavmesh(Uint8Array.from(bytes).buffer);
  if (nav === null) throw new Error(refusal);
  nav.datum = datum;
  return nav;
}

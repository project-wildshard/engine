/**
 * The water-surface host (G466 H7): one drawn water body on a look.materials graph, from a row.
 *
 *   const sea = new WaterSurface(row, look).draw(grid, { level, floor, dry, params, lent });   // data + the graph
 *   scene.add(sea.group);                      // sea.mesh is the surface
 *   sea.foamAround(boxes);                     // foam rings wherever a collider box pierces it (a row with a floor)
 *   game.onUpdate((dt) => sea.update(dt));     // the bound params (and the engine's wave clock, `waves`)
 *
 * The row (`@wildshard/format/water#WaterSurfaceSchema`) names the graph, the draw order and culling, the params the host
 * feeds each frame (`bind`: its own clock, the open water's half-extent `waterExtent`, and at draw the chunk's half), static params, an optional baked floor (a `res`² RG half-float texture over the chunk:
 * R = the floor height, baked; G = the foam proximity `foamAround` stamps) and its dry-rectangle sockets. `lent` hands a
 * param a uniform the shard's light owns (read each frame). No callback crosses it (G454). Users: Driftwood's faceted
 * sea (grid, floor, foam, dry sockets, waves), Pine Hollow's creek and waterfall, beaver pool and trickle, Nalati's baked river
 * and brook.
 */
import * as THREE from 'three';
import type { GraphLiteral } from '@wildshard/format/materialGraph';
import { parseWaterSurface, type WaterSurfaceRow } from '@wildshard/format/water';
import { CHUNK_HALF, CHUNK_SIZE } from '@wildshard/engine/core/config';
import { waveClock, waterExtent } from '@wildshard/engine/world/waves';
import { smoothstep } from '@wildshard/engine/core/noise';

/** a surface's compiled graph: its material and, for a row that feeds params or a floor, its writers */
export interface WaterSurfaceLook {
  readonly material: THREE.Material;
  readonly param?: (name: string, value: GraphLiteral) => void;
  readonly texture?: (name: string, texture: THREE.Texture) => void;
}
/** a level-space rectangle the surface is clipped out of (a dry socket) */
export interface WaterDryRect { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number }
/** an oriented collider box as the player uses them (a registry piece's) */
export interface WaterColliderBox { x: number; z: number; hw: number; hd: number; rot: number; yTop: number; yBottom: number }
/** what one draw adds to the row: its level (mesh y), the baked floor heights (half-float bits, `res`²), dry rects,
 *  params known only at run time, and lent uniforms by param name */
export interface WaterSurfaceDraw {
  readonly level?: number;
  readonly floor?: Uint16Array;
  readonly dry?: readonly WaterDryRect[];
  readonly params?: Readonly<Record<string, GraphLiteral>>;
  readonly lent?: Readonly<Record<string, { readonly value: number }>>;
}

/** The compiled look of `id` from a runtime's look materials (`runtimeLookMaterials`). */
export function waterSurfaceLook(looks: { readonly materials: ReadonlyMap<string, THREE.Material>; readonly setParam: (id: string, name: string, value: GraphLiteral) => void; readonly setTexture: (id: string, name: string, texture: THREE.Texture) => void }, id: string): WaterSurfaceLook {
  const material = looks.materials.get(id);
  if (material === undefined) throw new Error(`Water surface: look.materials lacks ${id}`);
  return { material, param: (name, value) => { looks.setParam(id, name, value); }, texture: (name, texture) => { looks.setTexture(id, name, texture); } };
}

/** One water body drawn on its graph (see the module comment). */
export class WaterSurface {
  readonly group: THREE.Group = new THREE.Group();
  readonly row: WaterSurfaceRow;
  /** the still level (m) the surface stands at */
  level = 0;
  private drawn: THREE.Mesh | null = null;
  private time = 0;
  /** the last fixed-step swell second this surface took */
  private stepped = -1;
  /** a transition's normalized travel (0 full, 1 lowered) and the level it heads for */
  private travel = 0;
  private lowered = false;
  private lent: Readonly<Record<string, { readonly value: number }>> = {};
  private floorData: Uint16Array | null = null;
  private floorTex: THREE.DataTexture | null = null;
  private readonly look: WaterSurfaceLook;
  constructor(row: unknown, look: WaterSurfaceLook) { this.row = parseWaterSurface(row); this.look = look; }

  /** the surface (after `draw`) */
  get mesh(): THREE.Mesh {
    if (this.drawn === null) throw new Error(`Water surface ${this.row.name} is not drawn`);
    return this.drawn;
  }

  /** Draw `geometry` in the look with this draw's level, floor, dry rects, params and lent uniforms. */
  draw(geometry: THREE.BufferGeometry, at: WaterSurfaceDraw = {}): this {
    const row = this.row, param = (name: string, value: GraphLiteral): void => { this.writer('param')(name, value); };
    this.level = at.level ?? 0; this.lent = at.lent ?? {};
    for (const [name, value] of Object.entries(row.params)) param(name, value);
    for (const [name, value] of Object.entries(at.params ?? {})) param(name, value);
    if (row.bind.chunkHalf !== undefined) param(row.bind.chunkHalf, CHUNK_HALF);
    const dry = at.dry ?? [];
    if (dry.length > (row.dry?.slots ?? 0)) throw new RangeError(`Water surface ${row.name} clips at most ${String(row.dry?.slots ?? 0)} dry rectangles`);
    if (row.dry !== undefined) for (let i = 0; i < row.dry.slots; i++) {
      const r = dry[i];
      param(`${row.dry.prefix}${String(i)}`, r === undefined ? [...row.dry.none] : [r.minX, r.minZ, r.maxX, r.maxZ]);
    }
    if (row.floor !== undefined) this.lendFloor(row.floor, at.floor);
    this.step();
    geometry.computeBoundingSphere();
    const mesh = this.drawn = new THREE.Mesh(geometry, this.look.material);
    mesh.name = row.name; mesh.position.y = this.level; mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.frustumCulled = row.culled; mesh.renderOrder = row.renderOrder;
    this.group.add(mesh);
    // a transition's level follows the drawn mesh: its look stands the vertices at it in model space (the mesh stays at 0)
    this.applyLevel();
    return this;
  }

  /**
   * Foam rings round every collider box that pierces the surface (piles, boulders, hulls): a `foamReach` proximity
   * falloff stamped into the floor's G channel (the graph reads (1 − G) × reach back as metres). Once at build; again if
   * the set changes. A row without a floor has none.
   */
  foamAround(boxes: readonly WaterColliderBox[]): void {
    const floor = this.row.floor, data = this.floorData, tex = this.floorTex;
    if (floor === undefined || data === null || tex === null) throw new Error(`Water surface ${this.row.name} has no floor to foam`);
    const res = floor.res, cell = CHUNK_SIZE / res, reach = floor.foamReach, band = floor.foamBand, prox = new Float32Array(res * res);
    for (const b of boxes) {
      if (!(b.yBottom < this.level + band && b.yTop > this.level - band)) continue;
      const r = Math.hypot(b.hw, b.hd) + reach, c = Math.cos(b.rot), s = Math.sin(b.rot);
      const x0 = Math.max(0, Math.floor((b.x - r + CHUNK_HALF) / cell)), x1 = Math.min(res - 1, Math.ceil((b.x + r + CHUNK_HALF) / cell));
      const z0 = Math.max(0, Math.floor((b.z - r + CHUNK_HALF) / cell)), z1 = Math.min(res - 1, Math.ceil((b.z + r + CHUNK_HALF) / cell));
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const px = -CHUNK_HALF + (ix + 0.5) * cell - b.x, pz = -CHUNK_HALF + (iz + 0.5) * cell - b.z;
        const lx = Math.abs(px * c + pz * s) - b.hw, lz = Math.abs(pz * c - px * s) - b.hd; // the player's box frame
        const p = 1 - Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) / reach, i = iz * res + ix;
        if (p > (prox[i] ?? 0)) prox[i] = p;
      }
    }
    for (let i = 0; i < prox.length; i++) data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(Math.max(0, prox[i] ?? 0));
    tex.needsUpdate = true;
  }

  /** the bound params: the clock (and the engine's wave clock, `waves`), the open water's half-extent, the lent uniforms */
  /** the transition's companion reveal (0 → 1 across its travel band; 0 without a transition) */
  get reveal(): number { const band = this.row.transition?.reveal; return band === undefined ? 0 : smoothstep(band[0], band[1], this.travel); }
  /** Head for the lowered or the full level; `instant` settles a saved state without the ease. */
  setLowered(lowered: boolean, instant = false): void {
    if (this.row.transition === undefined) throw new Error(`Water surface ${this.row.name} has no level transition`);
    this.lowered = lowered;
    if (instant) { this.travel = lowered ? 1 : 0; this.applyLevel(); }
  }
  /** the eased level between full and lowered (the surface's look stands its vertices at it) */
  private applyLevel(): void {
    const t = this.row.transition;
    if (t !== undefined) this.level = t.full + (t.lowered - t.full) * (1 - (1 - this.travel) ** t.exponent);
  }

  update(dt: number): void {
    const t = this.row.transition, goal = this.lowered ? 1 : 0;
    if (t !== undefined && this.travel !== goal) {
      this.travel = goal > this.travel ? Math.min(1, this.travel + dt / t.seconds) : Math.max(0, this.travel - dt / t.seconds);
      this.applyLevel();
    }
    this.time += dt;
    if (this.row.waves) {
      if (waveClock.stepped !== null && waveClock.stepped !== this.stepped) this.time = this.stepped = waveClock.stepped;
      waveClock.t = this.time;
    }
    this.step();
  }

  private step(): void {
    const bind = this.row.bind, write = this.look.param;
    if (write === undefined) return;
    if (bind.clock !== undefined) write(bind.clock, this.time);
    if (bind.waterHalf !== undefined) write(bind.waterHalf, waterExtent.uWaterHalf.value);
    for (const [name, u] of Object.entries(this.lent)) write(name, u.value);
  }

  private lendFloor(floor: NonNullable<WaterSurfaceRow['floor']>, heights: Uint16Array | undefined): void {
    const res = floor.res;
    if (heights?.length !== res * res) throw new Error(`Water surface ${this.row.name}: its baked floor is not ${String(res)}²`);
    const data = this.floorData = new Uint16Array(res * res * 2);
    heights.forEach((h, i) => { data[i * 2] = h; });
    const tex = this.floorTex = new THREE.DataTexture(data, res, res, THREE.RGFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.writer('texture')(floor.texture, tex);
  }

  private writer<K extends 'param' | 'texture'>(kind: K): NonNullable<WaterSurfaceLook[K]> {
    const w = this.look[kind];
    if (w === undefined) throw new Error(`Water surface ${this.row.name}: its look takes no ${kind}s`);
    return w;
  }
}

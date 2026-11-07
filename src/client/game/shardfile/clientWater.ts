/**
 * The shardfile loader's water surfaces (SHARD-PLATFORM SF15a, SF9d's declarations): each declared body drawn once at
 * its rest surface under `root`, owned by `scope`. The swim / wade port is `shardfileWater` (the motor); this is only the
 * visible surface, so a level never gets a second water from an engine pond bootstrap. A pool is its circle or polygon,
 * a stream a ribbon through its points at their levels, the sea a cell-wide plane. The surface is `materials.get('water')`
 * when the look declares one, else the template's plain translucent grey (its old pool, `world/build.ts`); a graph surface
 * that declares `stages.outline` draws its hull through `outline` (`clientMaterials().outline`).
 */
import { BufferAttribute, BufferGeometry, CircleGeometry, Mesh, MeshStandardMaterial, PlaneGeometry, Shape, ShapeGeometry, Vector2, type Material, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardWater } from '@wildshard/format/water';
import type { GraphOutlineHook } from './clientGraphs';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';

/** the cell edge (500 m) a sea plane covers */
const CELL = 500;

function streamRibbon(body: Extract<ShardWater[number], { kind: 'stream' }>): BufferGeometry {
  const half = body.width / 2, n = body.points.length, positions = new Float32Array(n * 6), indices: number[] = [];
  body.points.forEach((p, i) => {
    const a = body.points[Math.max(0, i - 1)] ?? p, b = body.points[Math.min(n - 1, i + 1)] ?? p;
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1, nx = -dz / length * half, nz = dx / length * half;
    positions.set([p.x + nx, p.level, p.z + nz, p.x - nx, p.level, p.z - nz], i * 6);
    if (i > 0) { const l = (i - 1) * 2; indices.push(l, l + 2, l + 1, l + 1, l + 2, l + 3); }
  });
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function surface(body: ShardWater[number]): BufferGeometry {
  if (body.kind === 'stream') return streamRibbon(body);
  if (body.kind === 'sea') { const g = new PlaneGeometry(CELL, CELL); g.rotateX(-Math.PI / 2); g.translate(0, body.level, 0); return g; }
  const shape = body.shape;
  if (shape.kind === 'circle') { const g = new CircleGeometry(shape.radius, 24); g.rotateX(-Math.PI / 2); g.translate(shape.x, body.level, shape.z); return g; }
  // ShapeGeometry lies in x/y; rotating −90° about x maps y → −z, so the outline is drawn with z negated
  const outline = new Shape(shape.points.map(([x, z]) => new Vector2(x, -z)));
  const g = new ShapeGeometry(outline); g.rotateX(-Math.PI / 2); g.translate(0, body.level, 0); return g;
}

/** The declared bodies left for `installClientWater`: a body the client plan's `world.water` feature draws (its own graph
 *  surface: Driftwood's lowered sea is its ocean) gets no plain stand-in plane (CO1: the template's translucent grey plane
 *  sat at the same level over Driftwood's ocean and showed through as hard-edged pale-lavender patches over the lagoon). */
export function undrawnWater(water: ShardWater, features: readonly ClientFeatureRow[]): ShardWater {
  const drawn = new Set(features.flatMap(row => row.kind === 'world.water' ? row.rows.map(body => body.id) : []));
  return water.filter(body => !drawn.has(body.id));
}

/** Draw every declared water body's surface under `root`; the scope takes the meshes, geometry and default material. */
export function installClientWater(water: ShardWater, ports: { root: Object3D; scope: Scope; materials?: ReadonlyMap<string, Material>; outline?: GraphOutlineHook }): readonly Mesh[] {
  if (water.length === 0) return [];
  const material = ports.materials?.get('water') ?? ports.scope.own(new MeshStandardMaterial({ color: 0x9aa6b0, transparent: true, opacity: 0.7 }));
  return water.map((body) => {
    const mesh = new Mesh(ports.scope.own(surface(body)), material);
    mesh.name = `water:${body.id}`; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 1;
    ports.root.add(mesh); ports.scope.onDispose(() => { mesh.removeFromParent(); });
    ports.outline?.(mesh, material, ports.scope);
    return mesh;
  });
}

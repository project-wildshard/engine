/**
 * The shardfile loader's water surfaces (SHARD-PLATFORM SF15a, SF9d's declarations): each declared body drawn once at
 * its rest surface under `root`, owned by `scope`. The swim / wade port is `shardfileWater` (the motor); this is only the
 * visible surface, so a level never gets a second water from an engine pond bootstrap. A pool is its circle or polygon,
 * a stream a ribbon through its points at their levels, the sea a cell-wide plane. The surface is `materials.get('water')`
 * when the look declares one, else the default water surface (`defaultWaterMaterial`, LF1-3: a no-code shard has no client
 * plan to draw a graph surface, so this is its pond); a graph surface that declares `stages.outline` draws its hull
 * through `outline` (`clientMaterials().outline`).
 */
import { BufferAttribute, BufferGeometry, CircleGeometry, Mesh, MeshStandardMaterial, PlaneGeometry, Shape, ShapeGeometry, Vector2, type Material, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { patchShader } from '@wildshard/engine/render/shaderPatches';
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

/** The default surface's look, after three's standard lighting (`outgoingLight`) and before its output: a view-space
 *  normal rippled from world position (faded with distance, so far water stays flat and does not shimmer), reflected
 *  into a sky made from the shard's own light (its fog colour at the horizon, its hemisphere's sky colour above, its key
 *  light's glint), Fresnel-weighted; the alpha rises with the Fresnel, so water looked into shows its bed. */
const DEFAULT_WATER_GLSL = `{
  vec3 wsV = normalize(vViewPosition), wsUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec2 wsP = vWsWaterWorld.xz;
  float wsFade = 1.0 / (1.0 + length(vViewPosition) * 0.06);
  vec2 wsSlope = vec2(sin(wsP.x * 1.7 + sin(wsP.y * 0.9) * 1.3) + 0.6 * sin(wsP.y * 2.3 + wsP.x * 0.6),
    cos(wsP.y * 1.9 + sin(wsP.x * 1.1) * 1.2) + 0.5 * cos(wsP.x * 2.9 - wsP.y * 0.7)) * 0.045 * wsFade;
  vec3 wsN = normalize((viewMatrix * vec4(normalize(vec3(-wsSlope.x, 1.0, -wsSlope.y)), 0.0)).xyz);
  vec3 wsR = reflect(-wsV, wsN);
  vec3 wsHorizon = vec3(0.62, 0.66, 0.7), wsZenith = vec3(0.32, 0.42, 0.58);
  #if NUM_HEMI_LIGHTS > 0
    wsZenith = hemisphereLights[ 0 ].skyColor;
  #endif
  #ifdef USE_FOG
    wsHorizon = fogColor;
  #endif
  vec3 wsWaterSky = mix(wsHorizon, wsZenith * 0.7, smoothstep(0.0, 0.35, dot(wsR, wsUpV))) * 0.85;
  #if NUM_DIR_LIGHTS > 0
    float wsSun = max(dot(wsR, directionalLights[ 0 ].direction), 0.0);
    wsWaterSky += directionalLights[ 0 ].color * (pow(wsSun, 600.0) * 2.5 + pow(wsSun, 10.0) * 0.3);
  #endif
  float wsFres = 0.22 + 0.78 * pow(1.0 - clamp(dot(wsN, wsV), 0.0, 1.0), 3.0);
  outgoingLight = mix(outgoingLight, wsWaterSky, wsFres);
  diffuseColor.a = mix(diffuseColor.a, 1.0, wsFres);
}
`;

/** The default water surface (LF1-3) for a declared body the look gives no `water` material: three's standard material
 *  (so the engine's fog, shadow and light patches apply as to any other) with a deep tint, a sky reflection and a Fresnel
 *  alpha. One material, one program, for every such body; it reads only light the scene already has. */
export function defaultWaterMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x1b2836, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.7, depthWrite: false });
  material.name = 'water-default';
  patchShader(material, 'lf13-default-water', 100, (shader): void => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWsWaterWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWsWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWsWaterWorld;')
      .replace('#include <opaque_fragment>', `${DEFAULT_WATER_GLSL}#include <opaque_fragment>`);
  }, { key: 'lf13-default-water' });
  return material;
}

/** Draw every declared water body's surface under `root`; the scope takes the meshes, geometry and default material. */
export function installClientWater(water: ShardWater, ports: { root: Object3D; scope: Scope; materials?: ReadonlyMap<string, Material>; outline?: GraphOutlineHook }): readonly Mesh[] {
  if (water.length === 0) return [];
  const material = ports.materials?.get('water') ?? ports.scope.own(defaultWaterMaterial());
  return water.map((body) => {
    const mesh = new Mesh(ports.scope.own(surface(body)), material);
    mesh.name = `water:${body.id}`; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 1;
    ports.root.add(mesh); ports.scope.onDispose(() => { mesh.removeFromParent(); });
    ports.outline?.(mesh, material, ports.scope);
    return mesh;
  });
}

import * as THREE from 'three';
import { ColourRampFog } from '@wildshard/engine/world/Atmosphere';
import type { Scope } from '@wildshard/engine/app/scope';
import type { LookStrategy, TerrainPainter, WorldLookContext } from '@wildshard/engine/render/look';
import { createOwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { bindLowPolyMaterial } from '@wildshard/engine/world/lowpolyKit';
import { parseToonLook, type ToonLookRow } from '@wildshard/format/toonLook';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { runtimeLookMaterials } from '../shardfile/runtimeProduct';
import { lentToon } from '../shardfile/lentLooks';
import { followToonLighting, toonLighting } from './toonLighting';
import { toonSkyBackdrop } from './toonSky';

function createState(row: ToonLookRow) : { dayLight: { uToonLift: { value: THREE.Color; }; uToonRim: { value: THREE.Color; }; uCloudShadow: { value: number; }; uToonNight: { value: number; }; uSeaLevel: { value: number; }; uCloudTime: { value: number; }; }; rampFog: ColourRampFog; } { return { dayLight: toonLighting(row.lighting), rampFog: new ColourRampFog(row.fog) }; }
const states = new Map<string, ReturnType<typeof createState>>();
/** Row admission happens in render setup, before any native material or stream is built. */
export function prepareToonLook(input: unknown): ReturnType<typeof createState> {
  const row = parseToonLook(input);
  let state = states.get(row.id);
  if (state === undefined) { state = createState(row); states.set(row.id, state); }
  return state;
}
/** Resolve the product's prepared toon state. Missing render setup refuses. */
export function toonLookState(product: ShardProduct): ReturnType<typeof createState> {
  const row = product.section('look/toon'), state = states.get(row.id);
  if (state === undefined) throw new Error(`Toon look requires render preparation: ${row.id}`);
  return state;
}
/** A host-owned follow for a lent graph id; authors supply no update callback. */
export function followToonLook(product: ShardProduct, look: string): () => void {
  return followToonLighting(product.section('look/toon').lighting.id, lentToon(look));
}

interface GroundLoan { readonly ground: THREE.Material; readonly slab: THREE.Material; readonly follow: () => void }
async function prepareGround(context: WorldLookContext, product: ShardProduct, row: ToonLookRow): Promise<GroundLoan> {
  const g = row.ground;
  const { materials, toon } = await runtimeLookMaterials(context, product.shardfile, true, [g.materials.ground, g.materials.slab, ...Object.values(g.kit)]);
  const ground = materials.get(g.materials.ground), slab = materials.get(g.materials.slab);
  if (ground === undefined || slab === undefined) throw new Error('Toon ground lacks its graph materials');
  for (const [variant, id] of Object.entries(g.kit)) {
    const material = materials.get(id);
    if (material === undefined) throw new Error(`Toon ground lacks kit graph: ${id}`);
    bindLowPolyMaterial(context.sky, variant, material, context.scope);
  }
  return { ground, slab, follow: followToonLighting(row.lighting.id, toon) };
}

/** Client-only toon look from a single admitted platform section. All rendering hooks are owned here.
 * The terrain painter decodes the existing baked ground/slab and never regenerates terrain at runtime. */
export function toonLook(product: ShardProduct): LookStrategy {
  const row = parseToonLook(product.section('look/toon')), state = prepareToonLook(row);
  const loans = new WeakMap<Scope, GroundLoan>();
  const painter: TerrainPainter = { build: async (terrain, field, scope) => {
    await field.ready();
    const loan = loans.get(scope);
    if (loan === undefined) throw new Error('Toon ground requires its prepared materials');
    const grid = createOwnedGeometry(product.url(row.ground.files.ground)), walls = createOwnedGeometry(product.url(row.ground.files.slab));
    await Promise.all([product.file(row.ground.files.ground).then(bytes => grid.load(bytes)), product.file(row.ground.files.slab).then(bytes => walls.load(bytes))]);
    terrain.mesh = new THREE.Mesh(grid.take(), loan.ground);
    terrain.mesh.receiveShadow = true; terrain.mesh.castShadow = true; terrain.mesh.onBeforeRender = loan.follow;
    terrain.group.add(terrain.mesh);
    const sides = new THREE.Mesh(walls.take(), loan.slab); sides.receiveShadow = true; terrain.group.add(sides);
  } };
  return { mode: 'extend', chain: 'clean', compose: c => ({ chain: c.engineChain('clean') }),
    fog: state.rampFog.model(row.fog.order), fogControl: state.rampFog.control, shadows: row.shadows,
    backdrop: toonSkyBackdrop(product, row, state.rampFog), terrainPainter: painter,
    prepareWorld: async context => { loans.set(context.scope, await prepareGround(context, product, row)); context.scope.onDispose(() => { loans.delete(context.scope); }); },
  };
}

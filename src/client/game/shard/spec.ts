import type { EngineMechanism, LevelSpec } from '@wildshard/engine/level/spec';
import { bakedMapUrl, type ShardManifest } from './manifest';
import { absentShardProduct, type ShardProduct } from '../../../shared/game/shardfile/shardProduct';

const ENGINE_MECHANISMS: ReadonlySet<string> = new Set(['weather', 'dayCycle', 'bosses', 'elites', 'spawns', 'quests', 'swim', 'hover', 'explore', 'practice']);
const engineMechanism = (value: string): value is EngineMechanism => ENGINE_MECHANISMS.has(value);

/**
 * Node-safe boundary. Only authored engine policy crosses it, never title or game metadata. `product` is the shard's
 * loaded built output: it is bound into the look and roster loaders here, so the engine gets plain loaders and never
 * learns of products (progress/shard-platform/product-in-look-o272/). Without one they get an absent product, whose
 * every read refuses.
 */
export function toLevelSpec(manifest: ShardManifest, product?: ShardProduct): LevelSpec {
  const { render, roster } = manifest, bound = (): ShardProduct => product ?? absentShardProduct(manifest.slug);
  const { style: creatureStyle, dev } = manifest; // opaque authored metadata, copied without a rendering decision
  return {
    id: manifest.slug,
    seed: manifest.seed, treeCount: manifest.treeCount, label: manifest.label,
    ...(dev === undefined ? {} : { capturePoses: async () => Object.fromEntries(Object.entries(await dev.poses()).map(([name, pose]) => [name, { eye: pose.eye, yaw: pose.yaw, pitch: pose.pitch, ...(pose.feet === undefined ? {} : { feet: pose.feet }), ...(pose.probe === undefined ? {} : { probe: pose.probe }) }])) }),
    ...(manifest.horizonStrips === undefined ? {} : { horizonStrips: manifest.horizonStrips }),
    creatureStyle,
    ...(manifest.world === undefined ? {} : { world: manifest.world }),
    ...(manifest.navmesh === undefined ? {} : { navmesh: manifest.navmesh }),
    ...(manifest.navigation === undefined ? {} : { navigation: manifest.navigation }),
    ...(manifest.creatures === undefined ? {} : { creatures: manifest.creatures }),
    ...(manifest.debugOptions === undefined ? {} : { debugOptions: manifest.debugOptions }),
    ...(manifest.blender === undefined ? {} : { blender: manifest.blender }),
    ground: { ...(manifest.ground.paths === undefined ? {} : { paths: manifest.ground.paths }), ...(manifest.ground.terrain === undefined ? {} : { terrain: manifest.ground.terrain }),
      ...(manifest.ground.tiled === undefined ? {} : { tiled: true }),
      ...(manifest.ground.structures === undefined ? {} : { structures: true }), ...(manifest.ground.water === undefined ? {} : { water: manifest.ground.water }) },
    spawn: manifest.spawn,
    sky: manifest.sky, atmosphere: manifest.atmosphere, grade: manifest.grade,
    budgets: manifest.budgets ?? {}, fight: manifest.fight ?? {},
    mechanisms: (manifest.uses ?? []).filter(engineMechanism),
    boot: manifest.boot ?? { files: () => typeof manifest.ground.structures === 'object' ? manifest.ground.structures.files : [] },
    audio: manifest.audio ?? { ambience: 'legacy', score: 'legacy' },
    loadout: manifest.loadout ?? { weapons: [], tools: [], start: [] },
    species: manifest.species ?? [], spawns: manifest.spawns,
    minimap: ((map) => {
      const { image: path, ...look } = map ?? {};
      const built = manifest.shardfile !== undefined || manifest.gridShardfile !== undefined;
      const image = path === undefined || (built && !path.startsWith('data:') && !path.startsWith('blob:')) ? undefined : bakedMapUrl(path);
      return image === undefined ? look : { ...look, image };
    })(manifest.minimap),
    kitLook: manifest.kitLook ?? 'pbr',
    ...(manifest.hands === undefined ? {} : { hands: manifest.hands }),
    ...(manifest.bounds === undefined ? {} : { bounds: manifest.bounds }),
    ...(manifest.camera === undefined ? {} : { camera: manifest.camera }),
    ...(render === undefined ? {} : { look: () => render(bound()) }),
    ...(manifest.look === undefined ? {} : { lookLayer: manifest.look }),
    ...(manifest.tiers === undefined ? {} : { tiers: manifest.tiers }),
    ...(manifest.faunaTuning === undefined ? {} : { faunaTuning: manifest.faunaTuning }),
    trees: manifest.trees,
    ...(manifest.forest === undefined ? {} : { forest: manifest.forest }),
    ...(manifest.horizon === undefined ? {} : { horizon: manifest.horizon }),
    ...(manifest.boundary === undefined ? {} : { boundary: manifest.boundary }),
    ...(manifest.hud === undefined ? {} : { hud: manifest.hud }),
    ...(manifest.pois === undefined ? {} : { pois: manifest.pois }),
    ...(manifest.groundColor === undefined ? {} : { groundColor: manifest.groundColor }),
    ...(manifest.surfaceAt === undefined ? {} : { surfaceAt: manifest.surfaceAt }),
    ...(manifest.assets === undefined ? {} : { assets: manifest.assets }),
    ...(manifest.explore === undefined ? {} : { explore: manifest.explore }),
    ...((roster === undefined && product?.has('explore/catalogue') !== true) ? {} : { roster: async () => {
      const native = await roster?.(bound()) ?? [];
      return product?.has('explore/catalogue') === true ? (await import('../models/explorerCatalogue')).explorerRoster(product, native) : native;
    } }),
  };
}

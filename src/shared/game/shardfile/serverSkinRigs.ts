import { skinLookParameters } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import type { Shardfile } from '@wildshard/format/shardSchema';

/**
 * The skin rigs a server reads (GLB refs, as a skin row names its file): a spawned species' skin look and its variants. The
 * server's creature hit volumes, strike sockets and giant height check read the rest rig from the GLB itself (AP36c). Static
 * GLBs, materials and textures stay the page's.
 */
export function serverSkinRigs(shard: Pick<Shardfile, 'rows' | 'files' | 'creatures'>): ReadonlySet<string> {
  const spawned = new Set(shard.creatures.spawns.map(spawn => spawn.species));
  const looks = new Set(shard.rows.species.flatMap(species => spawned.has(species.id) && species.body !== undefined ? [species.body.look] : []));
  const files = new Map(shard.files.map(file => [file.hash, file])), rigs = new Set<string>(), seen = new Set<string>();
  const walk = (ref: string): void => {
    if (seen.has(ref)) return;
    seen.add(ref);
    const file = files.get(ref) ?? files.get(ref.replace(/^commons:/u, ''));
    if (file === undefined) return;
    if (file.kind === 'glb') { rigs.add(ref); return; }
    if (file.kind === 'json') for (const dependency of file.dependencies) walk(dependency);
  };
  for (const look of shard.rows.looks) {
    if (!looks.has(look.id) || look.recipe !== SKIN_LOOK_RECIPE) continue;
    const { skin, variants } = skinLookParameters(look);
    walk(skin);
    if (variants !== undefined) walk(variants);
  }
  return rigs;
}

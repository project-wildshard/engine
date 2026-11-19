import { splatTerrainOf, splatTextureRefs } from '@wildshard/format/splatTerrain';
import type { Shardfile } from '@wildshard/format/shardSchema';

/**
 * Whether a shard's splat ground draws from its tiles (G518, tile streaming P1; G669 DR10: always, for a shard that declares
 * one): its props tiles' ground primitives draw and the world hides its whole native ground mesh.
 */
export function splatGroundDrawn(props: object | null): boolean {
  return props !== null && splatTerrainOf(props) !== undefined;
}
/** The files a declared splat ground streams: each props tile's primary (ground) GLB and every layer file (empty without one). */
export function splatGroundFiles(source: Pick<Shardfile, 'props'>): Set<string> {
  const props = source.props, splat = props === null ? undefined : splatTerrainOf(props);
  return props === null || splat === undefined ? new Set() : new Set([...props.tiles.map(tile => tile.file), ...splatTextureRefs(splat)]);
}
/**
 * A native runtime's data source (`withoutRuntimeRows`, its bound props emptied) with its splat ground back when the ground
 * tiles draw (`splatGroundDrawn`): the bound props tiles' primary (ground) files only, never their additional files (the
 * runtime draws those), with their tile rows, files and layer library entries, so the data client streams the ground.
 */
export function withSplatGround(data: Shardfile, full: Shardfile): Shardfile {
  const props = full.props, splat = props === null ? undefined : splatTerrainOf(props);
  if (props === null || splat === undefined || data.props === null || !splatGroundDrawn(props)) return data;
  const primary = new Set(props.tiles.map(tile => tile.file)), layers = new Set(splatTextureRefs(splat));
  const known = new Set(data.files.map(file => file.hash)), shared = new Set(data.library);
  const key = (row: { lod: number; x: number; z: number }): string => `${String(row.lod)}/${String(row.x)}/${String(row.z)}`;
  const ground = new Map(full.tiles.flatMap(row => { const files = row.files.filter(ref => primary.has(ref)); return files.length === 0 ? [] : [[key(row), { ...row, files }] as const]; }));
  return { ...data,
    props: { ...data.props, tiles: props.tiles.map(tile => ({ lod: tile.lod, x: tile.x, z: tile.z, file: tile.file })), splat },
    tiles: [...data.tiles.map(row => { const extra = ground.get(key(row)); return extra === undefined ? row : { ...row, files: [...row.files, ...extra.files] }; }),
      ...[...ground].filter(([at]) => !data.tiles.some(row => key(row) === at)).map(([, row]) => row)],
    files: [...data.files, ...full.files.filter(file => (primary.has(file.hash) || layers.has(file.hash)) && !known.has(file.hash))],
    library: [...data.library, ...full.library.filter(ref => layers.has(ref) && !shared.has(ref))] };
}

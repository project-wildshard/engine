/**
 * Standalone shardfiles SF28: the image blobs a page's materials read through the KTX2 table (`clientMaterials`: look maps
 * and graph params, prop textures and prop material slots, skin looks). A phone that loads KTX2 draws each from the cook's
 * KTX2 and never decodes the image, so the cook leaves the image out of the phone's lists, admission leaves it unread, and the
 * material reads the KTX2 (or, on a page that reads images, the image) as it compiles (`standInRead.ts`). A splat ground's
 * layers are read by their own rows
 * (`splatLayerRows.ts`) and stay out. Any other reader of an image blob (lightmaps, lent textures, a glTF's own images, UI
 * art) decodes the image, so it is read as it is.
 */
import type { Shardfile } from '@wildshard/format/shardSchema';
import { materialTextureRefs } from '@wildshard/format/materials';
import { propMaterialTextureRefs, propMaterialsOf } from '@wildshard/format/propMaterials';
import { skinLookParameters, skinLookTierRoots } from '@wildshard/format/skinAssets';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import { splatTerrainOf, splatTextureRefs } from '@wildshard/format/splatTerrain';

/** A skin look's coat textures on `tier`: its tier root's dependencies after the first (the rig), and its table's. */
export function skinTextureRefsOn(source: Pick<Shardfile, 'rows' | 'files'>, tier: 'phone' | 'desktop'): string[] {
  const files = new Map(source.files.map((file) => [file.hash, file]));
  return [...new Set(source.rows.looks.flatMap((look) => {
    if (look.recipe !== SKIN_LOOK_RECIPE) return [];
    const [head, table] = skinLookTierRoots(skinLookParameters(look), tier);
    const skins = [head, ...(table === undefined ? [] : files.get(table)?.dependencies ?? [])];
    return skins.flatMap((hash) => files.get(hash)?.dependencies.slice(1) ?? []);
  }))];
}

/** The hashes `clientMaterials` reads through the KTX2 table on `tier`, splat layers left out. */
export function tableTextureRefs(source: Pick<Shardfile, 'look' | 'props' | 'rows' | 'files'>, tier: 'phone' | 'desktop'): ReadonlySet<string> {
  const named = source.props === null ? undefined : propMaterialsOf(source.props);
  const splat = source.props === null ? undefined : splatTerrainOf(source.props);
  const layers = new Set(splat === undefined ? [] : [...splatTextureRefs(splat, 'phone'), ...splatTextureRefs(splat, 'desktop')]);
  const refs = [...materialTextureRefs(source.look.materials), ...(source.props?.textures.map((entry) => entry.colour) ?? []),
    ...propMaterialTextureRefs(named), ...skinTextureRefsOn(source, tier)];
  return new Set(refs.filter((hash) => !layers.has(hash)));
}

const BLOB_KTX2 = /\/blobs\/([a-f0-9]{64})(?:-[a-f0-9]{8}(?:\.t\d+-[a-f0-9]{8})?|\.t\d+-[a-f0-9]{8})\.ktx2$/u;
/** The image blob a cooked blob KTX2 stands in for, from its path (`blobKtx2.ts`: `/assets/<folder>/blobs/<hash>-<hash8>.ktx2`,
 *  and the phone pass's `/assets/<folder>/blobs/<hash>.t<max>-<hash8>.ktx2` copy of it); undefined for any other path. */
export const blobKtx2Hash = (path: string): string | undefined => BLOB_KTX2.exec(path.replace(/[?#].*$/u, ''))?.[1];

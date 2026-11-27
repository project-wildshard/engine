/**
 * SF16 (J525): a shardfile carries images only, and many of its textures are product blobs named by hash: a look's material
 * maps, a prop material's slots, a prop's colour texture and a splat ground's layers. The page admits those by hash, so the
 * cook can't swap their bytes. It writes each PNG or JPEG one as a KTX2 beside the product instead, with the role its use gives
 * it, and names it in every KTX2 table of the discovery document under the blob's product URL
 * (`/shardfiles/<folder>/blobs/image/<hash>.<ext>`); a splat layer under that URL plus `#layer`, as a cooked phone layer is
 * (`splatLayerRows.ts`). The phone pass (`phoneTier`) then makes its 6x6 copy from that file. A page that loads KTX2 reads the
 * table's file and never the blob; a page that can't (KTX2 vetoed) reads the blob, the image.
 *
 * Blob textures are glTF-oriented (the loaders upload them with `flipY` off), so none is flipped.
 */
// oxlint-disable-next-line import/no-nodejs-modules -- the cook runs in Node.
import {createHash} from 'node:crypto';
import {propMaterialsOf, propMaterialSlots, propSlotUse} from '@wildshard/format/propMaterials';
import {splatTerrainOf} from '@wildshard/format/splatTerrain';
import {splatLayerKey} from '@wildshard/engine/boot/splatLayerRows';
import {dataKtx2} from './dataKtx2';
import {imageHead, type ImageKtx2Encode} from './imageKtx2Wasm';
import type {TextureRole, TierFile} from './tierTextures';

/** How the page samples a blob texture: its colour space (`data`: read byte for byte, SF17, so encoded losslessly), and
 *  whether a splat ground's array reads it (`#layer`). */
export type BlobTextureRole = TextureRole | 'data';
export interface BlobTextureUse {readonly role: BlobTextureRole; readonly layer: boolean}
/** One image blob a texture rule names: its hash, its URL in the product and its bytes. */
export interface TextureBlob {readonly hash: string; readonly url: string; readonly bytes: Uint8Array; readonly use: BlobTextureUse}

type Json = Readonly<Record<string, unknown>>;
const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/u;
// data over every lossy role: a map one rule reads byte for byte is never encoded lossy for another
const rank: Record<BlobTextureRole, number> = {linear: 0, normal: 1, srgb: 2, data: 3};

/** A pbr map's role from its key in `maps` (`colour`, `normal`, `arm`, ...): colour is sRGB, normal is normal, the rest data. */
function mapRole(key: string): TextureRole {
  if (/normal/iu.test(key)) return 'normal';
  return /colou?r|albedo|base|diffuse|emissive/iu.test(key) ? 'srgb' : 'linear';
}

/** Per blob hash a texture rule names, how the page samples it. A hash two rules name takes the stricter role (data over
 *  colour over normal over linear) and is a layer if either is. Unknown shapes are colour: the hand-made bake's own default.
 *  `skins` are the skin looks' textures (format `skinLookTextureRefs`, SF17): a creature's coat, colour. */
export function blobTextureUses(look: unknown, props: unknown, skins: readonly string[] = []): ReadonlyMap<string, BlobTextureUse> {
  const out = new Map<string, BlobTextureUse>();
  const note = (hash: unknown, role: BlobTextureRole, layer = false): void => {
    if (typeof hash !== 'string' || !HASH.test(hash)) return;
    const held = out.get(hash);
    out.set(hash, {role: held === undefined || rank[role] > rank[held.role] ? role : held.role, layer: layer || held?.layer === true});
  };
  const materials = isMap(look) && isMap(look['materials']) ? look['materials'] : {};
  for (const material of Object.values(materials)) {
    if (!isMap(material)) continue;
    if (material['family'] === 'pbr' && isMap(material['maps'])) for (const [key, hash] of Object.entries(material['maps'])) note(hash, mapRole(key));
    const ground = isMap(material['ground']) ? material['ground'] : {};
    // SF17: the ground's grain, trail and key-shadow maps are data the shader reads byte for byte (Dunes' sand)
    for (const part of ['grain', 'trail', 'keyShadow']) { const row = ground[part]; if (isMap(row)) note(row['map'], 'data'); }
    if (material['family'] === 'graph' && isMap(material['graph']) && isMap(material['graph']['params'])) {
      // a graph reads every texture param in the colour role (clientGraphs)
      for (const param of Object.values(material['graph']['params'])) if (isMap(param) && param['type'] === 'texture') note(param['value'], 'srgb');
    }
    note(material['map'], 'srgb');
  }
  if (isMap(props)) {
    const splat = splatTerrainOf(props);
    for (const set of splat === undefined ? [] : [splat.layers, ...(splat.phone === undefined ? [] : [splat.phone])]) {
      for (const hash of set.colour) note(hash, 'srgb', true);
      for (const hash of set.normal) note(hash, 'normal', true);
      for (const hash of set.arm) note(hash, 'linear', true);
    }
    const named = propMaterialsOf(props);
    for (const row of Object.values(named ?? {})) for (const [slot, value] of propMaterialSlots(row)) note(value.file, slot === 'normal' ? 'normal' : propSlotUse(slot) === 'colour' ? 'srgb' : 'linear');
    const textures = Array.isArray(props['textures']) ? props['textures'] : [];
    for (const row of textures) if (isMap(row)) note(row['colour'], 'srgb');
  }
  for (const hash of skins) note(hash, 'srgb');
  return out;
}

const hex8 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 8);

/** The tier maps of the discovery document's KTX2 tables. */
function tierMaps(native: Json | undefined): {phone: Record<string, unknown>; desktop: Record<string, unknown>}[] {
  const out: {phone: Record<string, unknown>; desktop: Record<string, unknown>}[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!isMap(value)) return;
    if (isMap(value['phone']) && isMap(value['desktop'])) { out.push({phone: value['phone'], desktop: value['desktop']}); return; }
    for (const item of Object.values(value)) walk(item);
  };
  walk(native?.['ktx2']);
  return out;
}

/** SF17: the table key of a data map's lossless KTX2: the blob's URL plus `#data`. */
export const dataMapKey = (blobUrl: string): string => `${blobUrl}#data`;

/** A colour, normal or linear blob's UASTC KTX2; undefined off the 4x4 grid (a block format's top level is whole blocks). */
function encodedBlob(image: Uint8Array, role: TextureRole, encode: ImageKtx2Encode): Uint8Array | undefined {
  const head = imageHead(image);
  return head === undefined || head.width % 4 !== 0 || head.height % 4 !== 0 ? undefined : encode(image, {role, flip: false});
}

/** SF16: each PNG or JPEG texture blob's KTX2 at `/assets/<folder>/blobs/<hash>-<hash8>.ktx2`, named in every table (desktop and
 *  phone; the phone pass makes the phone's file from it) under the blob's URL, a splat layer's under the URL plus `#layer`.
 *  Undefined when none is encoded or the document has no table, so the page reads the blobs as before. `files` is keyed by hash. */
export function blobKtx2(discovery: Uint8Array, folder: string, blobs: readonly TextureBlob[], encode: ImageKtx2Encode): {readonly discovery: Uint8Array; readonly files: ReadonlyMap<string, TierFile>} | undefined {
  const document = JSON.parse(new TextDecoder().decode(discovery)) as unknown;
  const native = isMap(document) && isMap(document['native']) ? document['native'] : undefined;
  const maps = tierMaps(native);
  if (maps.length === 0) return undefined;
  const files = new Map<string, TierFile>();
  for (const blob of blobs) {
    const {role} = blob.use, bytes = role === 'data' ? dataKtx2(blob.bytes) : encodedBlob(blob.bytes, role, encode);
    if (bytes === undefined) continue;
    const file = {from: blob.url, url: `/assets/${folder}/blobs/${blob.hash}-${hex8(bytes)}.ktx2`, bytes};
    files.set(blob.hash, file);
    // SF17: a data map's row says so (`#data`), so a page reads its lossless file whichever texture mode it loads with
    const key = blob.use.layer ? splatLayerKey(blob.url) : role === 'data' ? dataMapKey(blob.url) : blob.url;
    for (const map of maps) { map.desktop[key] = file.url; map.phone[key] = file.url; }
  }
  if (files.size === 0) return undefined;
  return {discovery: new TextEncoder().encode(JSON.stringify(document)), files};
}

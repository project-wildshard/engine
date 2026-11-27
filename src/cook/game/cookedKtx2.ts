/** SF15 (J525): the cook makes every KTX2 from the shardfile's own images. A shardfile carries one image per texture (a JPG
 * or PNG mount, and GLBs holding JPG or PNG images); the cook encodes each as a desktop UASTC KTX2 (`ImageKtx2Encode`), and
 * the phone tier's ASTC 6x6 files are then cooked from those (`phoneTier`, S12c), so the KTX2 table the client reads
 * (`gpuFiles.ts` `standIn`) names the cook's files and no shard carries a hand-made set.
 *
 * What is encoded: every `/assets/` mount whose bytes are a PNG or JPEG on the 4x4 block grid, and nothing a cook mount
 * row marks `keepImage` (UI art, pixel art: J525's opt-out). A source the table already names (a shard from before SF15,
 * with its hand-made set) keeps its row, so an old shard cooks as it did.
 *
 * How (the hand-made sets' rules, sharddev `bake-ktx2.mjs`): the role from the file's name (`roleOfImage`); a standalone
 * image Y-flipped unless it is a glTF's external texture or a lightmap; a ground layer file
 * (`/tex/<set>/diffuse|nor_gl|arm.jpg`) also gets its unflipped `#layer` twin, trimmed to the desktop's array size, which
 * the array loader reads (`core/ktx2.ts`).
 *
 * Pure bytes in, bytes out: no file system, no shardfile. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
import {trimKtx2, type TextureRole, type TierFile} from './tierTextures';
import {imageHead, type ImageKtx2Encode} from './imageKtx2Wasm';

type Json = null | boolean | number | string | readonly Json[] | {readonly [key: string]: Json};
type StringMap = Record<string, string>;
const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hex8 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 8);

/** The desktop's texture-array size (`core/tier.ts` layerSize): a desktop `#layer` twin keeps no level above it. */
export const DESKTOP_LAYER_MAX = 1024;
/** A ground layer file (`/tex/<set>/diffuse|nor_gl|arm[_1k].jpg`): the array loader reads its unflipped `#layer` twin. */
const LAYER_FILE = /\/tex\/[^/]+\/(?:diffuse|nor_gl|arm)(?:_1k)?\.(?:jpe?g|png)$/iu;
const PHONE_COPY = /[.-]phone\.[a-z0-9]+$/iu;

/** A texture's role from its file name (`bake-ktx2.mjs` classOf): normal maps, numeric planes and lightmaps read linear. */
export function roleOfImage(url: string): TextureRole {
  const name = url.split('/').pop()?.toLowerCase() ?? '';
  if (/(?:^|[_\-.])(?:nor|nor_gl|normal|nrm)(?:[_\-.]|$)/u.test(name)) return 'normal';
  if (/(?:^|[_\-.])(?:lm|clouds|arm|orm|ao|rough|roughness|metal|metalness|metallic|height|disp|mask)(?:[_\-.]|$)/u.test(name)) return 'linear';
  return 'srgb';
}

/** Whether a standalone image's loader drew it flipped (`flipY = true`): all but a glTF's external texture (glTF's own
 *  convention) and a lightmap (loaded `flipY = false`, as Driftwood's are). */
export function flipsImage(url: string, gltfFolders: ReadonlySet<string>): boolean {
  const folder = url.slice(0, url.lastIndexOf('/')), parent = folder.slice(0, folder.lastIndexOf('/'));
  if (folder.endsWith('/textures') && gltfFolders.has(parent)) return false;
  return !/(?:^|[_\-.])lm[_\-.]/u.test(url.split('/').pop()?.toLowerCase() ?? '');
}

/** One mount the cook may encode: its URL, its bytes, and whether its row keeps it an image (`keepImage`). */
export interface CookImageMount {readonly url: string; readonly read: () => Uint8Array; readonly keepImage?: boolean}

export interface DesktopKtx2 {
  /** The discovery document with the cook's rows in every desktop and phone map of its KTX2 table. */
  readonly discovery: Uint8Array;
  /** Each desktop file the cook made, `from` the source it stands in for (a `#layer` twin's `from` is the layer key). */
  readonly files: readonly TierFile[];
  /** Per mount URL a desktop list names, the cook's files its desktop rows point at (the KTX2, its `#layer` twin). */
  readonly desktopTargets: ReadonlyMap<string, readonly string[]>;
  /** Per mount URL a phone list names (the image or its phone copy), the targets its phone rows point at. */
  readonly phoneTargets: ReadonlyMap<string, readonly string[]>;
}

/** The tier maps of a KTX2 table, any shape (`pageModeKtx2` args, `GPU_FILES`, a bare tier map), as `phoneTier` walks it. */
function tierMaps(table: unknown): {phone: StringMap; desktop: StringMap}[] {
  const out: {phone: StringMap; desktop: StringMap}[] = [];
  const strings = (value: unknown): value is StringMap => isMap(value) && Object.values(value).every(target => typeof target === 'string');
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!isMap(value)) return;
    if (strings(value['phone']) && strings(value['desktop'])) { out.push({phone: value['phone'], desktop: value['desktop']}); return; }
    for (const item of Object.values(value)) walk(item);
  };
  walk(table);
  return out;
}

/** SF15: the desktop KTX2 files of a shard's images and the table rows that name them, in every map of its discovery
 *  document (a table it lacks is made, as a one-shard and a grid page read it: `pageModeKtx2`). Undefined when nothing is
 *  encoded, so the cook keeps every byte of today's product. */
export function desktopKtx2(discovery: Uint8Array, mounts: readonly CookImageMount[], encode: ImageKtx2Encode): DesktopKtx2 | undefined {
  const document = JSON.parse(new TextDecoder().decode(discovery)) as Json;
  if (!isMap(document)) return undefined;
  const native = isMap(document['native']) ? document['native'] as Record<string, unknown> : undefined;
  let maps = tierMaps(native?.['ktx2']);
  const made = maps.length === 0;
  if (made) {
    const shard = {phone: {}, desktop: {}}, grid = {phone: {}, desktop: {}};
    maps = [shard, grid];
    if (native === undefined) return undefined;
    native['ktx2'] = {$call: 'pageModeKtx2', args: [{shard, grid}]};
  }
  const named = new Set(maps.flatMap(map => Object.keys(map.desktop)));
  const phoneNamed = new Set(maps.flatMap(map => Object.keys(map.phone)));
  const urls = new Set(mounts.map(mount => mount.url));
  const gltfFolders = new Set(mounts.filter(mount => mount.url.endsWith('.gltf')).map(mount => mount.url.slice(0, mount.url.lastIndexOf('/'))));
  const files: TierFile[] = [], desktopRows: [string, string][] = [], phoneRows: [string, string][] = [], phoneTargets = new Map<string, string[]>(), desktopTargets = new Map<string, string[]>();
  const file = (from: string, stem: string, bytes: Uint8Array, ext: string): string => {
    const url = `${stem}-${hex8(bytes)}.${ext}`;
    files.push({from, url, bytes});
    return url;
  };
  const desktopRow = (key: string, mount: string, target: string): void => {
    desktopRows.push([key, target]);
    desktopTargets.set(mount, [...desktopTargets.get(mount) ?? [], target]);
  };
  const phoneRow = (key: string, mount: string, target: string): void => {
    if (phoneNamed.has(key)) return;
    phoneRows.push([key, target]);
    phoneTargets.set(mount, [...phoneTargets.get(mount) ?? [], target]);
  };
  /** The URL the phone serves in a file's place: its `.phone` or `-phone` copy when the shard carries one. */
  const phoneServed = (url: string): string => {
    const dot = url.lastIndexOf('.'), stem = url.slice(0, dot);
    return [...urls].find(other => other !== url && PHONE_COPY.test(other) && (other.startsWith(`${stem}.phone.`) || other.startsWith(`${stem}-phone.`))) ?? url;
  };
  /** The URLs a phone may ask in a file's place: the one it serves, and a ground layer's `_1k` name (`texUrl` on the phone), which
   *  a shard carrying one image per texture no longer holds. */
  const phoneKeys = (url: string, served: string): readonly string[] => {
    const small = LAYER_FILE.test(url) && !/_1k\.[a-z]+$/iu.test(url) ? url.replace(/(\.[a-z]+)$/iu, '_1k$1') : undefined;
    return small === undefined || small === served || urls.has(small) ? [served] : [served, small];
  };
  for (const mount of mounts) {
    const {url} = mount;
    if (mount.keepImage === true || !url.startsWith('/assets/') || named.has(url) || PHONE_COPY.test(url)) continue;
    const dot = url.lastIndexOf('.'), stem = url.slice(0, dot), ext = url.slice(dot + 1).toLowerCase();
    if (!/^(?:jpe?g|png)$/u.test(ext)) continue;
    const bytes = mount.read(), head = imageHead(bytes);
    // A block format's top level is whole 4x4 blocks; an image off that grid stays an image.
    if (head === undefined || head.width % 4 !== 0 || head.height % 4 !== 0) continue;
    const role = roleOfImage(url), flip = flipsImage(url, gltfFolders), served = phoneServed(url);
    const plain = encode(bytes, {role, flip});
    if (plain !== undefined) {
      const target = file(url, stem, plain, 'ktx2');
      desktopRow(url, url, target);
      for (const key of phoneKeys(url, served)) phoneRow(key, served, target);
    }
    if (LAYER_FILE.test(url)) {
      const twin = flip ? encode(bytes, {role, flip: false}) : plain;
      if (twin === undefined) continue;
      const desktop = trimKtx2(twin, DESKTOP_LAYER_MAX), key = `${url}#layer`, target = file(key, `${stem}.layer`, desktop, 'ktx2');
      desktopRow(key, url, target);
      // The phone's twin is the whole one: a kept row, encoded 6x6 at its own size (`phoneTierSize`).
      const whole = desktop === twin ? target : file(`${served}#layer`, `${stem}.layer-full`, twin, 'ktx2');
      for (const asked of phoneKeys(url, served)) phoneRow(`${asked}#layer`, served, whole);
    }
  }
  if (files.length === 0) return undefined;
  for (const map of maps) {
    for (const [source, target] of desktopRows) map.desktop[source] = target;
    for (const [source, target] of phoneRows) map.phone[source] = target;
  }
  return {discovery: new TextEncoder().encode(JSON.stringify(document)), files, desktopTargets, phoneTargets};
}

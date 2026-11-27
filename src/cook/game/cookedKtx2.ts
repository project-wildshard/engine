/** SF15 (J525): the cook makes every KTX2 from the shardfile's own images. A shardfile carries one image per texture (a JPG
 * or PNG mount, and GLBs holding JPG or PNG images); the cook encodes each as a desktop UASTC KTX2 (`ImageKtx2Encode`), and
 * the phone tier's ASTC 6x6 files are then cooked from those (`phoneTier`, S12c), so the KTX2 table the client reads
 * (`gpuFiles.ts` `standIn`) names the cook's files and no shard carries a hand-made set.
 *
 * What is encoded: every `/assets/` mount whose bytes are a PNG, JPEG or WebP (SF19: read from a PNG of its pixels) on the
 * 4x4 block grid, every `.glb` mount holding such images (`ktx2Glb`), and nothing a cook mount row marks `keepImage` (UI art, pixel art: J525's opt-out). A source the table already names (a shard from before SF15,
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
import {readGlb, trimKtx2, writeGlb, type Gltf, type TextureRole, type TierFile} from './tierTextures';
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

/** Per image of a GLB, the strictest role of the slots that sample it (colour over normal over linear). */
export function glbImageRoles(json: Gltf): ReadonlyMap<number, TextureRole> {
  const rank: Record<TextureRole, number> = {linear: 0, normal: 1, srgb: 2};
  const out = new Map<number, TextureRole>();
  const sourceOf = (texture: number): number | undefined => { const row = json.textures?.[texture]; return row?.source ?? row?.extensions?.KHR_texture_basisu?.source ?? row?.extensions?.EXT_texture_webp?.source; };
  const note = (info: unknown, role: TextureRole): void => {
    if (!isMap(info) || typeof info['index'] !== 'number') return;
    const source = sourceOf(info['index']); if (source === undefined) return;
    const held = out.get(source); if (held === undefined || rank[role] > rank[held]) out.set(source, role);
  };
  for (const material of json.materials ?? []) {
    const pbr = isMap(material.pbrMetallicRoughness) ? material.pbrMetallicRoughness : {};
    note(pbr['baseColorTexture'], 'srgb'); note(material.emissiveTexture, 'srgb'); note(material.normalTexture, 'normal');
    note(pbr['metallicRoughnessTexture'], 'linear'); note(material.occlusionTexture, 'linear');
    for (const extension of Object.values(material.extensions ?? {})) if (isMap(extension)) for (const [key, value] of Object.entries(extension)) {
      note(value, /normal/iu.test(key) ? 'normal' : /color|sheen|specularColor/iu.test(key) ? 'srgb' : 'linear');
    }
  }
  return out;
}

// SF19: a WebP is encoded too (the encoder reads it from a PNG of its pixels: `decodeWebp`)
const mimeOf = (bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | undefined => { const kind = imageHead(bytes)?.kind; return kind === 'png' ? 'image/png' : kind === 'jpg' ? 'image/jpeg' : kind === 'webp' ? 'image/webp' : undefined; };

/** The GLB with each embedded PNG or JPEG image swapped for its KTX2 (`KHR_texture_basisu`), or undefined when none is
 *  encoded. Buffer 0 is rebuilt in its own order with every range (each buffer view, each meshopt stream) on a 16-byte step,
 *  so no alignment changes and every other byte is the GLB's own; a GLB whose ranges partly overlap is left as it is. */
export function ktx2Glb(bytes: Uint8Array, encode: ImageKtx2Encode): Uint8Array | undefined {
  const glb = readGlb(bytes);
  if (glb === undefined) return undefined;
  const {json, bin} = glb, views = json.bufferViews ?? [], roles = glbImageRoles(json);
  const swaps = new Map<number, Uint8Array>(), encoded = new Set<number>();
  for (const [index, image] of (json.images ?? []).entries()) {
    const view = image.bufferView === undefined ? undefined : views[image.bufferView];
    if (view === undefined || view.buffer !== 0 || image.bufferView === undefined || swaps.has(image.bufferView)) continue;
    const at = view.byteOffset ?? 0, source = bin.subarray(at, at + view.byteLength);
    if (mimeOf(source) === undefined) continue;
    const out = encode(source, {role: roles.get(index) ?? 'srgb', flip: false});
    if (out === undefined) continue;
    swaps.set(image.bufferView, out); encoded.add(index);
  }
  if (swaps.size === 0) return undefined;
  // An image view shared with an accessor would tear: leave such a GLB alone.
  if ((json.accessors ?? []).some(accessor => accessor.bufferView !== undefined && swaps.has(accessor.bufferView))) return undefined;
  interface Range {readonly at: number; readonly end: number; readonly set: (offset: number, length: number) => void; readonly swap?: Uint8Array}
  const ranges: Range[] = [];
  for (const [index, view] of views.entries()) {
    if (view.buffer === 0) {
      const swap = swaps.get(index);
      ranges.push({at: view.byteOffset ?? 0, end: (view.byteOffset ?? 0) + view.byteLength, set: (offset, length) => { view.byteOffset = offset; view.byteLength = length; }, ...(swap === undefined ? {} : {swap})});
    }
    const meshopt = view.extensions?.EXT_meshopt_compression;
    if (meshopt?.buffer === 0) ranges.push({at: meshopt.byteOffset ?? 0, end: (meshopt.byteOffset ?? 0) + meshopt.byteLength, set: offset => { meshopt.byteOffset = offset; }});
  }
  ranges.sort((left, right) => left.at - right.at || left.end - right.end);
  for (const [at, range] of ranges.entries()) {
    const before = ranges[at - 1];
    if (before !== undefined && range.at < before.end && (range.at !== before.at || range.end !== before.end || range.swap !== undefined || before.swap !== undefined)) return undefined;
  }
  const parts: Uint8Array[] = [];
  let length = 0, last: {at: number; end: number; offset: number} | undefined;
  for (const range of ranges) {
    // The same range named twice (two views over one stream) stays one copy.
    if (last !== undefined && last.at === range.at && last.end === range.end && range.swap === undefined) { range.set(last.offset, range.end - range.at); continue; }
    const body = range.swap ?? bin.subarray(range.at, range.end), offset = Math.ceil(length / 16) * 16;
    if (offset > length) parts.push(new Uint8Array(offset - length));
    parts.push(body); length = offset + body.length;
    range.set(offset, body.length);
    last = {at: range.at, end: range.end, offset};
  }
  const out = new Uint8Array(Math.ceil(length / 4) * 4);
  let write = 0;
  for (const part of parts) { out.set(part, write); write += part.length; }
  const buffer = json.buffers?.[0];
  if (buffer !== undefined) buffer.byteLength = out.length;
  for (const index of encoded) { const image = json.images?.[index]; if (image !== undefined) image.mimeType = 'image/ktx2'; }
  for (const texture of json.textures ?? []) {
    const source = texture.source ?? texture.extensions?.EXT_texture_webp?.source;
    if (source === undefined || !encoded.has(source)) continue;
    const {EXT_texture_webp: _webp, ...rest} = texture.extensions ?? {};
    texture.extensions = {...rest, KHR_texture_basisu: {source}};
    delete texture.source;
  }
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) json[key] = [...new Set([...json[key] ?? [], 'KHR_texture_basisu'])];
  return writeGlb(json, out);
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
    if (ext === 'glb') {
      const cooked = ktx2Glb(mount.read(), encode);
      if (cooked === undefined) continue;
      const target = file(url, stem, cooked, 'glb');
      desktopRow(url, url, target);
      // A `.phone` GLB holds a lighter mesh, so it is its own source; a GLB with none is the phone's too.
      if (phoneServed(url) === url) phoneRow(url, url, target);
      continue;
    }
    if (!/^(?:jpe?g|png|webp)$/u.test(ext)) continue;
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

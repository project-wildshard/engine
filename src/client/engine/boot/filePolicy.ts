import { GPU_FILES as ENGINE_GPU_FILES } from './ktx2.generated';
import { publicBytes } from '../../../shared/engine/boot/tables';
import type { Tier } from '../core/tier';
import type { Ktx2Table, TexMode } from './gpuFiles';
import type { BootSpec } from '../../../shared/engine/level/spec';
import type { ChunkFiles } from './bytes';

interface FilePolicy { phone: (url: string) => string; gpu: (url: string) => string; layer: (url: string) => string; pbr: (id: string) => string[] }
/** Pure asset-name resolution for node-safe manifest file lists. */
export function filePolicy(tier: Tier, mode: TexMode, table: Ktx2Table, inventory: Readonly<Record<string, number | true>> = publicBytes()): FilePolicy {
  const files = { ...ENGINE_GPU_FILES[tier], ...table[tier] };
  const phone = (url: string): string => {
    if (tier !== 'phone') return url;
    const match = /^(.*)\.(png|jpg|webp|glb)$/.exec(url);
    if (match === null) return url;
    const candidate = `${match[1]}.phone.${match[2] === 'glb' ? 'glb' : 'webp'}`;
    return candidate in inventory ? candidate : url;
  };
  const gpu = (url: string): string => { const mapped = phone(url); return mode === 'ktx2' ? files[mapped] ?? mapped : mapped; };
  const layer = (url: string): string => { const mapped = phone(url); return mode === 'ktx2' ? files[`${mapped}#layer`] ?? mapped : mapped; };
  const pbr = (id: string): string[] => ['diffuse', 'nor_gl', 'arm'].map((kind) => {
    const base = `/assets/tex/${id}/${kind}`;
    return tier === 'phone' && `${base}_1k.jpg` in inventory ? `${base}_1k.jpg` : `${base}.jpg`;
  });
  return { phone, gpu, layer, pbr };
}

/** Resolve authored rows in their original order; frozen callable inventories retain their exact arguments. */
export function bootSourceFiles(sources: NonNullable<BootSpec['sources']>, tier: Tier, tex: TexMode): ChunkFiles {
  if (typeof sources === 'function') return sources(tier, tex);
  if ('modes' in sources) return sources.modes[tier][tex];
  const policy = filePolicy(tier, tex, sources.gpuFiles ?? { phone: {}, desktop: {} });
  const resolve = (rows: readonly (string | { readonly gpu: string })[]): readonly string[] => rows.map(row => typeof row === 'string' ? row : policy.gpu(row.gpu));
  const rows = sources.tiers[tier];
  return { sky: resolve(rows.sky), baked: resolve(rows.baked), terrain: resolve(rows.terrain), trees: resolve(rows.trees),
    physics: resolve(rows.physics), cabins: resolve(rows.cabins), props: resolve(rows.props), art: resolve(rows.art), music: resolve(rows.music), sfx: resolve(rows.sfx) };
}

/** Resolve a declared ordered file list, including inventories intentionally pinned to one source tier. */
export function bootFileList(files: BootSpec['files'], tier: Tier): readonly string[] {
  if (typeof files === 'function') return files(tier);
  if ('modes' in files) return files.modes[tier].img;
  if ('sources' in files) return Object.values(bootSourceFiles(files.sources, files.tier, files.tex)).flat();
  return files;
}

/** Resolve late reads without running author-specific callbacks for row declarations. */
export function bootLateReads(reads: BootSpec['lateReads'], tier: Tier, tex?: TexMode): readonly string[] {
  if (typeof reads === 'function') return reads(tier, tex);
  return reads !== undefined && 'modes' in reads ? reads.modes[tier][tex ?? 'img'] : reads ?? [];
}

/** Ordered boot file recipes. Only bounded inventory selection and asset-name transforms are supported. */
export interface BootFileRecipe {
  readonly source: { readonly urls: readonly string[] | Readonly<Record<Tier, readonly string[]>> }
    | { readonly concat: readonly string[] } | { readonly publicPrefix: string }
    | { readonly pbr: readonly string[] } | { readonly gltf: readonly string[] }
    | { readonly tablePrefix: string } | { readonly pages: string }
    | { readonly available: readonly string[]; readonly fallback: readonly string[] };
  readonly map?: readonly ('gpu' | 'layer')[];
  readonly present?: boolean;
  readonly unique?: boolean;
  readonly excludeParts?: readonly string[];
  readonly excludeBasenamePrefix?: string;
  readonly except?: string;
  readonly aliases?: string;
}
/** External immutable inventories and aliases, supplied by the same build/runtime owner as the GPU table. */
export interface BootFileInputs {
  /** Offline presence facts: retained file sizes or guaranteed declared build outputs. */
  readonly inventory?: Readonly<Record<string, number | true>>;
  readonly pages?: Readonly<Record<string, Readonly<Record<Tier, Readonly<Record<string, { readonly image: string }>>>>>>;
  readonly aliases?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
export type BootFileRecipes = Readonly<Record<string, BootFileRecipe>>;
const isUrlList = (value: readonly string[] | Readonly<Record<Tier, readonly string[]>>): value is readonly string[] => Array.isArray(value);
/** Resolve a named recipe without fetching. Keep original order/duplicates unless unique is declared. */
export function resolveBootFiles(recipes: BootFileRecipes, name: string, tier: Tier, tex: TexMode,
  table: Ktx2Table, inputs: BootFileInputs = {}): string[] {
  const inventory = inputs.inventory ?? publicBytes(), policy = filePolicy(tier, tex, table, inventory);
  let visits = 0;
  const run = (id: string, chain: readonly string[]): string[] => {
    if (chain.includes(id) || chain.length >= 16 || ++visits > 256) throw new Error('Boot recipe cycle or bound exceeded');
    const row = recipes[id];
    if (row === undefined) throw new Error(`Missing boot recipe ${id}`);
    const src = row.source, next = [...chain, id];
    let urls: string[];
    if ('urls' in src) urls = [...(isUrlList(src.urls) ? src.urls : src.urls[tier])];
    else if ('concat' in src) urls = src.concat.flatMap(ref => run(ref, next));
    else if ('publicPrefix' in src) urls = Object.keys(inventory).filter(url => url.startsWith(src.publicPrefix));
    else if ('pbr' in src) urls = src.pbr.flatMap(policy.pbr);
    else if ('gltf' in src) urls = src.gltf.flatMap(assetId => [`/assets/models/${assetId}/${assetId}.gltf`, `/assets/models/${assetId}/${assetId}.bin`, ...['diff', 'nor_gl', 'arm'].map(kind => `/assets/models/${assetId}/textures/${assetId}_${kind}_1k.jpg`)]);
    else if ('tablePrefix' in src) urls = tex === 'ktx2' ? Object.keys(table[tier]).filter(url => url.startsWith(src.tablePrefix)).sort().flatMap(url => table[tier][url] ?? []) : [];
    else if ('pages' in src) {
      const pages = inputs.pages?.[src.pages]?.[tier];
      if (pages === undefined) throw new Error(`Missing boot pages ${src.pages}`);
      urls = Object.keys(pages).sort().map(key => {
        const page = pages[key], mapped = table[tier][key];
        if (tex === 'ktx2' && mapped === undefined) throw new Error(`Missing boot page stand-in ${key}`);
        if (page === undefined) throw new Error(`Missing boot page ${key}`);
        return tex === 'ktx2' ? mapped ?? page.image : page.image;
      });
    } else urls = src.available.every(url => url in inventory) ? [...src.available] : [...src.fallback];
    if (row.excludeParts !== undefined) urls = urls.filter(url => !row.excludeParts?.some(part => url.includes(part)));
    if (row.excludeBasenamePrefix !== undefined) urls = urls.filter(url => !url.slice(url.lastIndexOf('/') + 1).startsWith(row.excludeBasenamePrefix ?? ''));
    if (row.unique === true) urls = [...new Set(urls)];
    for (const transform of row.map ?? []) urls = urls.map(policy[transform]);
    if (row.present === true) urls = urls.filter(url => url in inventory);
    if (row.except !== undefined) { const excluded = new Set(run(row.except, next)); urls = urls.filter(url => !excluded.has(url)); }
    if (row.aliases !== undefined) {
      const aliases = inputs.aliases?.[row.aliases];
      if (aliases === undefined) throw new Error(`Missing boot aliases ${row.aliases}`);
      urls = urls.map(url => aliases[url] ?? url);
    }
    if (urls.length > 4096) throw new Error('Boot recipe file bound exceeded');
    return urls;
  };
  return run(name, []);
}
/** Resolve every byte category through the same ordered recipe interpreter. */
export function resolveBootSources(recipes: BootFileRecipes, sources: Readonly<Record<keyof ChunkFiles, string>>,
  tier: Tier, tex: TexMode, table: Ktx2Table, inputs: BootFileInputs = {}): ChunkFiles {
  const files = (key: keyof ChunkFiles): readonly string[] => resolveBootFiles(recipes, sources[key], tier, tex, table, inputs);
  return { sky: files('sky'), baked: files('baked'), terrain: files('terrain'), trees: files('trees'), physics: files('physics'),
    cabins: files('cabins'), props: files('props'), art: files('art'), music: files('music'), sfx: files('sfx') };
}

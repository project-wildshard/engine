/// <reference types="node" />
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as v from 'valibot';
import { readOutputDownloadIndex } from '@wildshard/format/outputDownload';
import { PickupCatalogueSchema } from '@wildshard/format/specimenCatalogue';

type Files = readonly (readonly [string, number])[];
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Missing boot source object');
  return v.parse(v.record(v.string(), v.unknown()), value);
};
const field = (record: Record<string, unknown>, key: string): unknown => record[key];
const array = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > 8192) throw new Error('Invalid boot source list');
  return value;
};
const text = (value: unknown): string => { if (typeof value !== 'string') throw new Error('Invalid boot source URL'); return value; };

/** The exact eagerly preloaded members of the existing model and bake readers.
 * Unselected mapping entries, specimen metadata and native callbacks add no files. */
export function sceneSourceUrls(kind: 'models' | 'baked', input: unknown): readonly string[] {
  const source = object(input), rows = object(field(source, 'rows')), urls: string[] = [];
  if (kind === 'models') {
    for (const [names, mapping] of [['meshes', 'meshUrls'], ['hd', 'hdUrls']] as const) {
      const values = object(rows[mapping]);
      for (const name of array(rows[names])) urls.push(text(values[text(name)]));
    }
    for (const row of array(field(rows, 'geometryPools') ?? [])) urls.push(text(field(object(row), 'url')));
    for (const row of array(field(rows, 'paintedModels') ?? [])) urls.push(text(field(object(row), 'url')));
    if (field(rows, 'rigs') !== undefined) {
      const bodies = object(field(object(field(rows, 'rigs')), 'bodies')), values = object(field(bodies, 'urls'));
      for (const name of array(field(bodies, 'creatures'))) urls.push(text(values[text(name)]));
    }
  } else {
    const values = object(field(source, 'urls'));
    for (const name of Object.keys(rows)) urls.push(text(values[name]));
    for (const row of array(field(source, 'resources') ?? [])) urls.push(text(field(object(row), 'url')));
  }
  return [...new Set(urls)];
}

/** Match eager model-library reads, including native pools. Empty libraries
 * and manually requested rigs do not need the parser at world intake. */
export function sceneSourceUsesGltf(input: unknown): boolean {
  const rows = object(field(object(input), 'rows'));
  if (array(field(rows, 'meshes')).length > 0 || array(field(rows, 'hd')).length > 0 || array(field(rows, 'paintedModels') ?? []).length > 0) return true;
  for (const value of array(field(rows, 'geometryPools') ?? [])) {
    const pool = object(value);
    if (array(field(pool, 'parts')).length > 0 || array(field(pool, 'atlases') ?? []).length > 0) return true;
  }
  const rigs = field(rows, 'rigs');
  if (rigs === undefined || field(rows, 'rigLoad') === 'manual') return false;
  return array(field(object(field(object(rigs), 'bodies')), 'creatures')).length > 0;
}

/** Shipped, data-only page inventory. The full bank is a per-home asset, never
 * all shards' file lists in the document. Original runtime admission is unchanged. */
export function homeExtraFiles(root: string, directory: string): Files | null {
  const product = resolve(root, 'out', directory), indexPath = resolve(product, 'shard.json');
  const index = readOutputDownloadIndex(JSON.parse(readFileSync(indexPath, 'utf8')));
  if (index.runtime !== null) return null;
  const section = (name: string): unknown => {
    const sectionRow = index.sections.find(candidate => candidate.name === name);
    if (sectionRow === undefined) return undefined;
    const bytes = readFileSync(resolve(product, sectionRow.path));
    if (bytes.length !== sectionRow.bytes || createHash('sha256').update(bytes).digest('hex') !== sectionRow.hash) throw new Error('Boot section differs from its index');
    return JSON.parse(bytes.toString('utf8'));
  };
  const host = section('quests/host');
  if (host === undefined) return null;
  const quest = field(object(host), 'questHost');
  if (quest === undefined || quest === null || field(object(quest), 'page') === undefined) return null;
  // C3: the packed level manifest, so its images are named where the product serves them.
  const level = section('ui/level');
  if (level === undefined) return null;
  const manifest = object(field(object(level), 'manifest')), urls: string[] = [];
  // Entry prepares these shared sources on every playable boot, before control.
  // Inline legacy geometry has no separate body; shared file URLs count once.
  const pickups = resolve(root, 'src/client/game/data/pickupCatalogue.json');
  if (existsSync(pickups)) {
    const rows = v.parse(PickupCatalogueSchema, JSON.parse(readFileSync(pickups, 'utf8')));
    const banked = new Set(rows.banks?.flatMap(bank => bank.members.map(member => member.file)));
    for (const bank of rows.banks ?? []) urls.push(bank.file);
    for (const row of rows.geometries) if ('file' in row && !banked.has(row.file)) urls.push(row.file);
  }
  for (const url of Object.values(object(field(manifest, 'card')))) urls.push(text(url));
  // The live boot omits Explorer previews. Reserving their bytes here would
  // leave a pending bank for images requested only after the player opens it.
  const boot = object(field(manifest, 'boot') ?? {});
  for (const url of array(field(boot, 'precache') ?? [])) urls.push(text(url));
  const painted = section('look/painted');
  if (painted !== undefined) {
    const sky = object(field(object(field(object(painted), 'look')), 'sky'));
    if (field(sky, 'kind') === 'strips') {
      for (const strip of array(field(object(field(sky, 'row')), 'strips'))) urls.push(text(field(object(strip), 'url')));
    }
  }
  const scenes = section('world/scenes');
  if (scenes !== undefined) for (const value of array(field(object(scenes), 'libraries'))) {
    const row = object(value);
    const kind = field(row, 'kind');
    if (kind !== 'models' && kind !== 'baked') continue;
    const file = index.files.find(candidate => candidate.name === field(row, 'file'));
    if (file === undefined) throw new Error('Missing boot model source');
    const bytes = readFileSync(resolve(product, file.path));
    if (bytes.length !== file.compressed || createHash('sha256').update(bytes).digest('hex') !== file.hash) throw new Error('Boot model source differs from its index');
    // Product-owned names already count in the product download bank. The
    // runtime resolves them through ShardProduct.url, never the public tree.
    const owned = new Set(index.files.flatMap(candidate => candidate.name === undefined ? [] : [candidate.name]));
    urls.push(...sceneSourceUrls(kind, JSON.parse(bytes.toString('utf8'))).filter(url => !owned.has(url)));
  }
  // Every playable page instantiates this same binary; it is outside the product.
  urls.push('/assets/physics/rapier.wasm');
  const files = new Map<string, number>();
  for (const input of urls) {
    if (input.startsWith('data:')) continue;
    // A shard's own images count in its product's download bank, like the names above.
    if (input.startsWith(`/shardfiles/${directory}/`)) continue;
    if (!/^\/assets\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/u.test(input) || input.split('/').some(part => part === '.' || part === '..')) throw new Error('Unsafe boot source URL');
    // P3: an asset that left with its shard is in the product's mounts, at the same URL.
    const shared = resolve(root, 'public', input.slice(1));
    files.set(input, statSync(existsSync(shared) ? shared : resolve(product, 'mounts', input.slice(1))).size);
  }
  return [...files].sort(([left], [right]) => left.localeCompare(right));
}

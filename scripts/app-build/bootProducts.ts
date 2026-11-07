/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { createHash } from 'node:crypto';
import { parseClientPlan, clientPlanModuleGroups } from '@wildshard/format/clientPlan';
import { SKIN_LOOK_RECIPE } from '@wildshard/format/skins';
import { readOutputDownloadIndex } from '@wildshard/format/outputDownload';
import { sceneSourceUsesGltf } from './bootExtras';

/** Compact compiler facts, not a second product admission or a file inventory.
 * Sections and blobs still pass their original size/hash/schema checks at runtime. */
export function productDownloadTotal(input: unknown, indexBytes: number): readonly [number, number] {
  const index = readOutputDownloadIndex(input);
  const total = [...index.sections, ...index.schemas].reduce((sum, row) => sum + row.bytes, indexBytes)
    + index.files.reduce((sum, row) => sum + row.compressed, 0);
  if (!Number.isSafeInteger(indexBytes) || indexBytes < 0 || !Number.isSafeInteger(total)) throw new Error('Invalid product download total');
  return [indexBytes, total];
}

/** Only two sizes per shipped home ride the shell; full per-file rows stay in
 * that home's descriptor. Missing output roots in isolated web fixtures are empty. */
export function bootProductTotals(root: string): Readonly<Record<string, readonly [number, number]>> {
  const output = resolve(root, 'out'), rows: Record<string, readonly [number, number]> = {};
  if (!existsSync(output)) return rows;
  for (const entry of readdirSync(output, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = resolve(output, entry.name, 'shard.json');
    if (!existsSync(file)) continue;
    if (!/^[a-zA-Z0-9_-]+$/u.test(entry.name)) throw new Error('Invalid product download directory');
    const bytes = readFileSync(file), input: unknown = JSON.parse(bytes.toString('utf8'));
    rows[`/shardfiles/${entry.name}/`] = productDownloadTotal(input, bytes.byteLength);
  }
  return rows;
}

/** Compact code selection from measured output metadata, without copying products. */
export function homeClientModuleGroups(root: string, directory: string): readonly string[] {
  const product = resolve(root, 'out', directory);
  const index = readOutputDownloadIndex(JSON.parse(readFileSync(resolve(product, 'shard.json'), 'utf8')));
  const section = (name: string): unknown => {
    const row = index.sections.find(candidate => candidate.name === name);
    if (row === undefined) return undefined;
    const bytes = readFileSync(resolve(product, row.path));
    if (bytes.length !== row.bytes || createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error('Boot code section differs from its index');
    return JSON.parse(bytes.toString('utf8'));
  };
  const plan = section('client/plan'), groups = plan === undefined ? [] : clientPlanModuleGroups(parseClientPlan(plan));
  // Match runtime I2 selection: catalogue presence alone must not preload Explorer before world control.
  const looks = section('look/materials'), items = section('combat/items');
  const lookRows = looks === undefined ? [] : v.parse(v.object({rows:v.object({looks:v.array(v.object({recipe:v.string()}))})}), looks).rows.looks;
  const itemRows = items === undefined ? [] : v.parse(v.object({items:v.object({rows:v.array(v.object({view:v.object({asset:v.exactOptional(v.unknown())})}))})}), items).items.rows;
  if (lookRows.some(row => row.recipe === SKIN_LOOK_RECIPE) || itemRows.some(row => row.view.asset !== undefined)) groups.push('models.gltf');
  const scenes = section('world/scenes');
  if (scenes !== undefined) {
    const libraries = v.parse(v.object({ libraries: v.array(v.object({ kind: v.string(), file: v.exactOptional(v.string()) })) }), scenes).libraries;
    for (const library of libraries) {
      if (library.kind !== 'models') continue;
      const file = library.file === undefined ? undefined : index.files.find(row => row.name === library.file);
      if (file === undefined) throw new Error('Missing boot model source');
      const bytes = readFileSync(resolve(product, file.path));
      if (bytes.length !== file.compressed || createHash('sha256').update(bytes).digest('hex') !== file.hash) throw new Error('Boot model source differs from its index');
      if (sceneSourceUsesGltf(JSON.parse(bytes.toString('utf8')))) groups.push('models.gltf');
    }
  }
  return [...new Set(groups)];
}

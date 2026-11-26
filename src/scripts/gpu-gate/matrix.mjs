#!/usr/bin/env node
// E357 F3.2: inspect the target commit, never the builders' shared working tree.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Probe measurements decide this set; record and bootstrap jobs are never split. */
export const SPLIT = new Set();
/** @typedef {{ shard: string, mode: string, part: string }} Job */
/** @typedef {{ id: string, kind: string, shards: string[] | 'all' }} Plant */

/** @param {string} sha @param {string} mode @param {{ cwd?: string, split?: Set<string>, recordShards?: readonly string[] }} [options] @returns {Job[]} */
export function matrix(sha, mode, options = {}) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('matrix: sha must be a full 40-hex commit');
  if (!['compare', 'record', 'prove'].includes(mode)) throw new Error('matrix: mode must be compare, record or prove');
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: options.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  /** @param {string} path */
  const exists = (path) => { try { git(['cat-file', '-e', `${sha}:${path}`]); return true; } catch { return false; } };
  const files = git(['ls-tree', '-r', '--name-only', sha, '--', 'src/shards']).trim().split('\n');
  let shards = files.flatMap((file) => /^src\/shards\/([^/]+)\/manifest\.ts$/.exec(file)?.slice(1) ?? []);
  shards = [...new Set(shards)].sort();
  if (shards.length === 0) throw new Error('matrix: target SHA has no shards');
  if (options.recordShards !== undefined) {
    if (mode !== 'record') throw new Error('matrix: shard selection is record-only');
    const selected = options.recordShards;
    if (selected.length === 0 || new Set(selected).size !== selected.length || selected.some(shard => !shards.includes(shard)))
      throw new Error('matrix: record shards must be unique target manifests');
    shards = shards.filter(shard => selected.includes(shard));
  }
  /** @type {Plant[]} */
  const plants = mode === 'prove' ? JSON.parse(git(['show', `${sha}:test/parity/plants/index.json`])) : [];
  if (!Array.isArray(plants)) throw new Error('matrix: plant index must be an array');
  return shards.flatMap((shard) => {
    if (mode === 'prove') return [{ shard, mode, part: 'green' }].concat(plants.filter((plant) =>
      ['patch', 'flag'].includes(plant.kind) && (plant.shards === 'all' || plant.shards.includes(shard)))
      .map((plant) => ({ shard, mode, part: plant.id })));
    if (mode === 'record') return [{ shard, mode, part: '' }];
    if (!exists(`test/parity/baselines/gh-macos15/${shard}.phone.json`)) return [{ shard, mode: 'bootstrap', part: '' }];
    return (options.split ?? SPLIT).has(shard)
      ? ['fingerprint+poses', 'walk+combat+leak'].map((part) => ({ shard, mode, part }))
      : [{ shard, mode, part: '' }];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(matrix(process.argv[2] ?? '', process.argv[3] ?? 'compare', process.argv[4] ? {recordShards: process.argv[4].split(',')} : {}))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}

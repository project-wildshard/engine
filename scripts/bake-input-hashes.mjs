#!/usr/bin/env node
// SF74 W22 (speed audit #9b): a committed bake that records the sha256 of every input it read (the King collision bake:
// its rig GLB, physics.baked.json, the pose modules …) goes stale on any edit to one of them, even when the bake's
// output is byte-identical. Push CI then fails its "exact input hashes" test on Linux (king-collision, 11 reds on
// 2026-10-09; the 21:25Z run was a stale physics.baked.json hash). The serialized pusher re-records those hashes the way
// it re-records witness manifests: on the clean export it re-runs the real bake, and only when everything but `inputs`
// is identical does the regeneration commit carry the new hashes. Any other byte is a behaviour change: the push fails,
// naming the bake, and its owner rebakes on purpose with the source.
//
//   node --import ./scripts/bake-loader.mjs scripts/bake-input-hashes.mjs --refresh <export> <result.json>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {bakeInputHashes} from './input-hash-memo.mjs';

export {InputHashMemo,bakeInputHashes} from './input-hash-memo.mjs';

/** Committed bakes with recorded input hashes: the output file, the script that bakes it and its exported bake function. */
// Empty since G350: the King collision table, the last one, generates from authored rows without `inputs`.
export const RECORDED_BAKES = /** @type {{ file: string, script: string, bake: string }[]} */ ([]);
/** @param {string} file */
export const isRecordedBake = (file) => RECORDED_BAKES.some((row) => row.file === file);
/** A recorded bake's text with its `inputs` blanked: every byte a re-record must reproduce. @param {string} text */
export function bakeOutcome(text) {
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || !('inputs' in parsed)) throw new Error('Recorded bake has no "inputs"');
  return JSON.stringify({ ...parsed, inputs: {} });
}
/** @param {string} root @param {string} path */
const sha256 = (root, path) => existsSync(resolve(root, path)) ? bakeInputHashes(root, [path])[path] ?? null : null;

/** Re-record every recorded bake whose inputs changed in `root`. Returns { file: text } for each one re-recorded. @param {string} root */
export async function refreshBakeInputs(root) {
  /** @type {Record<string, string>} */
  const outputs = {};
  const refused = [];
  for (const row of RECORDED_BAKES) {
    const file = resolve(root, row.file);
    if (!existsSync(file) || !existsSync(resolve(root, row.script))) continue;
    const text = readFileSync(file, 'utf8'), recorded = JSON.parse(text).inputs ?? {};
    if (Object.entries(recorded).every(([path, hash]) => sha256(root, path) === hash)) continue;
    const module = await import(pathToFileURL(resolve(root, row.script)).href);
    const next = `${JSON.stringify(module[row.bake](root))}\n`;
    if (bakeOutcome(next) !== bakeOutcome(text)) { refused.push(`${row.file}: the bake on clean HEAD changed more than its input hashes; a behaviour change needs its owner to rebake on purpose (node --import ./scripts/bake-loader.mjs ${row.script}), committed with the source`); continue; }
    if (next !== text) outputs[row.file] = next;
  }
  if (refused.length > 0) throw new Error(`bake-input-hashes: the push refuses these bakes:\n  ${refused.join('\n  ')}`);
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag = '', root = '', result = ''] = process.argv.slice(2);
  if (flag !== '--refresh' || root === '' || result === '') { console.error('usage: bake-input-hashes.mjs --refresh <export> <result.json>'); process.exit(64); }
  try {
    const outputs = await refreshBakeInputs(resolve(root));
    writeFileSync(result, JSON.stringify(outputs));
    for (const file of Object.keys(outputs)) console.log(`bake-input-hashes: re-recorded ${file} (output byte-identical)`);
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

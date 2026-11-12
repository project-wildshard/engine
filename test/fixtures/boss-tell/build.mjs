// Rebuild the TE-ENG1 fixture bytes with sharddev's compiler (engine's suite has no AssemblyScript compiler, J42 lift):
//   node --experimental-strip-types test/fixtures/boss-tell/build.mjs <path to sharddev checkout>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname, sharddev = process.argv[2];
if (sharddev === undefined) throw new Error('usage: build.mjs <sharddev checkout>');
const { compileScript } = await import(join(sharddev, 'src/sharddev/bake/compileScript.ts'));
const template = readFileSync(join(here, 'decision.as.template'), 'utf8');
for (const [name, guard] of [['melee', 2], ['open', 0]]) writeFileSync(join(here, `decision-${name}.wasm`), await compileScript(template.replace(/GUARD/gu, String(guard)), { abi: 1 }));
const scene = 'export function abi_version():i32{return 0;}export function init(lo:i32,hi:i32):void{}export function in_ptr():i32{return 16384;}export function in_cap():i32{return 4096;}export function out_ptr():i32{return 24576;}export function out_cap():i32{return 4;}export function out_count():i32{return 0;}export function on_tick():void{}';
writeFileSync(join(here, 'scene.wasm'), await compileScript(scene, { maximumPages: 1 }));

// oxlint-disable-next-line import/no-nodejs-modules -- Own small source-only fixtures and remove them after each case.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real module graph with a legacy-import refusal hook.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only repository source and fixture files.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Form a native Node module URL, without a bundler mock.
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { generationPlan, hasProjectGenerator } from '../scripts/gen-programs.mjs';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): {root:string;put:(file:string,text:string)=>void} {
  mkdirSync('tmp', {recursive:true});
  const root = mkdtempSync(resolve('tmp/gen-programs-')); owned.push(root);
  const put = (file:string,text:string):void => { const path=resolve(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text); };
  put('src/shards/alpha/shard.config.ts', 'throw Error("discovery must not execute configs"); export async function generate() {}');
  put('src/shards/beta/shard.config.ts', 'export default {};');
  put('src/shards/plots/shard.config.ts', 'export default {};');
  put('src/shards/plots/outputs.json', JSON.stringify({outputs:[{slug:'plot-one'},{slug:'plot-two'}]}));
  return {root,put};
}

test('only a value-level named generate export selects the SDK program contract', () => {
  for (const source of ['export const generate = program;', 'export async function generate() {}', 'const f=()=>{};export {f as generate};']) expect(hasProjectGenerator(source)).toBe(true);
  for (const source of ['export default function generate() {}', 'export type {generate};', '// export const generate = program;\nexport default {};', 'const generate = program;export {generate as other};']) expect(hasProjectGenerator(source)).toBe(false);
  expect(() => hasProjectGenerator('export const = ;')).toThrow('does not parse');
});

test('scoped products resolve composed folders once without executing source', () => {
  const {root} = fixture();
  expect(generationPlan(root,'alpha')).toEqual({products:['alpha'],folders:['alpha'],scoped:true});
  expect(generationPlan(root,'plot-two,plot-one')).toEqual({products:['plot-two','plot-one'],folders:['plots'],scoped:true});
  expect(generationPlan(root).folders).toEqual(['alpha','beta','plots']);
  for (const requested of ['','alpha,alpha','../alpha','missing','plots']) expect(() => generationPlan(root,requested)).toThrow('unknown or duplicate');
});

test('converted preparation and builder imports never load the legacy scheduler', () => {
  const {root,put} = fixture();
  put('src/shards/alpha/data/map.json', '{}');
  const url = (file:string):string => pathToFileURL(resolve(file)).href;
  const script = `import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier.endsWith('/generate.mjs'))throw Error('legacy scheduler loaded');return next(specifier,context);}});
const {generationPlan}=await import(${JSON.stringify(url('scripts/gen-programs.mjs'))});
generationPlan(${JSON.stringify(root)},'alpha');
await import(${JSON.stringify(url('scripts/build-shardfiles.mjs'))});
console.log('converted graph excludes scheduler');`;
  expect(execFileSync('node',['--input-type=module','--eval',script],{encoding:'utf8',maxBuffer:1024*1024})).toContain('converted graph excludes scheduler');
});

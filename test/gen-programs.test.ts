// oxlint-disable-next-line import/no-nodejs-modules -- Own small source-only fixtures and remove them after each case.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only repository source and fixture files.
import { dirname, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { generationPlan, hasProjectGenerator } from '../src/scripts/gen-programs.mjs';

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

// oxlint-disable-next-line import/no-nodejs-modules -- Compare only owned miniature ruler fixtures.
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep every fixture below the repository scratch root.
import {resolve} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {shardLineBaselines} from '../scripts/decision-legacy-lines.mjs';
import {platformOutput} from './fixtures/platformOutputs';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
it('keeps all six ruler baselines and zero verdicts with no legacy registry',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/ruler-no-legacy-'));owned.push(root);
  mkdirSync(resolve(root,'lint'));
  writeFileSync(resolve(root,'lint/legacy-line-basis.json'),readFileSync('lint/legacy-line-basis.json'));
  const baselines=shardLineBaselines(root);
  expect(baselines.size).toBe(6);
  expect([...baselines.values()].reduce((sum,row)=>sum+row.lines,0)).toBe(98854);
  let index=0;
  for(const [slug] of baselines) {
    platformOutput(root,slug,index++===0?{'runtime/index.ts':'export const LIVE=1;'}:{});
    writeFileSync(resolve(root,`src/shards/${slug}/manifest.ts`),'export default {};');
  }
  // LD10: a product ships no runtime TypeScript, so the live authored line is measured on the source basis
  const before=sourceProgressInventory(root);
  expect(Object.keys(before).sort()).toEqual([...baselines.keys()].sort());
  expect(Object.values(before).filter(row=>row.conversion.passed)).toHaveLength(5);
  for(const [slug,baseline] of baselines)expect(before[slug]?.conversion).toMatchObject({
    legacyLines:baseline.lines,legacyRevision:baseline.source,metric:'runtime-vs-legacy'});
});

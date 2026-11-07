import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Small, disposable ruler fixture.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confined fixture paths.
import {dirname,join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- No repository copy.
import {tmpdir} from 'node:os';
import {shardLines,sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';
import {legacyLineBasis} from './fixtures/legacyLineBasis';

it('retains the sealed denominator and omits percentages for raw P0 escapes',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-output-frozen-'));
 const put=(file:string,source:string):void=>{const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);};
 try{
  platformOutput(root,'pine-hollow',{'runtime/index.ts':'export const LIVE=1;'});
  put('src/shards/pine-hollow/manifest.ts','export default {};');
  legacyLineBasis(root,'pine-hollow',{'manifest.ts':'export default {};','plugin.ts':'export const ONE=1;\nexport const TWO=2;'});
  // LD10: a product ships no runtime TypeScript; the authored runtime line is measured on the source basis
  expect(sourceProgressInventory(root)['pine-hollow']?.conversion).toMatchObject({customRuntimeLines:1,legacyLines:3,runtimeShare:1/3});
  expect(shardLines(root)['pine-hollow']?.conversion).toMatchObject({customRuntimeLines:0,legacyLines:3,runtimeShare:0});
  put('src/shards/pine-hollow/runtime/index.ts',"import rows from '../data/table'; export default rows;");
  expect(shardLines(root)['pine-hollow']).toBeUndefined();
 }finally{rmSync(root,{recursive:true,force:true});}
});

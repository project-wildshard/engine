import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated closure work-queue fixture.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confined fixture paths.
import {join,dirname} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Disposable fixture, not a repository export.
import {tmpdir} from 'node:os';
import {runtimeClosures} from '../scripts/shard-runtime-closure.mjs';
import {outputReport} from '../scripts/shard-output-report.mjs';
import {platformOutput} from './fixtures/platformOutputs';

it('reports per-shard raw escapes with no percentage or source fallback',async()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-closure-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/shards/pine-hollow/runtime/index.ts',"import rows from '../data/rows'; export const value=rows;");
  put('src/shards/pine-hollow/runtime/view.ts',"export const resource=new URL('../assets/body.glb',import.meta.url);");
  put('lint/ratchet.json',JSON.stringify({allow:{},budgets:{}}));
  const closure=runtimeClosures(root)['pine-hollow'];
  expect(closure?.status).toBe('unclosed');
  expect(closure?.escapes).toBe(2);
  expect(closure?.files).toHaveLength(2);
  await expect(outputReport(root,{build:false})).rejects.toThrow('section inventory missing');
  platformOutput(root,'pine-hollow');
  const report=await outputReport(root,{build:false});
  expect(report.rows['pine-hollow']).toMatchObject({status:'unclosed',escapes:2,customPercent:null,port:null});
  expect(report.measures['pine-hollow']).toBeUndefined();
  // The source program is never executed by closure analysis.
  put('src/shards/pine-hollow/runtime/index.ts','throw new Error("never evaluate");');
  put('src/shards/pine-hollow/runtime/view.ts','export const value=1;');
  expect(runtimeClosures(root)['pine-hollow']).toMatchObject({status:'closed',escapes:0,files:[]});
 }finally{rmSync(root,{recursive:true,force:true});}
});

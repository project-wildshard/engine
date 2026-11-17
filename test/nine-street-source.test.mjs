// oxlint-disable-next-line import/no-nodejs-modules -- An actual local Actions API tests source-run artifact selection.
import {createServer} from 'node:http';
import {expect,test} from 'vitest';
import {nineStreetSource} from '../scripts/nine-street-source.mjs';

const sha='a'.repeat(40),artifact={name:'nine-ring1-client',expired:false};
async function withApi(responses,check){
 const requests=[];
 const server=createServer((request,response)=>{
  const path=request.url;requests.push(path);
  response.setHeader('content-type','application/json');
  const data=responses[path];response.statusCode=data===undefined?503:200;
  response.end(JSON.stringify(data??{}));
 });
 await new Promise(resolve=>{server.listen(0,'127.0.0.1',resolve);});
 try{
  const address=server.address();
  if(address===null||typeof address==='string')throw new Error('Missing API port');
  await check({GITHUB_REPOSITORY:'o/r',SOURCE_SHA:sha,SOURCE_RUN:'10',GH_TOKEN:'fixture',GITHUB_API_URL:`http://127.0.0.1:${address.port}`},requests);
 }finally{await new Promise(resolve=>{server.close(resolve);});}
}
const artifacts=id=>`/repos/o/r/actions/runs/${id}/artifacts?per_page=100`;
const runs=`/repos/o/r/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&status=success&per_page=100`;

test('an actual source client takes priority over any older exact plan proof',async()=>{
 await withApi({[artifacts(10)]:{artifacts:[artifact]}},async(env,requests)=>{
  expect(await nineStreetSource(env)).toEqual({run:10,sha,artifact:true});
  expect(requests).toEqual([artifacts(10)]);
 });
});
test('a source without a client or exact proof skips the observation',async()=>{
 await withApi({[artifacts(10)]:{artifacts:[]},[runs]:{workflow_runs:[]}},async env=>{
  expect(await nineStreetSource(env)).toEqual({run:10,sha,artifact:false});
 });
});
test('a reused run gets only its exact fully green plan client',async()=>{
 const run={id:77,name:'ci',head_sha:sha,event:'push',status:'completed',conclusion:'success',head_branch:'plan/pins',
  head_repository:{full_name:'o/r'},run_started_at:new Date().toISOString()};
 const job={name:'tests (1)',status:'completed',conclusion:'success',steps:[{name:"Run this job's packed share",status:'completed',conclusion:'success'}]};
 await withApi({[artifacts(10)]:{artifacts:[]},[runs]:{workflow_runs:[run]},
  '/repos/o/r/actions/runs/77/jobs?filter=latest&per_page=100':{jobs:[job]},[artifacts(77)]:{artifacts:[artifact]}},async env=>{
  expect(await nineStreetSource(env)).toEqual({run:77,sha,artifact:true});
 });
});
test('an expired client and an unavailable API cannot supply an observation',async()=>{
 await withApi({[artifacts(10)]:{artifacts:[{...artifact,expired:true}]},[runs]:{workflow_runs:[]}},async env=>{
  expect(await nineStreetSource(env)).toEqual({run:10,sha,artifact:false});
 });
 await withApi({},async env=>{await expect(nineStreetSource(env)).rejects.toThrow('HTTP 503');});
});

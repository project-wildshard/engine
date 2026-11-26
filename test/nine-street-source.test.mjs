// oxlint-disable-next-line import/no-nodejs-modules -- An actual local Actions API tests source-run artifact selection.
import {createServer} from 'node:http';
import {expect,test} from 'vitest';
import {nineStreetSource} from '../src/scripts/nine-street-source.mjs';

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

test('the source run\'s own client is the observation',async()=>{
 await withApi({[artifacts(10)]:{artifacts:[artifact]}},async(env,requests)=>{
  expect(await nineStreetSource(env)).toEqual({run:10,sha,artifact:true});
  expect(requests).toEqual([artifacts(10)]);
 });
});
test('a source without a client skips the observation; no plan run is ever borrowed (FLOW-SIMPLE FS5)',async()=>{
 await withApi({[artifacts(10)]:{artifacts:[]}},async(env,requests)=>{
  expect(await nineStreetSource(env)).toEqual({run:10,sha,artifact:false});
  expect(requests).toEqual([artifacts(10)]);
 });
});
test('an expired client and an unavailable API cannot supply an observation',async()=>{
 await withApi({[artifacts(10)]:{artifacts:[{...artifact,expired:true}]}},async env=>{
  expect(await nineStreetSource(env)).toEqual({run:10,sha,artifact:false});
 });
 await withApi({},async env=>{await expect(nineStreetSource(env)).rejects.toThrow('HTTP 503');});
});

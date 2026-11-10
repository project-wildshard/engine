// Outside-hook real HTTP/CLI migration control; no browser or game events.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {KEYCHAIN_ARGS} from '../chromium-keychain.mjs';
import {requireSweepDocumentBuild} from './target.mjs';

const started=performance.now(),revision='a'.repeat(40);let mode='green',visits=0;
const server=createServer((request,response)=>{
  if(request.url==='/'){
    response.setHeader('Content-Type','text/html');response.end(`<!doctype html><script>globalThis.__WS_BUILD_ID__=${JSON.stringify(mode==='doc-change'?'aaaaaaa-next':'aaaaaaa-one')}</script>`);return;
  }
  response.setHeader('Content-Type','application/json');
  if(request.url==='/version.json'){
    visits++;response.end(JSON.stringify({build:(mode==='wrong-source'?'b'.repeat(7):revision.slice(0,7))+(mode==='changed'&&visits>1?'-next':'-one')}));return;
  }
  if(request.url==='/catalogue.json'){
    if(mode==='missing'){response.writeHead(404);response.end('{}');return;}
    response.end(JSON.stringify({shards:mode==='empty'?[]:mode==='duplicate'?[{slug:'first'},{slug:'first'}]:[{slug:'published-only'},{slug:'template'}],placements:[{slug:'_template'}],grid:{cells:[{slug:'grid-alias'}]}}));return;
  }
  response.writeHead(404);response.end('{}');
});
/** @type {Promise<void>} */
const listening=new Promise(resolve=>{server.listen(0,'127.0.0.1',()=>resolve());});
await listening;let browser;
try{
  const address=server.address();assert.ok(address!==null&&typeof address!=='string');
  /** @param {string} flow @returns {Promise<{code:number|null,signal:NodeJS.Signals|null,output:string}>} */
  const runGate=flow=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[new URL('../complete-at-control.mjs',import.meta.url).pathname,`--base=http://127.0.0.1:${address.port}`,`--rev=${revision}`,`--flow=${flow}`],{stdio:['ignore','pipe','pipe'],timeout:1500});
    let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,output}));
  });
  for(mode of ['green','missing','empty','duplicate','wrong-source','changed']){
    visits=0;
    /** @type {Promise<{code:number|null,signal:NodeJS.Signals|null,stdout:string,stderr:string}>} */
    const running=new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[new URL('target.mjs',import.meta.url).pathname,`http://127.0.0.1:${address.port}`,revision],{stdio:['ignore','pipe','pipe'],timeout:1500});
      let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
    });
    const result=await running;assert.equal(result.signal,null,'an unfinished metadata read is not a refusal proof');
    if(mode==='green'){assert.equal(result.code,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{build:'aaaaaaa-one',slugs:['published-only','template','_template','grid-alias']});}
    else{
      assert.notEqual(result.code,0,mode);
      visits=0;
      const actual=await runGate('published-only');assert.equal(actual.signal,null);assert.equal(actual.code,2,actual.output);assert.match(actual.output,/DL17 NO READING/u);
    }
  }
  mode='green';visits=0;
  const absent=await runGate('not-listed');assert.equal(absent.signal,null);assert.equal(absent.code,2,absent.output);assert.match(absent.output,/absent from the served sweep catalogue/u);
  browser=await chromium.launch({headless:true,args:[...KEYCHAIN_ARGS,'--mute-audio']});
  const page=await browser.newPage();page.setDefaultTimeout(1500);mode='green';await page.goto(`http://127.0.0.1:${address.port}/`);
  await requireSweepDocumentBuild(page,'aaaaaaa-one');mode='doc-change';await page.reload();
  await assert.rejects(()=>requireSweepDocumentBuild(page,'aaaaaaa-one'),/document build differs/u);
  assert.ok(performance.now()-started<10000);console.log(JSON.stringify({cases:6,actualRefusals:6,nativeDocumentChange:true,ms:Math.round(performance.now()-started),nativeHttp:true,noAuthorTree:true}));
}finally{try{await browser?.close();}finally{server.close();}}

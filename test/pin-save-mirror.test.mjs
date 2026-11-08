import {test,expect} from 'vitest';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {brotliCompressSync} from 'node:zlib';

const cli=resolve('scripts/pins.ts');
for(const mode of ['explicit','fallback','corrupt','missing'])test(`real save install preserves its identity through ${mode} mirror responses`,async()=>{
  mkdirSync(resolve('tmp'),{recursive:true});
  const root=mkdtempSync(resolve('tmp/pin-save-mirror-'));
  const body=brotliCompressSync(Buffer.from('{"realTransportFixture":true}'));
  const hash=createHash('sha256').update(body).digest('hex'),file=`${hash}.save.br`;
  /** @type {string[]} */ const requests=[];
  mkdirSync(join(root,'test/pins/saves'),{recursive:true});
  writeFileSync(join(root,'test/pins/saves/fixture.json'),JSON.stringify({slug:'fixture',file,sha256:hash,bytes:body.length,remote:true}));
  const server=createServer((request,response)=>{
    const url=request.url??'';requests.push(url);
    if(mode==='corrupt'){response.end('not the declared immutable bytes');return;}
    if(mode==='missing'||mode==='fallback'&&url.includes('?download=1')){response.writeHead(mode==='missing'?404:504);response.end();return;}
    response.end(body);
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(undefined)));
    const address=server.address();if(address===null||typeof address==='string')throw Error('Missing actual TCP listener');
    const child=spawn(process.execPath,[cli,'install-saves','fixture'],{cwd:root,env:{...process.env,WILDSHARD_PIN_CACHE:join(root,'cache'),WILDSHARD_PIN_MIRROR:`http://127.0.0.1:${address.port}`},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    /** @type {Promise<number|null>} */
    const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
    const result=await completed;
    if(mode==='explicit'||mode==='fallback'){
      expect(result,output).toBe(0);
      expect(readFileSync(join(root,'cache',file))).toEqual(body);
      expect(requests).toEqual(mode==='explicit'?[`/${file}?download=1`]:[`/${file}?download=1`,`/${file}`]);
    }else{
      expect(result,output).toBe(1);expect(existsSync(join(root,'cache',file))).toBe(false);
      expect(requests).toHaveLength(mode==='corrupt'?1:2);
      expect(output).toContain(mode==='corrupt'?'is not the pin':'mirror has no matching released save');
    }
  }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve(undefined)));rmSync(root,{recursive:true,force:true});}
},10_000);

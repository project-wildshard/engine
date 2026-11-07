// oxlint-disable-next-line import/no-nodejs-modules -- Run the real cheap rule in an owned fixture.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and retire bounded source fixtures.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only exact rule and fixture paths.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use this runtime for the local linter.
import {execPath} from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the defining rule beside this test.
import {fileURLToPath} from 'node:url';
import {expect,test} from 'vitest';
import {parseSync} from 'vite';
import {base64Sites} from '../lint/no-base64.mjs';

function sites(source:string):number{
  const parsed=parseSync('src/example.ts',source);expect(parsed.errors).toEqual([]);
  return base64Sites(parsed.program);
}

test('syntax-only detection covers ordinary, optional, computed, aliased and constant codecs',()=>{
  expect(sites(`atob('AA=='); globalThis['btoa']('x'); window.atob?.('AA==');
   Buffer.from('AA==','base64'); Buffer.from('AA==',\`base64url\`); data.toString('BASE64');
   const encoding='base64'; Buffer.from('AA==',encoding);
   import {Buffer as Bytes,atob as decode} from 'node:buffer';
   Bytes.from('AA==','base64'); decode('AA==');
   const Bin=Buffer;Bin.from('AA==','base64');const encode=btoa;encode('x');`)).toBe(11);
  expect(sites(`// atob('comment')
   const words="Buffer.from('text','base64')";
   new Uint8Array([1,2]);Buffer.from('beef','hex');data.toString('utf8');JSON.stringify({rows:[1,2]});`)).toBe(0);
});

test('destructuring and Buffer factory aliases retain the binary codec boundary',()=>{
  expect(sites(`import * as binary from 'node:buffer';
   const {atob:decode,btoa:encode}=globalThis;decode('AA==');encode('x');
   const {Buffer:Bytes,atob:decodeImported}=binary;Bytes.from('AA==','base64');decodeImported('AA==');
   const {from:make}=Bytes;make('AA==','base64');make('beef','hex');
   const copied=Bytes.from;copied('AA==','base64url');
   const alias=make;alias('AA==','BASE64');`)).toBe(7);
  expect(sites(`const dictionary={from:(value:string)=>value,atob:()=>1};
   const {from:pick,atob:local}=dictionary;pick('base64');local();
   import * as ordinary from './plain';const {Buffer:NotBytes}=ordinary;
   const {from:other}=NotBytes;other('AA==','base64');`)).toBe(0);
});

test('the real rule refuses new source/tool calls and permits only shrinking exact file debt',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/no-base64-'));
  const policy=resolve(root,'debt.json'),config=resolve(root,'lint.json'),plugin=resolve(root,'rule.mjs');
  const helper=fileURLToPath(new URL('../lint/no-base64.mjs',import.meta.url));
  writeFileSync(plugin,`import {noBase64Rule} from ${JSON.stringify(helper)};export default {meta:{name:'wildshard'},rules:{'no-base64':noBase64Rule(${JSON.stringify(policy)})}};`);
  const run=(file:string,source:string,count=false)=>{
    const target=resolve(root,file);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,source);
    writeFileSync(config,JSON.stringify({jsPlugins:[plugin],categories:{correctness:'off'},rules:{'wildshard/no-base64':['error',{count}]}}));
    return spawnSync(execPath,[resolve('node_modules/oxlint/bin/oxlint'),'-c',config,'--no-ignore',target],{encoding:'utf8'});
  };
  try{
    writeFileSync(policy,JSON.stringify({files:{'src/old.ts':1}}));
    expect(run('src/old.ts',"atob('AA==');").status).toBe(0);
    const growth=run('src/old.ts',"atob('AA==');btoa('x');");expect(growth.status,growth.stdout+growth.stderr).toBe(1);
    expect(run('src/new.ts',"atob('AA==');").status).toBe(1);
    expect(run('scripts/generators/new.mjs',"Buffer.from('AA==','base64');").status).toBe(1);
    expect(run('src/old.ts',"atob('AA==');",true).status).toBe(1);
    expect(run('test/fixture.ts',"atob('AA==');").status).toBe(0);
    expect(run('src/new.ts',"const codec='base64';Buffer.from('AA==',codec);").status).toBe(1);
    expect(run('src/new.ts',"const codec='hex';Buffer.from('AA==',codec);").status).toBe(0);
    expect(run('src/new.ts',"const {atob:decode}=globalThis;decode('AA==');").status).toBe(1);
    expect(run('scripts/generators/new.mjs',"const {from:make}=Buffer;make('AA==','base64');").status).toBe(1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

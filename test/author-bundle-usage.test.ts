// oxlint-disable-next-line import/no-nodejs-modules -- Bind event paths to the same actual compiler/cache root.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real opt-in compiler reporting in one owned child.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own all compiler source/cache and child files in repo scratch.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {AUTHOR_BUNDLE_USE_PREFIX,authorBundleUseLine} from '../scripts/author-bundle-usage.mjs';

const root=resolve('tmp/usage-source'),cache=resolve('tmp/usage-cache'),namespace='a'.repeat(64),key='b'.repeat(64);
const env={WS_AUTHOR_BUNDLE_USAGE:'fixture:1'};
const schema=v.strictObject({schema:v.literal('author-bundle-use/1'),root:v.string(),cacheRoot:v.string(),epoch:v.string(),
  namespace:v.string(),key:v.string(),purpose:v.picklist(['compiler','product','unknown']),product:v.nullable(v.string())});
function row(args:readonly string[]) {
  const line=authorBundleUseLine(root,cache,namespace,key,args,env);
  if(line===undefined)throw new Error('Missing event');return v.parse(schema,JSON.parse(line.slice(AUTHOR_BUNDLE_USE_PREFIX.length)));
}

test('default compiler use remains silent and invalid opt-in identities do not emit qualified marks',()=>{
  expect(authorBundleUseLine(root,cache,namespace,key,['--prepare-compiler'],{})).toBeUndefined();
  for(const epoch of ['', 'foreign\nrow', 'missing-attempt'])
    expect(authorBundleUseLine(root,cache,namespace,key,['--prepare-compiler'],{WS_AUTHOR_BUNDLE_USAGE:epoch})).toBeUndefined();
  expect(authorBundleUseLine(root,cache,'invalid',key,['--prepare-compiler'],env)).toBeUndefined();
});

test('compiler and reused-product validators report their actual referenced namespace and key',()=>{
  expect(row(['--prepare-compiler'])).toEqual({schema:'author-bundle-use/1',root,cacheRoot:cache,epoch:'fixture:1',namespace,key,purpose:'compiler',product:null});
  expect(row(['validate',resolve(root,'out/harbor')])).toMatchObject({purpose:'product',product:'harbor',namespace,key});
  expect(row(['build',resolve(root,'src/shards/project'),'out','--output=harbor'])).toMatchObject({purpose:'product',product:'harbor'});
});

test('unknown or malformed CLI purposes stay unqualified instead of disappearing',()=>{
  for(const args of [[],['prove',root],['--prepare-compiler','extra'],['validate'],['build',root,'out','--output=../escape']])
    expect(row(args)).toMatchObject({purpose:'unknown',product:null});
});

test('real compilation and cache reuse both emit a successful use while failure emits none',()=>{
  mkdirSync('tmp',{recursive:true});const directory=mkdtempSync(resolve('tmp/author-use-process-'));
  try {
    const child=resolve(directory,'child.mjs');
    writeFileSync(child,`import fs from 'node:fs';
import {authorBundleCached} from ${JSON.stringify(resolve('scripts/author-bundle-cache.mjs'))};
import {recordBundle} from ${JSON.stringify(resolve('scripts/shardfile-inputs.mjs'))};
const root=process.env.USAGE_SOURCE,cache=process.env.USAGE_CACHE;
fs.writeFileSync(root+'/compiler.mjs','export const value=1;');
const compile=async()=>{const code=fs.readFileSync(root+'/compiler.mjs','utf8');recordBundle({output:[]});return {code,modules:[]};};
const first=await authorBundleCached(root,['fixture'],compile,cache);
const second=await authorBundleCached(root,['fixture'],compile,cache);
if(first.reused||!second.reused||first.code!==second.code)throw Error('Compiler reuse changed');
try{await authorBundleCached(root,['refused'],async()=>{throw Error('Actual refusal');},cache);}catch(error){if(!(error instanceof Error)||error.message!=='Actual refusal')throw error;}
`);
    const result=spawnSync(process.execPath,[child,'--prepare-compiler'],{encoding:'utf8',timeout:5000,env:{...process.env,...env,
      USAGE_SOURCE:directory,USAGE_CACHE:resolve(directory,'cache')}});
    expect(result.status,result.stdout+result.stderr).toBe(0);
    const rows=result.stdout.trim().split('\n').filter(line=>line.startsWith(AUTHOR_BUNDLE_USE_PREFIX))
      .map(line=>v.parse(schema,JSON.parse(line.slice(AUTHOR_BUNDLE_USE_PREFIX.length))));
    expect(rows).toHaveLength(2);expect(rows[0]).toEqual(rows[1]);
    expect(rows.every(value=>value.purpose==='compiler'&&value.root===directory&&value.cacheRoot===resolve(directory,'cache'))).toBe(true);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

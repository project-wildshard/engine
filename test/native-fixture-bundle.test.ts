// oxlint-disable-next-line import/no-nodejs-modules -- Own isolated producer/source/cache fixtures.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only repository scratch.
import {resolve} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import * as v from 'valibot';
import {nalatiNativeProgramSpec} from './fixtures/nalati-native-program';
import {nalatiNativeAssemblySpec} from './fixtures/nalati-native-assembly';
import {nalatiNativeBootSpec} from './fixtures/nalati-native-boot';
import {nativeProgramFixture} from './fixtures/native-program';
import {pineNativeOracleSpec} from './fixtures/pine-native-oracle-spec';
import {nativeFixtureIdentity,packNativeFixtures,restoreNativeFixtures} from './fixtures/native-fixture-bundle';
import {encodeCanonicalJson,hashImmutableBytes} from '../src/shared/host/immutable';

const owned:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const path of owned.splice(0))rmSync(path,{recursive:true,force:true});});
async function fixture(){
  const root=mkdtempSync(resolve('tmp/native-bundle-'));owned.push(root);
  mkdirSync(resolve(root,'scripts'));mkdirSync(resolve(root,'source'));
  writeFileSync(resolve(root,'scripts/bake-loader.mjs'),'');writeFileSync(resolve(root,'source/input.txt'),'original');
  writeFileSync(resolve(root,'compile.mjs'),`import fs from 'node:fs';fs.appendFileSync('calls','x');process.stdout.write(JSON.stringify({value:fs.readFileSync('source/input.txt','utf8')}));`);
  const spec={root,id:'test',script:'compile.mjs',inputs:['source','scripts/bake-loader.mjs']};
  const cache=resolve(root,'producer'),text=await nativeProgramFixture({...spec,cacheDir:cache});
  const identity=nativeFixtureIdentity({sha:'a'.repeat(40),run:'123',attempt:'1'});
  return {root,spec,text,identity,wire:packNativeFixtures(identity,[spec],cache),out:resolve(root,'restored')};
}
function changed(wire:string,edit:(archive:Record<string,unknown>)=>void):string{
  const bundle=JSON.parse(wire) as {archive:Record<string,unknown>;hash:string};edit(bundle.archive);
  bundle.hash=hashImmutableBytes(new TextEncoder().encode(encodeCanonicalJson(bundle.archive)));return JSON.stringify(bundle);
}

test('exact constructor members restore and use the original cache reader without re-executing the compiler',async()=>{
  const f=await fixture();restoreNativeFixtures(f.wire,f.identity,[f.spec],f.out);
  expect(await nativeProgramFixture({...f.spec,cacheDir:f.out})).toBe(f.text);
  expect(readFileSync(resolve(f.root,'calls'),'utf8')).toBe('x');
  await expect(nativeProgramFixture({...f.spec,cacheDir:f.out})).resolves.toBe(f.text);
  expect(()=>restoreNativeFixtures(f.wire,f.identity,[f.spec],f.out)).toThrow('already exists');
});

test('foreign source, run, attempt and native host refuse before creating a destination',async()=>{
  const f=await fixture();
  for(const [field,value]of Object.entries({sha:'b'.repeat(40),run:'124',attempt:'2',node:'foreign',platform:'foreign',arch:'foreign',cwd:'/foreign'})){
    expect(()=>restoreNativeFixtures(f.wire,{...f.identity,[field]:value},[f.spec],f.out)).toThrow('source/run/attempt/host');
    expect(existsSync(f.out)).toBe(false);
  }
});

test('observed Node patch skew refuses even with an intact re-signed producer archive',async()=>{
  const f=await fixture();
  const wire=changed(f.wire,archive=>{
    const identity=v.parse(v.record(v.string(),v.unknown()),archive['identity']);
    identity['node']='v24.22.2';archive['identity']=identity;
  });
  for(const node of ['v24.22.0','v24.22.1']){
    expect(()=>restoreNativeFixtures(wire,{...f.identity,node},[f.spec],f.out)).toThrow('source/run/attempt/host');
    expect(existsSync(f.out)).toBe(false);
  }
});

test('every changed source, loader, command and inventory invalidates the original recorder key',async()=>{
  for(const mode of ['source','loader','inventory','script']){
    const f=await fixture();
    if(mode==='source')writeFileSync(resolve(f.root,'source/input.txt'),'changed');
    if(mode==='loader')writeFileSync(resolve(f.root,'scripts/bake-loader.mjs'),'// changed');
    if(mode==='inventory')writeFileSync(resolve(f.root,'source/new.txt'),'new');
    if(mode==='script')writeFileSync(resolve(f.root,'compile.mjs'),'throw Error("changed");');
    expect(()=>restoreNativeFixtures(f.wire,f.identity,[f.spec],f.out)).toThrow('source/tool/host key');
    expect(existsSync(f.out)).toBe(false);
  }
});

test('corrupt archives, missing or foreign members and altered original receipts refuse before writes',async()=>{
  const f=await fixture();
  expect(()=>restoreNativeFixtures(f.wire.replace('original','corrupt'),f.identity,[f.spec],f.out)).toThrow('archive checksum');
  for(const edit of [(archive:Record<string,unknown>)=>{archive['members']=[];},
    (archive:Record<string,unknown>)=>{archive['members']=[{name:'../escape',text:'bad',bytes:3,hash:'a'.repeat(64)},{name:'foreign',text:'bad',bytes:3,hash:'a'.repeat(64)}];},
    (archive:Record<string,unknown>)=>{archive['jobs']=[];}]){
    expect(()=>restoreNativeFixtures(changed(f.wire,edit),f.identity,[f.spec],f.out)).toThrow();
    expect(existsSync(f.out)).toBe(false);
  }
});


test('re-signed malformed members and original receipt keys/file maps still refuse before writes',async()=>{
  const f=await fixture();
  for(const mode of ['bytes','hash','duplicate','receipt-key','receipt-files']){
    const wire=changed(f.wire,archive=>{
      const members=v.parse(v.array(v.record(v.string(),v.unknown())),archive['members']);
      const first=members[0];if(first===undefined)throw new Error('Missing original member');
      if(mode==='bytes')first['text']=`${String(first['text'])}x`;
      else if(mode==='hash')first['hash']='0'.repeat(64);
      else if(mode==='duplicate')members.push({...first});
      else{
        const saved=members.find(row=>String(row['name']).endsWith('/.generation-receipt.json'));
        if(saved===undefined)throw new Error('Missing original receipt');
        const receipt=v.parse(v.record(v.string(),v.unknown()),JSON.parse(String(saved['text'])));
        if(mode==='receipt-key')receipt['key']='0'.repeat(64);else receipt['files']={};
        const text=JSON.stringify(receipt);saved['text']=text;saved['bytes']=Buffer.byteLength(text);
        saved['hash']=hashImmutableBytes(new TextEncoder().encode(text));
      }
      archive['members']=members;
    });
    expect(()=>restoreNativeFixtures(wire,f.identity,[f.spec],f.out)).toThrow(mode.startsWith('receipt')?'output receipt':mode==='duplicate'?'inventory':'member checksum');
    expect(existsSync(f.out)).toBe(false);
  }
});

test('command-only changes and symlink destinations or parents cannot acquire a restored cache',async()=>{
  const f=await fixture();
  expect(()=>restoreNativeFixtures(f.wire,f.identity,[{...f.spec,transformTypes:true}],f.out)).toThrow('source/tool/host key');
  expect(existsSync(f.out)).toBe(false);
  const link=resolve(f.root,'linked');symlinkSync(resolve(f.root,'producer'),link,'dir');
  expect(()=>restoreNativeFixtures(f.wire,f.identity,[f.spec],link)).toThrow('symlink');
  expect(()=>restoreNativeFixtures(f.wire,f.identity,[f.spec],resolve(link,'new'))).toThrow('symlink');
  expect(existsSync(resolve(f.root,'producer/new'))).toBe(false);
});

test('the dedicated eight-input Nalati cache leaves other recorders on their original cache',async()=>{
  const f=await fixture(),original=resolve(f.root,'original-family-cache'),dedicated=resolve(f.root,'nalati-cache');
  vi.stubEnv('WILDSHARD_GENERATE_CACHE',original);vi.stubEnv('WS_NALATI_NATIVE_CACHE',dedicated);
  for(const name of ['kokpar','titan','riding','charge','geography','view'] as const)expect(nalatiNativeProgramSpec(name).cacheDir).toBe(dedicated);
  expect(nalatiNativeAssemblySpec().cacheDir).toBe(dedicated);expect(nalatiNativeBootSpec().cacheDir).toBe(dedicated);
  await nativeProgramFixture({...f.spec,id:'other-family'});
  expect(existsSync(resolve(original,'fixture-other-family'))).toBe(true);
  expect(existsSync(dedicated)).toBe(false);
  vi.stubEnv('WS_NALATI_NATIVE_CACHE','');
  expect(nalatiNativeProgramSpec('titan').cacheDir).toBeUndefined();expect(nalatiNativeAssemblySpec().cacheDir).toBeUndefined();
  expect(nalatiNativeBootSpec().cacheDir).toBeUndefined();
});


test('the Pine oracle alone selects its dedicated restored construction cache',async()=>{
  const f=await fixture(),original=resolve(f.root,'original-pine-family'),dedicated=resolve(f.root,'pine-cache'),nalati=resolve(f.root,'nalati-cache');
  vi.stubEnv('WILDSHARD_GENERATE_CACHE',original);vi.stubEnv('WS_PINE_NATIVE_CACHE',dedicated);
  vi.stubEnv('WS_NALATI_NATIVE_CACHE',nalati);
  expect(pineNativeOracleSpec().cacheDir).toBe(dedicated);
  expect(nalatiNativeProgramSpec('geography').cacheDir).toBe(nalati);
  await nativeProgramFixture({...f.spec,id:'other-pine-family'});
  expect(existsSync(resolve(original,'fixture-other-pine-family'))).toBe(true);
  expect(existsSync(dedicated)).toBe(false);expect(existsSync(nalati)).toBe(false);
  vi.stubEnv('WS_PINE_NATIVE_CACHE','');expect(pineNativeOracleSpec().cacheDir).toBeUndefined();
  expect(nalatiNativeProgramSpec('geography').cacheDir).toBe(nalati);
  vi.stubEnv('WS_NALATI_NATIVE_CACHE','');vi.stubEnv('WS_PINE_NATIVE_CACHE',dedicated);
  expect(nalatiNativeProgramSpec('geography').cacheDir).toBeUndefined();
  expect(pineNativeOracleSpec().cacheDir).toBe(dedicated);
});

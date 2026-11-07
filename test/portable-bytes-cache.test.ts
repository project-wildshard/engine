// oxlint-disable-next-line import/no-nodejs-modules -- Build-only memo fixtures own repository scratch.
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths never replace shared cache entries.
import {resolve} from 'node:path';
import {expect,test} from 'vitest';
import {PortableBytesCache} from '../src/cook/game/encodedBytes';
import {encodePortableBytes,decodePortableBytes} from '../src/sharddev/bake/portableBytes';

function scratch():string{mkdirSync('tmp',{recursive:true});return mkdtempSync(resolve('tmp/sp-x9-portable-cache-'));}
test('cold and fresh-reader hits retain every current encoded byte and detached ownership',()=>{
  const root=scratch();try{
    const first=new Uint8Array(16384).fill(7),changed=Uint8Array.from(first,(_value,index)=>index%251);
    for(const input of [new Uint8Array(),first,changed]){
      const cache=new PortableBytesCache(root),cold=cache.encode(input),warm=new PortableBytesCache(root).encode(input),ordinary=encodePortableBytes(input);
      expect(cold).toEqual(ordinary);expect(warm).toEqual(ordinary);expect(decodePortableBytes(warm)).toEqual(input);
      expect(warm.buffer).not.toBe(cold.buffer);warm.fill(0);
      expect(cache.encode(input)).toEqual(ordinary);
    }
    expect(readdirSync(root).filter(name=>name.endsWith('.json'))).toHaveLength(3);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('corrupt or absent bodies, transplanted metadata and unwritable storage recompute the real transform',()=>{
  const root=scratch(),input=new TextEncoder().encode('native channels '.repeat(1024));try{
    const original=encodePortableBytes(input);expect(new PortableBytesCache(root).encode(input)).toEqual(original);
    const body=readdirSync(root).find(name=>name.endsWith('.bin')),meta=readdirSync(root).find(name=>name.endsWith('.json'));
    if(body===undefined||meta===undefined)throw new Error('Missing completed transform');
    const damaged=readFileSync(resolve(root,body));damaged.fill(0);writeFileSync(resolve(root,body),damaged);
    expect(new PortableBytesCache(root).encode(input)).toEqual(original);
    rmSync(resolve(root,body));expect(new PortableBytesCache(root).encode(input)).toEqual(original);
    writeFileSync(resolve(root,meta),JSON.stringify({key:'other input',bytes:0,hash:'0'.repeat(64)}));
    expect(new PortableBytesCache(root).encode(input)).toEqual(original);
    const blocked=resolve(root,'ordinary-file');writeFileSync(blocked,'not a directory');
    expect(new PortableBytesCache(blocked).encode(input)).toEqual(original);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('a cached ordinary buffer never authorizes shared input',()=>{
  const root=scratch();try{
    const ordinary=new Uint8Array(32).fill(7);new PortableBytesCache(root).encode(ordinary);
    const shared=new Uint8Array(new SharedArrayBuffer(32));shared.set(ordinary);
    expect(()=>new PortableBytesCache(root).encode(shared)).toThrow('bounded unshared');
  }finally{rmSync(root,{recursive:true,force:true});}
});

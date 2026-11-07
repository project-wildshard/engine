// oxlint-disable-next-line import/no-nodejs-modules -- The build cache owns only repository scratch.
import {mkdirSync,mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Test actual compression rather than a stored byte or hash pin.
import {brotliCompressSync,constants} from 'node:zlib';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths never touch the shared build cache.
import {resolve} from 'node:path';
import {expect,test} from 'vitest';
import {BrotliSizeCache} from '../src/cook/game/brotliSizeCache.mjs';

const expected=(bytes:Uint8Array):number=>Math.min(bytes.byteLength,brotliCompressSync(bytes,{params:{
  [constants.BROTLI_PARAM_QUALITY]:3,[constants.BROTLI_PARAM_SIZE_HINT]:bytes.byteLength,
}}).byteLength);
function scratch():string{mkdirSync('tmp',{recursive:true});return mkdtempSync(resolve('tmp/sp-x9-brotli-size-'));}

test('memory and fresh-reader disk reuse retain current q3 sizes, including equal-length edits',()=>{
  const directory=scratch();
  try{
    const cache=new BrotliSizeCache(directory),first=new Uint8Array(8192).fill(9);
    const changed=Uint8Array.from(first,(_value,index)=>(index*37+Math.floor(index/11))%256);
    for(const bytes of [new Uint8Array(),first,changed]){
      expect(cache.bytes(bytes)).toBe(expected(bytes));
      expect(cache.bytes(Uint8Array.from(bytes))).toBe(expected(bytes));
      expect(new BrotliSizeCache(directory).bytes(bytes)).toBe(expected(bytes));
    }
    expect(readdirSync(directory).filter(file=>file.endsWith('.json'))).toHaveLength(3);
    expect(expected(first)).not.toBe(expected(changed));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('corrupt, transplanted or unwritable cache state falls back to actual compression',()=>{
  const directory=scratch(),bytes=new TextEncoder().encode('current wire '.repeat(1000));
  try{
    const cache=new BrotliSizeCache(directory);expect(cache.bytes(bytes)).toBe(expected(bytes));
    const file=readdirSync(directory).find(name=>name.endsWith('.json'));
    if(file===undefined)throw new Error('Missing completed memo');
    for(const text of ['{','{}',JSON.stringify({key:'wrong input',bytes:0,seal:'wrong seal'})]){
      writeFileSync(resolve(directory,file),text);
      expect(new BrotliSizeCache(directory).bytes(bytes)).toBe(expected(bytes));
    }
    const blocked=resolve(directory,'ordinary-file');writeFileSync(blocked,'not a directory');
    expect(new BrotliSizeCache(blocked).bytes(bytes)).toBe(expected(bytes));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('precompressed sizes retain exact q11 output and never borrow a served-size result',()=>{
  const directory=scratch();
  const native=(bytes:Uint8Array):number=>brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).byteLength;
  try{
    const source=new Uint8Array(8192).fill(19),changed=Uint8Array.from(source,(_byte,index)=>(index*31+Math.floor(index/13))%256);
    for(const bytes of [new Uint8Array(),source,changed]){
      expect(new BrotliSizeCache(directory).bytes(bytes)).toBe(expected(bytes));
      const cache=new BrotliSizeCache(directory,'precompressed');
      expect(cache.bytes(bytes)).toBe(native(bytes));
      expect(cache.bytes(Uint8Array.from(bytes))).toBe(native(bytes));
      expect(new BrotliSizeCache(directory,'precompressed').bytes(bytes)).toBe(native(bytes));
      expect(new BrotliSizeCache(directory).bytes(bytes)).toBe(expected(bytes));
    }
    expect(new BrotliSizeCache(directory,'precompressed').bytes(new Uint8Array())).toBeGreaterThan(0);
    for(const file of readdirSync(directory).filter(name=>name.endsWith('.json')))writeFileSync(resolve(directory,file),'{');
    expect(new BrotliSizeCache(directory,'precompressed').bytes(changed)).toBe(native(changed));
    const blocked=resolve(directory,'ordinary-file');writeFileSync(blocked,'not a directory');
    expect(new BrotliSizeCache(blocked,'precompressed').bytes(source)).toBe(native(source));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

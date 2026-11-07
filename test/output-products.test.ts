import {describe, expect, it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare actual public and product files in owned Node fixtures.
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the owned fixture and output directories.
import {dirname, join, resolve} from 'node:path';
import {copyDeferredPublic, deferredPublicCopy, copyOutputProducts, pruneLooseCopies} from '../scripts/app-build/outputProducts.mjs';

function write(root: string, name: string, body: string): void {
  mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),body);
}
function files(root: string): Record<string,string> {
  return Object.fromEntries(readdirSync(root,{recursive:true,withFileTypes:true}).filter(row=>row.isFile()).map((row): [string,string]=>{
    const path=join(row.parentPath,row.name);return [path.slice(root.length+1),readFileSync(path).toString('hex')];
  }).sort(([left],[right])=>left.localeCompare(right)));
}
describe('app public copy before final product publication',()=>{
  it('keeps emitted collisions, nested public bytes and the actual final product tree exact',()=>{
    const root=mkdtempSync(resolve('tmp/app-public-'));
    try {
      write(root,'public/manifest.webmanifest','manifest');
      write(root,'public/assets/collision.js','old public JS');
      write(root,'public/assets/nested/texture.bin','\u0000\u00FF\uD800');
      write(root,'public/shardfiles/obsolete/shard.json','obsolete');
      write(root,'public/shardfiles/obsolete/source.js','public source');
      write(root,'public/assets/shardfiles/keep.bin','nested name is retained');
      write(root,'out/current/shard.json','actual index');
      write(root,'out/current/geometry.bin','actual bytes');
      write(root,'out/current/runtime/source.ts','private runtime');
      write(root,'out/current/.build-key','private key');
      const before=join(root,'before'),after=join(root,'after');
      cpSync(join(root,'public'),before,{recursive:true});
      for(const directory of [before,after]) {
        write(directory,'assets/collision.js','emitted chunk');write(directory,'.vite/manifest.json','bundle manifest');
      }
      copyDeferredPublic(root,after);
      expect(existsSync(join(after,'shardfiles'))).toBe(false);
      expect(readFileSync(join(after,'assets/collision.js'),'utf8')).toBe('emitted chunk');
      for(const directory of [before,after])copyOutputProducts(root,directory);
      expect(files(after)).toEqual(files(before));
      expect(existsSync(join(after,'shardfiles/current/runtime'))).toBe(false);
      expect(existsSync(join(after,'shardfiles/obsolete'))).toBe(false);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it('retains Vite copy for custom config/root/retained/external output',()=>{
    const root=mkdtempSync(resolve('tmp/app-public-'));
    try {
      const out=join(root,'dist');
      expect(deferredPublicCopy(root,out,[])).toBe(true);
      expect(deferredPublicCopy(root,out,['--mode','native','--outDir=dist'])).toBe(true);
      for(const args of [['--config','custom.ts'],['--emptyOutDir','false'],['--emptyOutDir=false'],['another-root'],['--base','/x/'],['--mode'],['--mode='],['--outDir','dist','--outDir','other']])expect(deferredPublicCopy(root,out,args)).toBe(false);
      for(const target of [root,join(root,'..','external'),join(root,'public'),join(root,'public','nested')])expect(deferredPublicCopy(root,target,[])).toBe(false);
      mkdirSync(join(out,'.git'),{recursive:true});expect(deferredPublicCopy(root,out,[])).toBe(false);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it('refuses a public file colliding with a generated directory',()=>{
    const root=mkdtempSync(resolve('tmp/app-public-'));
    try {
      write(root,'public/assets/collision','public file');mkdirSync(join(root,'dist/assets/collision'),{recursive:true});
      expect(()=>copyDeferredPublic(root,join(root,'dist'))).toThrow('Public file collides');
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it('accepts an absent public tree',()=>{
    const root=mkdtempSync(resolve('tmp/app-public-'));
    try {expect(()=>copyDeferredPublic(root,join(root,'dist'))).not.toThrow();}
    finally {rmSync(root,{recursive:true,force:true});}
  });
});

it('DL20: a file only parts need leaves; what a default manifest lists, a homed part holds, or nothing packs stays', () => {
  const out = mkdtempSync(resolve('tmp','dl20-prune-'));
  try {
    const file = (url: string, body = 'xxxx'): void => { mkdirSync(dirname(join(out, url)), {recursive: true}); writeFileSync(join(out, url), body); };
    const url = (name: string): string => `/shardfiles/a/blobs/bin/${name}.bin`;
    for (const name of ['walked', 'neighbour', 'homed', 'unpacked']) file(url(name));
    file('/assets/spawn/parts/aaaaaaaaaaaaaaaa.pack.br'); file('/assets/kept.bin');
    file('/assets/spawn/a-client-phone-0000000000000000.json', JSON.stringify({files: [{url: url('neighbour')}]}));
    const phoneFile = '/shardfiles/a/blobs/bin/own.phone-12345678.bin', desktopFile = '/shardfiles/a/blobs/bin/own.desktop-12345678.bin';
    for (const name of [phoneFile, desktopFile, url('fence-off')]) file(name);
    file('/assets/spawn/a-client-phone-1111111111111111.json', JSON.stringify({files: [{url: url('walked')}, {url: url('neighbour')}, {url: '/assets/kept.bin'}, {url: url('homed')}, {url: phoneFile}],
      parts: [{url: '/assets/spawn/parts/aaaaaaaaaaaaaaaa.pack.br', members: [[0, 0], [1, 16], [2, 32], [4, 48]]}, {url: '/assets/spawn/parts/bbbbbbbbbbbbbbbb.pack.br', members: [[3, 0]]}]}));
    // A fenced shard's desktop lists its whole level: what only it holds, a phone still reads by URL, past any part of its own.
    file('/assets/spawn/a-client-desktop-2222222222222222.json', JSON.stringify({files: [{url: url('walked')}, {url: url('fence-off')}, {url: desktopFile}],
      parts: [{url: '/assets/spawn/parts/aaaaaaaaaaaaaaaa.pack.br', members: [[0, 0], [1, 16], [2, 32]]}]}));
    expect(pruneLooseCopies(out)).toEqual({files: 3, bytes: 12});
    for (const name of [url('walked'), phoneFile, desktopFile]) expect(existsSync(join(out, name)), name).toBe(false);
    for (const name of ['neighbour', 'homed', 'unpacked', 'fence-off']) expect(existsSync(join(out, url(name))), name).toBe(true);
    expect(existsSync(join(out, 'assets/kept.bin'))).toBe(true);
  } finally { rmSync(out, {recursive: true, force: true}); }
});

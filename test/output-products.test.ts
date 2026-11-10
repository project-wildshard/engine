import {describe, expect, it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare actual public and product files in owned Node fixtures.
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the owned fixture and output directories.
import {dirname, join, resolve} from 'node:path';
import {copyDeferredPublic, deferredPublicCopy, copyOutputProducts, pruneLooseCopies} from '../scripts/app-build/outputProducts.mjs';
import {checkBakedTextures} from '../scripts/app-build/bakedTextures.mjs';
import {pinnedPublicAssets} from '../scripts/pin-assets.ts';

function write(root: string, name: string, body: string): void {
  mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),body);
}
function files(root: string): Record<string,string> {
  return Object.fromEntries(readdirSync(root,{recursive:true,withFileTypes:true}).filter(row=>row.isFile()).map((row): [string,string]=>{
    const path=join(row.parentPath,row.name);return [path.slice(root.length+1),readFileSync(path).toString('hex')];
  }).sort(([left],[right])=>left.localeCompare(right)));
}
it('publishes every declared baked mode for both tiers and refuses a missing fallback before or after copying',()=>{
  const root=mkdtempSync(resolve('tmp/app-baked-'));
  const desktop='/assets/baked/dawn-isle/tex/sky.jpg',phone='/assets/baked/dawn-isle/tex/sky.phone.webp',gpu='/assets/gpu/baked/dawn-isle/tex/sky-01234567.ktx2';
  const horizon='/assets/horizon/dawn-isle-day-phone.webp';
  const model='/assets/models/dawn-isle/stone.glb',npc='/assets/dawn-isle/npcs/helper.phone.glb';
  try{
    write(root,'out/dawn/shard.json','{}');
    const modes={phone:{img:{baked:[phone]},ktx2:{baked:[gpu]}},desktop:{img:{baked:[desktop]},ktx2:{baked:[gpu]}}};
    for(const url of [desktop,phone,gpu,horizon,model,npc])write(root,`public${url}`,'authored payload');
    const declarations=[
      {$call:'pageModeBoot',args:[{grid:{modes},shard:{modes}}]},
      {files:{modes}},
      {files:{tiers:{phone:[phone],desktop:[desktop]}},gpuFiles:{phone:{[phone]:gpu},desktop:{[desktop]:gpu}}},
      {sources:{baked:{source:{urls:{phone:[phone],desktop:[desktop]}}},gpu:{source:{urls:[gpu]}}}},
    ];
    for(const bindings of declarations){
      write(root,'out/dawn/mounts/shardfiles/dawn/discovery.json',JSON.stringify({rows:{bootBindings:{...bindings,sky:[horizon],models:[model]}}}));
      expect(checkBakedTextures(root,join(root,'public'))).toBe(5);
    }
    expect(checkBakedTextures(root,join(root,'public'))).toBe(5);
    copyDeferredPublic(root,join(root,'dist'));pruneLooseCopies(join(root,'dist'));
    expect(checkBakedTextures(root,join(root,'dist'))).toBe(5);
    rmSync(join(root,`public${phone}`));
    expect(()=>checkBakedTextures(root,join(root,'public'))).toThrow(phone);
    rmSync(join(root,`dist${desktop}`));
    expect(()=>checkBakedTextures(root,join(root,'dist'))).toThrow(desktop);
    write(root,`public${phone}`,'authored payload');
    write(root,'out/dawn/mounts/shardfiles/dawn/discovery.json',JSON.stringify({rows:{bootBindings:{models:[model]}},native:{ktx2:{phone:{[npc]:'/assets/gpu/dawn-isle/npc-01234567.glb'}}}}));
    expect(checkBakedTextures(root,join(root,'public'))).toBe(2);
    rmSync(join(root,`public${npc}`));expect(()=>checkBakedTextures(root,join(root,'public'))).toThrow(npc);
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('refuses corrupt pinned image bytes in public and final output even when each file exists',()=>{
  const root=mkdtempSync(resolve('tmp/app-baked-pins-'));
  try{
    mkdirSync(join(root,'test/pins'),{recursive:true});
    const local=JSON.parse(readFileSync('test/pins/assets.json','utf8')) as {version:number;assets:{remote?:true}[]};
    writeFileSync(join(root,'test/pins/assets.json'),JSON.stringify({...local,assets:local.assets.filter(row=>row.remote!==true)}));
    cpSync('test/pins/assets',join(root,'test/pins/assets'),{recursive:true});
    const assets=pinnedPublicAssets(root),first=assets[0];
    if(first===undefined)throw new Error('Expected a real frozen image pin');
    write(root,'out/owner/shard.json','{}');
    write(root,'out/owner/mounts/shardfiles/owner/discovery.json',JSON.stringify({rows:{bootBindings:{files:{modes:{phone:{img:[first.url]},desktop:{img:[first.url]}}}}}}));
    for(const row of assets){mkdirSync(dirname(join(root,`public${row.url}`)),{recursive:true});writeFileSync(join(root,`public${row.url}`),row.body);}
    copyDeferredPublic(root,join(root,'dist'));
    expect(checkBakedTextures(root,join(root,'public'))).toBe(1);
    expect(checkBakedTextures(root,join(root,'dist'))).toBe(1);
    writeFileSync(join(root,`public${first.url}`),new Uint8Array());
    expect(()=>checkBakedTextures(root,join(root,'public'))).toThrow('Published pinned baked texture bytes differ');
    writeFileSync(join(root,`dist${first.url}`),Buffer.concat([first.body,Buffer.from([0])]));
    expect(()=>checkBakedTextures(root,join(root,'dist'))).toThrow('Published pinned baked texture bytes differ');
  }finally{rmSync(root,{recursive:true,force:true});}
});
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

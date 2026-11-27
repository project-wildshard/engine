import {describe, expect, it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the fixture's mount bytes as a product names them.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare actual public and product files in owned Node fixtures.
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the owned fixture and output directories.
import {dirname, join, resolve} from 'node:path';
import {checkPublishedMounts, copyDeferredPublic, deferredPublicCopy, copyOutputFolders, pruneLooseCopies} from '../src/scripts/app-build/outputFolders.mjs';
import {checkBakedTextures} from '../src/scripts/app-build/bakedTextures.mjs';

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
// SF11: no pin publishes a zone's mounts, so a zone's own declared file is present as a row of its cook.json mounts (under
// mounts/ or over one of its blobs, as an images-only upload carries it); another zone's row is not, nor a row whose file is gone.
it("counts a zone's own mount row as present, never another zone's",()=>{
  const root=mkdtempSync(resolve('tmp/app-baked-own-'));
  const portrait='/assets/dawn-isle/ui/portrait.webp',model='/assets/dawn-isle/models/stone.glb',blob=`blobs/image/${'a'.repeat(64)}.webp`;
  const cook=(rows: {url: string, path: string}[]): string=>JSON.stringify({version:1,mounts:rows.map(row=>({...row,bytes:16,hash:'b'.repeat(64)}))});
  try{
    write(root,'out/dawn/shard.json','{}');write(root,'out/dusk/shard.json','{}');
    write(root,'out/dawn/mounts/shardfiles/dawn/discovery.json',JSON.stringify({rows:{bootBindings:{card:[portrait],models:[model]}}}));
    write(root,`out/dawn/mounts${model}`,'authored payload');write(root,`out/dawn/${blob}`,'authored payload');
    write(root,'out/dawn/cook.json',cook([{url:portrait,path:blob},{url:model,path:`mounts${model}`}]));
    expect(checkBakedTextures(root,join(root,'public'))).toBe(2);
    expect(checkBakedTextures(root,join(root,'dist'))).toBe(2);
    write(root,'out/dawn/cook.json',cook([{url:portrait,path:blob}]));write(root,'out/dusk/cook.json',cook([{url:model,path:`mounts${model}`}]));
    write(root,`out/dusk/mounts${model}`,'authored payload');
    expect(()=>checkBakedTextures(root,join(root,'public'))).toThrow(model);
    rmSync(join(root,`out/dawn/${blob}`));write(root,'out/dawn/cook.json',cook([{url:portrait,path:blob},{url:model,path:`mounts${model}`}]));
    expect(()=>checkBakedTextures(root,join(root,'public'))).toThrow(portrait);
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
      for(const directory of [before,after])copyOutputFolders(root,directory);
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
  it('SF12: with the engine list, the page copies listed engine art and the build\'s runtime, never a zone\'s file',()=>{
    const root=mkdtempSync(resolve('tmp/app-public-'));
    try {
      write(root,'src/scripts/public-engine.json',JSON.stringify({version:1,files:['assets/practice/dummy.glb','manifest.webmanifest']}));
      for(const path of ['manifest.webmanifest','assets/practice/dummy.glb','assets/physics/rapier.wasm','basis/r186/basis_transcoder.wasm','assets/tex/leafy_grass/diffuse.jpg','assets/nalati-grasslands/cards.png'])write(root,`public/${path}`,path);
      copyDeferredPublic(root,join(root,'dist'));
      expect(Object.keys(files(join(root,'dist')))).toEqual(['assets/physics/rapier.wasm','assets/practice/dummy.glb','basis/r186/basis_transcoder.wasm','manifest.webmanifest']);
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

// Meta QA 2026-11-13 row 34: a hand-placed candidate whose re-encoded recording kept its URL, over the old head's copy in
// public/, made a preparation preview serve the old bytes and the fence lose every recording.
it('refuses a build whose public copy of a product mount has other bytes',()=>{
  const root=mkdtempSync(resolve('tmp/app-mounts-'));
  const sha=(text: string): string=>createHash('sha256').update(text).digest('hex');
  const url='/assets/music/piano/island-calm-05125ed8.m4a';
  try{
    write(root,'out/dawn/cook.json',JSON.stringify({mounts:[{url,path:`mounts${url}`,hash:sha('new encode'),bytes:10},
      {url:'/shardfiles/dawn/discovery.json',path:'mounts/shardfiles/dawn/discovery.json',hash:sha('elsewhere'),bytes:9},
      {url:'/assets/sfx/dawn/gone.m4a',path:'mounts/assets/sfx/dawn/gone.m4a',hash:sha('absent'),bytes:6}]}));
    write(root,`public${url}`,'new encode');
    write(root,'out/.hidden/cook.json','not json');write(root,'out/bare/shard.json','{}');
    expect(checkPublishedMounts(root)).toBe(1);
    write(root,'out/broken/cook.json','not json');
    expect(()=>checkPublishedMounts(root)).toThrow('out/broken/cook.json does not parse');
    rmSync(join(root,'out/broken'),{recursive:true});
    write(root,`public${url}`,'old encode');
    expect(()=>checkPublishedMounts(root)).toThrow(`public/ holds 1 mount with other bytes than their product in out/ (dawn ${url})`);
  }finally{rmSync(root,{recursive:true,force:true});}
});

// QA 11-25 row 86 (c): the build's cook writes the phone tier's own files beside each product before the products are
// copied; the copy kept the served discovery naming them and deleted the files (Sky Reach's 404s on a local build).
it("keeps the cook's tier files its served discovery names, and nothing else the cook left",()=>{
  const root=mkdtempSync(join(process.cwd(),'tmp/output-tier-')),outDir=join(root,'dist');
  try{
    write(root,'out/reach/shard.json','{}');
    write(root,'out/reach/blobs/glb/a.glb','own');
    const tier='/shardfiles/reach/blobs/glb/a.t512-1234abcd.glb';
    write(outDir,tier.slice(1),'tier');
    write(outDir,'shardfiles/reach/stale.json','old');
    write(outDir,'.discovery/reach/discovery.json',JSON.stringify({native:{ktx2:{GPU_FILES:{phone:{a:tier}}}}}));
    copyOutputFolders(root,outDir);
    expect(readFileSync(join(outDir,tier.slice(1)),'utf8')).toBe('tier');
    expect(readFileSync(join(outDir,'shardfiles/reach/blobs/glb/a.glb'),'utf8')).toBe('own');
    expect(JSON.parse(readFileSync(join(outDir,'shardfiles/reach/discovery.json'),'utf8')).native.ktx2.GPU_FILES.phone.a).toBe(tier);
    expect(existsSync(join(outDir,'shardfiles/reach/stale.json'))).toBe(false);
    expect(existsSync(join(outDir,'.shardfiles-cooked'))).toBe(false);
    expect(existsSync(join(outDir,'.discovery'))).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

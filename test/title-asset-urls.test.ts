// oxlint-disable-next-line import/no-nodejs-modules -- Exact byte proof for the build's image copies.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns only its temporary output folder.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve local build fixture paths.
import {join,resolve} from 'node:path';
import {expect,test} from 'vitest';
import {titleAssetTables,titleAssetURLs,writeTitleAssets} from '../scripts/title-assets.mjs';
import {titleAssetURL} from '../src/client/game/titleAssets';
import {serviceWorkerCore} from '../scripts/app-build/serviceWorker';

test('every title URL names its exact original bytes and shell/runtime use the same URL',async()=>{
  const root=process.cwd(),urls=titleAssetURLs(root),tables=titleAssetTables(root);
  expect(Object.keys(urls)).toHaveLength(7);
  expect(tables['index.html']).toBe(readFileSync('index.html','utf8'));
  expect(tables['scripts/title-assets.generated.json']).toBe(readFileSync('scripts/title-assets.generated.json','utf8'));
  mkdirSync('tmp',{recursive:true});const out=mkdtempSync(resolve('tmp/title-assets-'));
  try{
    writeTitleAssets(root,out);
    for(const [source,url]of Object.entries(urls)){
      const bytes=readFileSync(join(root,'public',source));
      const hash=createHash('sha256').update(bytes).digest('hex');
      expect(url).toMatch(/-[a-f0-9]{12,16}\.(?:jpg|png)$/u);
      expect(url).toContain(hash.slice(0,source.includes('/launch-')?12:16));
      expect(readFileSync(join(out,url)).equals(bytes)).toBe(true);
      expect(titleAssetURL(source)).toBe(url);
    }
    expect(titleAssetURL('/another-image.jpg')).toBe('/another-image.jpg');
    const html=readFileSync('index.html','utf8');
    const result=await serviceWorkerCore({'index.html':{type:'asset',source:new TextEncoder().encode(html)}},root,'title');
    expect(result.core).toContain(urls['/assets/title/main-crossroads-square.jpg']);
    expect(result.core).toContain(urls['/assets/title/main-crossroads-landscape.jpg']);
    const literal=/^\s*(?:const|var) SHELL_FILES = JSON.parse\((.+)\);$/mu.exec(result.core)?.[1];
    if(literal===undefined)throw new Error('Missing installed shell inventory');
    const encoded:unknown=JSON.parse(literal);
    if(typeof encoded!=='string')throw new Error('Shell inventory must be serialized data');
    const installed:unknown=JSON.parse(encoded);
    // S2: iOS reads its launch image itself, so a first visit doesn't spend 1.6 MB on it; portraits wait for control (DL1).
    const later=(url:string):boolean=>url.includes('/launch-')||url.includes('-portrait-');
    expect(installed).toEqual(expect.arrayContaining(Object.values(urls).filter(url=>!later(url))));
    if(!Array.isArray(installed))throw new Error('Shell inventory must be a list');
    expect(installed.filter(url=>typeof url==='string'&&later(url))).toEqual([]);
    for(const url of Object.values(urls))if(url.includes('-portrait-'))expect(/^\s*(?:const|var) FILES = .+$/mu.exec(result.core)?.[0]).toContain(url);
  }finally{rmSync(out,{recursive:true,force:true});}
});


test('title source generation refuses stale names, missing markers and stale publication tables',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/title-source-'));
  try{
    mkdirSync(join(root,'public/assets/title'),{recursive:true});mkdirSync(join(root,'scripts'));
    const image=join(root,'public/assets/title/hero.jpg'),document=join(root,'index.html');
    writeFileSync(image,'first');writeFileSync(document,'// BEGIN TITLE URLS\n// END TITLE URLS');
    const first=titleAssetTables(root),url=titleAssetURLs(root)['/assets/title/hero.jpg'];
    const table=first['scripts/title-assets.generated.json'],html=first['index.html'];
    if(table===undefined||html===undefined)throw new Error('Missing title source outputs');
    writeFileSync(join(root,'scripts/title-assets.generated.json'),table);
    writeFileSync(document,html);
    expect(titleAssetTables(root)).toEqual(first);
    writeFileSync(image,'other');
    expect(titleAssetURLs(root)['/assets/title/hero.jpg']).not.toBe(url);
    expect(()=>writeTitleAssets(root,join(root,'out'))).toThrow('Stale title asset URLs');
    writeFileSync(document,'no table');expect(()=>titleAssetTables(root)).toThrow('Missing title URL table markers');
    writeFileSync(join(root,'public/assets/title/launch-000000000000.png'),'pixels');
    expect(()=>titleAssetURLs(root)).toThrow('Title asset name differs from bytes');
  }finally{rmSync(root,{recursive:true,force:true});}
});

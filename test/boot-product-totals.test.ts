import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the tiny output metadata fixture.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve that compiler fixture without changing cwd.
import { resolve } from 'node:path';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { bootFolderTotals, folderDownloadTotal, homeClientModuleGroups } from '../scripts/app-build/bootFolders';
import {bootTierFolderTotals} from '../scripts/app-build/bootFolderTiers';
import {readOutputDownloadIndex} from '@wildshard/format/outputDownload';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
// oxlint-disable-next-line import/no-nodejs-modules -- Record exact section hashes in the real output fixture.
import { createHash } from 'node:crypto';

const source = emptyShardfile({ slug: 'total-test', name: 'Total', author: 'Test', revision: 1, seed: 9 });
const hash = '0'.repeat(64);
const index = { format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity,
  requires: source.requires, build: { sourceHash: hash, validator: 'test' },
  admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
  sections: [{ name: 'custom/first', path: 'sections/custom/first.json', schema: 'schemas/custom/first.schema.json', hash, bytes: 40 }],
  schemas: [{ path: 'schemas/custom/first.schema.json', hash, bytes: 15 }],
  files: [{ kind: 'bin', path: `blobs/bin/${hash}.bin`, hash, compressed: 30, decoded: 300, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false }], runtime: null };

const tierCases = [null,{kind:'client-plan'}].flatMap(runtime =>
  [false,true].flatMap(cover => [false,true].map(sharedImage => ({runtime,cover,sharedImage}))));

test('the download metadata intake retains the native tier and variant selectors', () => {
  const files = [{...index.files[0], tier: 'phone', variantOf: 'ground'}, {...index.files[0],
    hash: '1'.repeat(64), path: `blobs/bin/${'1'.repeat(64)}.bin`, tier: 'desktop', variantOf: 'ground'}];
  expect(readOutputDownloadIndex({...index, files}).files).toEqual(files.map(file => ({path: file.path,
    hash: file.hash, compressed: file.compressed, tier: file.tier, variantOf: file.variantOf})));
  expect(() => readOutputDownloadIndex({...index, files: [{...files[0], tier: 'tablet'}]})).toThrow();
});
test.each(tierCases)('compiler entry totals retain selected/shared files (runtime $runtime, cover $cover, shared image $sharedImage)',({runtime,cover,sharedImage})=>{
  mkdirSync('tmp/vite-boot-products',{recursive:true});
  const root=mkdtempSync(resolve('tmp/vite-boot-products/tier-'));
  try {
    const row=emptyShardfile({slug:'tier-total',name:'Tier',author:'Test',revision:1,seed:9});
    const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
    const phone=digest('phone'),desktop=digest('desktop'),image=digest('image');
    row.files.push(...[phone,desktop].map((assetHash,i)=>({hash:assetHash,kind:'binary' as const,compressed:i+1,decoded:i+1,gpu:0,triangles:0,draws:0,dependencies:[],critical:false})));
    row.library.push(phone,desktop);row.budgets.library={compressed:3,resident:3};
    const tierOnly=digest('desktop-only'),smallVariant=digest('small-variant'),largeVariant=digest('large-variant');
    row.files.push(...[tierOnly,smallVariant,largeVariant].map((assetHash,i)=>({hash:assetHash,kind:'binary' as const,compressed:i+3,decoded:i+3,gpu:0,triangles:0,draws:0,dependencies:[],critical:false})));
    row.library.push(tierOnly,smallVariant,largeVariant);row.budgets.library.compressed+=12;row.budgets.library.resident+=12;
    row.files.push({hash:image,kind:'image',compressed:13,decoded:56,gpu:4,triangles:0,draws:0,dependencies:[],critical:false});
    row.library.push(image);row.budgets.library.compressed+=13;row.budgets.library.resident+=60;
    const product=resolve(root,'out/tier-total');mkdirSync(product,{recursive:true});
    const values=new Map(outputSectionPayloads(row));
    values.set('ui/level',{manifest:{explore:{art:{world:`/shardfiles/tier-total/blobs/image/${image}.png`}}}});
    if(sharedImage)values.set('look/map',{map:{image}});
    const selectedSection = cover ? 'client/plan' : 'world/scenes';
    values.set(selectedSection,cover ? {version:1,features:[{kind:'world.assembly',rows:{
      construction:{cells:{phone:'phone.bin',desktop:'desktop.bin'},seed:1,
        progress:{total:1,finish:'World',budgetMs:8},checkpoints:[]},
      stages:[{kind:'place',id:'entry',label:'Entry'}],
    }}]} : {version:1,libraries:[{id:'trees',kind:'owned',models:[{id:'tree',file:{phone:'phone.bin',desktop:'desktop.bin'}}]}],materials:[],steps:[]});
    const sections=[...values].map(([name,value])=>{
      const text=JSON.stringify(value),path=`sections/${name}.json`;
      mkdirSync(resolve(product,'sections',name.split('/')[0]??''),{recursive:true});writeFileSync(resolve(product,path),text);
      return {name,path,hash:digest(text),bytes:Buffer.byteLength(text),schema:`wildshard:${name}@1`};
    });
    const files=[];
    for(let i=0;i<row.files.length;i++) {
      const file=row.files[i];if(file===undefined)throw new Error('Missing tier fixture file');
      files.push(file.kind==='image'?{...file,path:`blobs/image/${file.hash}.png`}
        :{...file,kind:'bin',name:i===0?'phone.bin':i===1?'desktop.bin':`extra-${i}.bin`,path:`blobs/bin/${file.hash}.bin`,
          ...(file.hash===tierOnly?{tier:'desktop'}:{}),
          ...(file.hash===smallVariant||file.hash===largeVariant?{variantOf:'same-payload'}:{})});
    }
    const data={...index,runtime,identity:row.identity,requires:row.requires,
      admission:{budgets:row.budgets,serverBudget:row.serverBudget,authorCaps:row.authorCaps,critical:row.critical,library:row.library},
      sections,schemas:[],files};
    const text=JSON.stringify(data);writeFileSync(resolve(product,'shard.json'),text);
    const full=folderDownloadTotal(data,Buffer.byteLength(text));
    const omittedImage=sharedImage?0:13;
    expect(bootTierFolderTotals(root)).toEqual({'/shardfiles/tier-total/':[full[0],full[1],full[1]-2-omittedImage-3-4,full[1]-1-omittedImage-4]});
    writeFileSync(resolve(product,`sections/${selectedSection}.json`),'{}');
    expect(()=>bootTierFolderTotals(root)).toThrow('Boot tier section differs');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('uses index, section, custom-schema and encoded blob bytes, never decoded/GPU budgets', () => {
  expect(folderDownloadTotal(index, 20)).toEqual([20, 105]);
  expect(() => folderDownloadTotal({ ...index, files: [{ ...index.files[0], path: '../foreign.bin' }] }, 20)).toThrow();
  expect(() => folderDownloadTotal(index, -1)).toThrow('Invalid product download total');
});

test('home code facts match measured selected rows and refuse changed section bytes', () => {
  mkdirSync('tmp/vite-boot-products', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-boot-products/code-'));
  try {
    const product = resolve(root, 'out/total-test'); mkdirSync(product, { recursive: true });
    const values = new Map<string, unknown>([
      ['client/plan', {version:1,features:[{kind:'world.scenes'},{kind:'debug.expose',name:'weather',source:{kind:'world-weather',owner:'weather'}}]}],
      ['look/materials', {rows:{looks:[{recipe:'platform.skin'}]}}],
      ['combat/items', {items:{rows:[]}}], ['explore/catalogue', {version:1,entries:[]}],
    ]);
    const sections = [...values].map(([name, value]) => {
      const text = JSON.stringify(value), path = `${name.replaceAll('/', '-')}.json`;
      writeFileSync(resolve(product, path), text);
      return {name,path,hash:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};
    });
    writeFileSync(resolve(product, 'shard.json'), JSON.stringify({...index,sections}));
    expect(homeClientModuleGroups(root,'total-test')).toEqual(['world.scenes','models.gltf']);
    writeFileSync(resolve(product,'client-plan.json'),'{}');
    expect(() => homeClientModuleGroups(root,'total-test')).toThrow('Boot code section differs');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('the shell contains only directory totals; complete file banks stay in their products', () => {
  mkdirSync('tmp/vite-boot-products', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-boot-products/case-'));
  try {
    expect(bootFolderTotals(root)).toEqual({});
    mkdirSync(resolve(root, 'out/total-test'), { recursive: true });
    const text = JSON.stringify(index);
    writeFileSync(resolve(root, 'out/total-test/shard.json'), text);
    const rows = bootFolderTotals(root);
    expect(rows).toEqual({ '/shardfiles/total-test/': [Buffer.byteLength(text), Buffer.byteLength(text) + 85] });
    expect(JSON.stringify(rows)).not.toContain('custom/first');
    expect(JSON.stringify(rows)).not.toContain(hash);
    const legacy=JSON.stringify({...index,runtime:{entry:'runtime/plugin.ts'}});
    writeFileSync(resolve(root,'out/total-test/shard.json'),legacy);
    expect(bootTierFolderTotals(root)).toEqual({'/shardfiles/total-test/':[Buffer.byteLength(legacy),Buffer.byteLength(legacy)+85]});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

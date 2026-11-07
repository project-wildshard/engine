import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated census fixtures, never repository exports.
import {mkdirSync,mkdtempSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine fixture files to their owned root.
import {dirname,join} from 'node:path';
import {sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {productManifestPath} from '../scripts/authored-manifest.mjs';
import {platformOutput} from './fixtures/platformOutputs';

it('refuses an absent discovery root instead of charging its shared user',()=>{
 const root=mkdtempSync('tmp/platform-source-inputs-');
 const put=(path:string,text:string):void=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
 try{
  put('src/shared/game.ts','export function shared() { return 1; }');
  const source="import {shared} from '../../../game/shared'; export const value=shared();";
  platformOutput(root,'nalati-grasslands',{'runtime/index.ts':source});
  platformOutput(root,'pine-hollow');
  put('src/shards/pine-hollow/manifest.json','{}');
  // Pine retains its reviewed source discovery; ungrandfathered composed products use the out bank below.
  put('lint/generated-import-debt.json',JSON.stringify({schema:'no-generated-import/1',sources:['src/shards/pine-hollow/discovery.generated.ts']}));
  const path=productManifestPath(root,{slug:'pine-hollow',folder:'pine-hollow',output:null});
  const discovery="import {shared} from '../../game/shared'; export const value=shared();";
  put(path,discovery);
  expect(sourceProgressInventory(root)['nalati-grasslands']?.conversion.gameSystemAttribution.lines).toBe(0);
  unlinkSync(join(root,path));
  expect(()=>sourceProgressInventory(root)).toThrow(`Source census requires generated discovery: ${path}`);
  put(path,discovery);
  expect(sourceProgressInventory(root)['nalati-grasslands']?.conversion.gameSystemAttribution.lines).toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('requires every composed product discovery, not only the representative',()=>{
 const root=mkdtempSync('tmp/platform-composed-inputs-');
 const put=(path:string,text:string):void=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
 try{
  put('src/shards/open-plots/manifest.json','{}');
  put('src/shards/open-plots/outputs.json',JSON.stringify({outputs:[{slug:'open-one'},{slug:'open-two'}]}));
  const first=productManifestPath(root,{slug:'open-one',folder:'open-plots',output:{slug:'open-one'}});
  expect(()=>sourceProgressInventory(root)).toThrow(first);
  put(first,'export const value=1;');
  const second=productManifestPath(root,{slug:'open-two',folder:'open-plots',output:{slug:'open-two'}});
  expect(()=>sourceProgressInventory(root)).toThrow(second);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it.each(['boot/rows.generated','boot/rows.generated.json'])('refuses a missing registered dependency %s',specifier=>{
 const root=mkdtempSync('tmp/platform-required-source-');
 const put=(path:string,text:string):void=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
 try{
  const path=`src/shards/pine-hollow/${specifier}${specifier.endsWith('.json')?'':'.ts'}`;
  platformOutput(root,'pine-hollow',{'runtime/index.ts':`import rows from '../${specifier}'; export const value=rows;`});
  put('scripts/source-generation-outputs.json',JSON.stringify({schema:'source-generation-outputs/1',producers:{'scripts/fixture.mjs':[path]}}));
  expect(()=>sourceProgressInventory(root)).toThrow(`Source census requires generated source: ${path}`);
  put(path,specifier.endsWith('.json')?'{}':'export default 1;');
  expect(()=>sourceProgressInventory(root)).not.toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});

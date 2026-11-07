// oxlint-disable-next-line import/no-nodejs-modules -- Execute only the generated loader in an isolated test context.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- The generator resolves source assets from this repository root.
import process from 'node:process';
import { expect, test } from 'vitest';
import * as ts from '@typescript/typescript6';
import { parseManifestMetadata } from '@wildshard/format/minimap';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';
import { discovery } from './fixtures/pine-discovery';
import metadata from '../src/shards/pine-hollow/manifest.json' with {type:'json'};

function fixture(styles:unknown){return {...metadata,bindings:{...metadata.bindings,entry:{...metadata.bindings.entry,styles}}};}
function loader(source:string,loadModule:(path:string)=>Promise<object>):unknown{
  const file=ts.createSourceFile('entry.ts',source,ts.ScriptTarget.Latest,true);let expression:ts.Expression|undefined;
  const find=(node:ts.Node):void=>{if(ts.isPropertyAssignment(node)&&node.name.getText(file)==='load')expression=node.initializer;ts.forEachChild(node,find);};find(file);
  if(expression===undefined)throw new Error('No generated loader');
  return runInNewContext(`(${expression.getText(file).replaceAll('import(', 'loadModule(')})`,{loadModule},{timeout:1000});
}

test('entry styles are finite own-folder CSS assets and must exist at generation',()=>{
  const good=fixture(['./quest/pinehollow.css']);expect(parseManifestMetadata(good).bindings.entry?.styles).toEqual(['./quest/pinehollow.css']);
  const emitted=authoredManifestSource(process.cwd(),'pine-hollow',{discovery,composed:good});expect(emitted).toContain('import("./quest/pinehollow.css")');
  for(const styles of [['../outside.css'],['./runtime/hybrid.ts'],['https://example.invalid/style.css'],['./quest/pinehollow.css','./quest/pinehollow.css']]){
    expect(()=>parseManifestMetadata(fixture(styles))).toThrow();
    expect(()=>authoredManifestSource(process.cwd(),'pine-hollow',{discovery,composed:fixture(styles)})).toThrow();
  }
  expect(()=>authoredManifestSource(process.cwd(),'pine-hollow',{discovery,composed:fixture(['./quest/missing.css'])})).toThrow('unknown binding module');
});

test('styles finish before the compiled entry, and a failed style never enters it',async()=>{
  const source=authoredManifestSource(process.cwd(),'pine-hollow',{discovery,composed:fixture(['./quest/pinehollow.css'])}),events:string[]=[];
  const load=loader(source,async path=>{
    if(path.endsWith('.css')){events.push('style.start');await Promise.resolve();events.push('style.done');return {};}
    events.push('runtime');return {declaredClientPlanEntry:()=>({ready:true})};
  });
  if(typeof load!=='function')throw new Error('Invalid loader');
  expect(await Reflect.apply(load,undefined,[])).toEqual({ready:true});expect(events.slice(0,2)).toEqual(['style.start','style.done']);
  const calls:string[]=[],failure=new Error('CSS failed'),failed=loader(source,path=>{calls.push(path);return Promise.reject(failure);});
  if(typeof failed!=='function')throw new Error('Invalid failed loader');
  await expect(Reflect.apply(failed,undefined,[])).rejects.toBe(failure);expect(calls).toEqual(['./quest/pinehollow.css']);
});


test('entry styles cannot reopen an authored source-runtime entry',()=>{
  const compiled=fixture(['./quest/pinehollow.css']);
  const input={...compiled,runtimeEntry:'runtime/hybrid.ts',bindings:{...compiled.bindings,entry:{legacy:'./runtime/hybrid',retainHomeRuntime:true,stagesOwner:'runtime',styles:['./quest/pinehollow.css']}}};
  expect(()=>parseManifestMetadata(input)).toThrow();
  expect(()=>authoredManifestSource(process.cwd(),'pine-hollow',{discovery,composed:input,metadataOnly:true})).toThrow();
});

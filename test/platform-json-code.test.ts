import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Minimal isolated source-ruler fixture.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine the fixture to its own directory.
import {dirname,join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- No repository copy or build artifacts.
import {tmpdir} from 'node:os';
import {rawShaderLines,sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';

it('counts decoded shader patches equally in JSON and TypeScript',()=>{
 const rows=[
  {stage:'fragment',find:'#include <map_fragment>',put:'#include <map_fragment>\n diffuseColor.rgb = farSlate(diffuseColor.rgb);'},
  {stage:'fragment',find:'#include <emissivemap_fragment>',put:'#include <emissivemap_fragment>\n totalEmissiveRadiance = farSlate(totalEmissiveRadiance);'},
  {stage:'fragment',find:'',put:'// comment\nvec3 farSlate(vec3 c) { return c; }\n'},
 ];
 const json=JSON.stringify(rows);
 expect(rawShaderLines(json,'data/rocSlate.json')).toBe(7);
 expect(rawShaderLines(`export const rows = ${json};`,'data/rocSlate.ts')).toBe(7);
 expect(rawShaderLines(JSON.stringify(rows,null,2),'data/rocSlate.json')).toBe(7);
 expect(rawShaderLines(JSON.stringify({put:'float shade = 0.5;\n// padding\ndiffuseColor.rgb *= shade;'}),'patch.json')).toBe(2);
});

it('counts executable strings without counting graph data, labels or comments',()=>{
 expect(rawShaderLines(JSON.stringify({
  nested:[{code:'// comment\nconst speed = 2;\n\nreturn speed * dt;',expression:'speed * dt'}],
  callback:'(dt) => {\n tick(dt);\n}',
  text:'ordinary prose (with punctuation)',url:'https://example.com/a.js',label:'road-entry',
  name:'Cart (arba)',title:'Birdwatcher (Aggressive)',outside:'rgb(22,74,128)',
  fill:'rgba(255,240,190,0.35)',styles:['rgba(0,0,0,0)'],
  inputs:[{source:'behaviour/director.as'},{source:'antler-king'}],
  bodies:[{body:'piece:interact-castaway-chest'},{body:'piece:interact-beacon'}],
  graph:{type:'mul',a:'time',b:2},description:'// code sample only',
 }),'data/rules.json')).toBe(6);
});

it('charges authored JSON code to its shard source inventory once',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-json-code-'));
 const put=(path:string,text:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 try{
  platformOutput(root,'far-reach',{'runtime/index.ts':'export const LIVE=1;'});
  put('src/shards/far-reach/data/patch.json',JSON.stringify({put:'#include <map_fragment>\n diffuseColor.rgb *= 0.5;'}));
  put('src/shards/far-reach/generators/script.json',JSON.stringify({code:'const x = 1;\nreturn x;'}));
  put('src/shards/far-reach/data/graph.json',JSON.stringify({nodes:[{id:'colour',type:'color',value:'#abc'}]}));
  put('src/shards/far-reach/data/values.json',JSON.stringify({value:3,label:'hello'}));
  put('src/shards/far-reach/test/ignored.json',JSON.stringify({code:'return 9;'}));
  const row=sourceProgressInventory(root)['far-reach'];
  expect(row?.conversion.customRuntimeLines).toBe(5);
  expect(row?.conversion.shardRuntimeLines).toBe(1);
  expect(row?.customSources?.filter(source=>source.path.endsWith('.json')).map(source=>[source.path,source.lines])).toEqual([
   ['src/shards/far-reach/data/patch.json',2],['src/shards/far-reach/generators/script.json',2],
  ]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

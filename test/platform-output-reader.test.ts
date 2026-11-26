import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated output-admission fixture files.
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths remain within this test's fixture.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small disposable fixture, never a repository copy.
import {tmpdir} from 'node:os';
import {createOutputReader,outputSections} from '../src/scripts/output-reader.mjs';
import {platformOutput} from './fixtures/platformOutputs';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import {emptyShardfile} from '../src/shared/host/author';
import {outputContent} from '../src/scripts/shard-output-content.mjs';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import {hashImmutableBytes} from '../src/shared/host/immutable';

// LD10: a product ships no runtime TypeScript, so the reader verifies only sections and named JSON (copy checks retired)
it('admits registered named JSON, refuses private names and detects corrupt blob bytes',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-output-json-'));
 try{
  platformOutput(root,'brasscap-mesa',{}, {'ui/strings':'{"key":"1"}'});
  expect(outputSections(root,'brasscap-mesa')).toMatchObject({customSectionBytes:0,customSections:[]});
  const indexPath=join(root,'out/brasscap-mesa/shard.json');
  const index=parseOutputIndex(JSON.parse(readFileSync(indexPath,'utf8')));
  const bytes=new TextEncoder().encode('[{"slot":"shape","channels":[],"file":"models/native.bin"}]');
  const blob={name:'models/shape-book.json',path:`blobs/json/${hashImmutableBytes(bytes)}.json`,hash:hashImmutableBytes(bytes),kind:'json',compressed:bytes.length,decoded:bytes.length,gpu:0,triangles:0,draws:0,critical:false,dependencies:[],jsonSchema:registeredJsonSchema('models/shape-book.json')};
  mkdirSync(join(root,'out/brasscap-mesa/blobs/json'),{recursive:true});
  writeFileSync(join(root,'out/brasscap-mesa',blob.path),bytes);
  writeFileSync(indexPath,JSON.stringify({...index,files:[blob]}));
  expect(outputSections(root,'brasscap-mesa')).toMatchObject({customSectionBytes:0,customSections:[]});
  writeFileSync(join(root,'out/brasscap-mesa',blob.path),'[{}]');
  expect(()=>outputSections(root,'brasscap-mesa')).toThrow('named JSON hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('refuses missing products and section corruption instead of reporting zero',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-output-sections-'));
 try{
  expect(()=>outputSections(root,'brasscap-mesa')).toThrow('section inventory missing');
  platformOutput(root,'brasscap-mesa',{}, {'ui/strings':'{"key":"1"}'});
  writeFileSync(join(root,'out/brasscap-mesa/sections/ui/strings.json'),'{}');
  expect(()=>outputSections(root,'brasscap-mesa')).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('scopes verified bytes to one report',()=>{
 const root=mkdtempSync(join('tmp/','platform-output-report-'));
 try{
  platformOutput(root,'brasscap-mesa',{},{'ui/strings':'{"key":"1"}'});
  const report=createOutputReader(root);
  expect(report.sections('brasscap-mesa').sections).toEqual([{name:'ui/strings',value:{key:'1'}}]);
  writeFileSync(join(root,'out/brasscap-mesa/sections/ui/strings.json'),'{}');
  expect(report.sections('brasscap-mesa').sections).toEqual([{name:'ui/strings',value:{key:'1'}}]);
  expect(()=>createOutputReader(root).sections('brasscap-mesa')).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('shares an assembled source within a report and revalidates the next report',()=>{
 const root=mkdtempSync(join('tmp/','platform-output-source-'));
 try{
  const declared=emptyShardfile({slug:'brasscap-mesa',name:'Fixture',author:'Test',revision:1,seed:1});
  platformOutput(root,'brasscap-mesa',{},Object.fromEntries([...outputSectionPayloads(declared)].map(([name,value])=>[name,JSON.stringify(value)])));
  const report=createOutputReader(root),source=report.source('brasscap-mesa');
  outputContent(root,'brasscap-mesa',join(root,'out'),report);
  expect(report.source('brasscap-mesa')).toBe(source);
  expect(createOutputReader(root).source('brasscap-mesa')).not.toBe(source);
  const section=report.sections('brasscap-mesa').index.sections[0];
  if(section===undefined)throw new Error('Missing fixture section');
  writeFileSync(join(root,'out/brasscap-mesa',section.path),'{}');
  expect(()=>createOutputReader(root).source('brasscap-mesa')).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

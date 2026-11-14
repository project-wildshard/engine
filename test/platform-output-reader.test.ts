import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated output-admission fixture files.
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths remain within this test's fixture.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small disposable fixture, never a repository copy.
import {tmpdir} from 'node:os';
import {createOutputReader,outputSections} from '../scripts/output-reader.mjs';
import {platformOutput} from './fixtures/platformOutputs';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import {emptyShardfile} from '../src/shared/host/author';
import {outputContent} from '../scripts/shard-output-content.mjs';
import {nameBlob} from '../src/sharddev/blobs';
import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';

// LD10: a product ships no runtime TypeScript, so the reader verifies only sections and named JSON (copy checks retired)
it('admits registered named JSON, refuses private names and detects corrupt blob bytes',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-output-json-'));
 try{
  platformOutput(root,'_template',{}, {'ui/strings':'{"key":"1"}'});
  expect(outputSections(root,'_template')).toMatchObject({customSectionBytes:0,customSections:[]});
  const indexPath=join(root,'out/_template/shard.json');
  const index=parseOutputIndex(JSON.parse(readFileSync(indexPath,'utf8')));
  const blob=nameBlob('models/shape-book.json','json',new TextEncoder().encode('[{"slot":"shape","channels":[],"file":"models/native.bin"}]'),{jsonSchema:registeredJsonSchema('models/shape-book.json')});
  mkdirSync(join(root,'out/_template/blobs/json'),{recursive:true});
  writeFileSync(join(root,'out/_template',blob.file.path),blob.bytes);
  writeFileSync(indexPath,JSON.stringify({...index,files:[blob.file]}));
  expect(outputSections(root,'_template')).toMatchObject({customSectionBytes:0,customSections:[]});
  const transient=nameBlob('private.json','json',new TextEncoder().encode('{"n":2}'));
  expect(()=>parseOutputIndex({...index,files:[transient.file]})).toThrow('Unregistered named JSON');
  expect(()=>nameBlob('custom/private.bin','bin',new Uint8Array([1]))).toThrow('retired');
  writeFileSync(join(root,'out/_template',blob.file.path),'[{}]');
  expect(()=>outputSections(root,'_template')).toThrow('named JSON hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('refuses missing products and section corruption instead of reporting zero',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-output-sections-'));
 try{
  expect(()=>outputSections(root,'_template')).toThrow('section inventory missing');
  platformOutput(root,'_template',{}, {'ui/strings':'{"key":"1"}'});
  writeFileSync(join(root,'out/_template/sections/ui/strings.json'),'{}');
  expect(()=>outputSections(root,'_template')).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('scopes verified bytes to one report',()=>{
 const root=mkdtempSync(join('tmp/','platform-output-report-'));
 try{
  platformOutput(root,'_template',{},{'ui/strings':'{"key":"1"}'});
  const report=createOutputReader(root);
  expect(report.sections('_template').sections).toEqual([{name:'ui/strings',value:{key:'1'}}]);
  writeFileSync(join(root,'out/_template/sections/ui/strings.json'),'{}');
  expect(report.sections('_template').sections).toEqual([{name:'ui/strings',value:{key:'1'}}]);
  expect(()=>createOutputReader(root).sections('_template')).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('shares an assembled source within a report and revalidates the next report',()=>{
 const root=mkdtempSync(join('tmp/','platform-output-source-'));
 try{
  const declared=emptyShardfile({slug:'template',name:'Fixture',author:'Test',revision:1,seed:1});
  platformOutput(root,'_template',{},Object.fromEntries([...outputSectionPayloads(declared)].map(([name,value])=>[name,JSON.stringify(value)])));
  const report=createOutputReader(root),source=report.source('_template');
  outputContent(root,'_template',join(root,'out'),report);
  expect(report.source('_template')).toBe(source);
  expect(createOutputReader(root).source('_template')).not.toBe(source);
  const section=report.sections('_template').index.sections[0];
  if(section===undefined)throw new Error('Missing fixture section');
  writeFileSync(join(root,'out/_template',section.path),'{}');
  expect(()=>createOutputReader(root).source('_template')).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});

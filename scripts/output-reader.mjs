// G450: the product, not an authoring folder, is the only output census input. LD10 retired the copied-runtime
// reader: a product ships no runtime TypeScript, so only its verified sections and named JSON are read.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { outputFormat, platformFileFamiliesFormat } from './node-format.mjs';
import { shardOutputs } from './shard-outputs.mjs';

const {parseOutputIndex}=outputFormat;
const {validatePlatformFile}=platformFileFamiliesFormat;
const digest = value => createHash('sha256').update(value).digest('hex');
/** One immutable report shares verified bytes, never a process-wide verdict.
 * @param {string} root @param {string} [products] */
export function createOutputReader(root,products=resolve(root,'out')) {
  const sections=new Map(),sources=new Map();
  const readSections=slug=>{
    if(!sections.has(slug))sections.set(slug,outputSections(root,slug,products));
    return sections.get(slug);
  };
  const readSource=slug=>{
    if(!sources.has(slug)){
      const output=readSections(slug);
      sources.set(slug,outputFormat.assembleOutputShardfile(output.index,new Map(output.sections.map(row=>[row.name,row.value]))));
    }
    return sources.get(slug);
  };
  return {sections:readSections,source:readSource};
}


/** Verified data-selected host roots do not require a closed client runtime.
 * The source-progress caller builds every product first. Missing products refuse:
 * treating an absent shard as zero users changes G294 attribution on mirror sync.
 * Corrupt section bytes also refuse rather than grant a user.
 * @param {string} root @param {string} slug @param {string} [products] */
export function outputSections(root,slug,products=resolve(root,'out')) {
  if(!/^[a-z0-9_-]+$/u.test(slug))throw new Error('Invalid output shard slug');
  // SF88g: a source shard that emits several outputs is ONE shard: its inventory is the union of its outputs' sections
  // (each output verified like any product; a section name counts once), its private JSON the sum of theirs.
  const outputs=shardOutputs(root,slug);
  if(outputs!==null) {
    if(outputs.length===0)throw new Error(`${slug}: section inventory missing; build every shard before measuring`);
    const rows=outputs.map(output=>folderSections(output.slug,products)),first=rows[0];
    const named=new Map();
    for(const row of rows)for(const section of row.sections)if(!named.has(section.name))named.set(section.name,section);
    return {index:first.index,sections:[...named.values()],customSections:rows.flatMap(row=>row.customSections),customSectionBytes:rows.reduce((sum,row)=>sum+row.customSectionBytes,0)};
  }
  return folderSections(slug,products);
}
/** One built product's verified sections. @param {string} slug @param {string} products */
function folderSections(slug,products) {
  const folder=resolve(products,slug), indexPath=resolve(folder,'shard.json');
  if(!existsSync(indexPath))throw new Error(`${slug}: section inventory missing; build every shard before measuring`);
  const index=parseOutputIndex(JSON.parse(readFileSync(indexPath,'utf8')));
  if(index.identity.slug!==(slug==='_template'?'template':slug))throw new Error(`${slug}: output identity mismatch`);
  let customSectionBytes=0;const sections=[],customSections=[];
  for(const section of index.sections) {
    const content=readFileSync(resolve(folder,section.path));
    if(content.length!==section.bytes||digest(content)!==section.hash)throw new Error(`${slug}: section hash/size mismatch: ${section.name}`);
    if(section.name.startsWith('custom/')){customSectionBytes+=content.length;customSections.push({name:section.name,bytes:content.length});}
    sections.push({name:section.name,value:JSON.parse(content.toString('utf8'))});
  }
  // G988: only a registered shared family escapes the custom ceiling. Its
  // defining native grammar checks the original bytes; private JSON still counts.
  for(const file of index.files.filter(row=>row.kind==='json'&&row.name!==undefined)) {
    const content=readFileSync(resolve(folder,file.path));
    if(content.length!==file.compressed||digest(content)!==file.hash)throw new Error(`${slug}: named JSON hash/size mismatch: ${file.name}`);
    const value=JSON.parse(content.toString('utf8'));
    const source=file.jsonSchema?.$comment;
    if(validatePlatformFile(file.name,typeof source==='string'?source:undefined,value)!==undefined)continue;
    customSectionBytes+=content.length;customSections.push({name:file.name,bytes:content.length,...(file.jsonSchema===undefined?{}:{jsonSchema:file.jsonSchema})});
  }
  return {index,sections,customSections,customSectionBytes};
}

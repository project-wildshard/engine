import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Check the complete first-party catalogue before publishing any browser verdict.
 * @param {string} revision @param {string} [directory] */
export function buildValidationReceipts(revision, directory = 'out') {
  if (!existsSync(directory)) return [];
  /** @type {unknown[]} */
  const receipts = [];
  for (const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    const receiptPath=join(directory,entry.name,'validation.json'),sourcePath=join(directory,entry.name,'shard.json');
    if(!existsSync(receiptPath)||!existsSync(sourcePath))throw new Error(`Missing output validation receipt: ${entry.name}`);
    const bytes=readFileSync(sourcePath),index=/** @type {unknown} */(JSON.parse(bytes.toString('utf8'))),receipt=/** @type {unknown} */(JSON.parse(readFileSync(receiptPath,'utf8')));
    if(typeof index!=='object'||index===null||!('format' in index)||index.format!=='wildshard.shardfile'||!('formatVersion' in index)||index.formatVersion!==2||!('build' in index)||typeof index.build!=='object'||index.build===null||!('sourceHash' in index.build)||typeof index.build.sourceHash!=='string')throw new Error(`Invalid validated output index: ${entry.name}`);
    if(typeof receipt!=='object'||receipt===null||!('revision' in receipt)||receipt.revision!==revision||!('indexHash' in receipt)||receipt.indexHash!==createHash('sha256').update(bytes).digest('hex')||!('sourceHash' in receipt)||receipt.sourceHash!==index.build.sourceHash)throw new Error(`Stale output validation receipt: ${entry.name}`);
    if(!('residentBytes' in receipt)||typeof receipt.residentBytes!=='number'||!Number.isSafeInteger(receipt.residentBytes)||receipt.residentBytes<=0)throw new Error(`Missing build-owned source residency: ${entry.name}`);
    const postCost='postCost' in receipt?receipt.postCost:undefined;
    if(typeof postCost!=='object'||postCost===null||!('passes' in postCost)||typeof postCost.passes!=='number'||!Number.isSafeInteger(postCost.passes)||postCost.passes<0||!('instructions' in postCost)||typeof postCost.instructions!=='number'||!Number.isFinite(postCost.instructions)||postCost.instructions<0||!('inputs' in postCost)||typeof postCost.inputs!=='object'||postCost.inputs===null||!('colour' in postCost.inputs)||typeof postCost.inputs.colour!=='boolean'||!('depth' in postCost.inputs)||typeof postCost.inputs.depth!=='boolean'||!('normal' in postCost.inputs)||typeof postCost.inputs.normal!=='boolean')throw new Error(`Missing build-owned post cost: ${entry.name}`);
    receipts.push({ revision: receipt.revision, sourceHash: receipt.sourceHash, indexHash: receipt.indexHash, residentBytes:receipt.residentBytes,postCost,path: `/shardfiles/${entry.name}/shard.json`,
      ...('worst' in receipt ? { worst: receipt.worst } : {}) });
  }
  return receipts;
}

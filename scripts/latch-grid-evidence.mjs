#!/usr/bin/env node
// G560: numbers live in the latch. --commit optionally retains historical Git provenance.
// node scripts/latch-grid-evidence.mjs --receipt=tmp/run/receipt.json --shards=a,b
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as v from 'valibot';
import {GRID_READY_LATCHES,GridReadyLatchesSchema} from './grid-ready-latches.mjs';
import {runtimeGridEvidence} from './grid-runtime-evidence.mjs';
import {formatSource} from './format-package.mjs';

/** Qualify fresh observations independently of existing latches, then retain numbers inline.
 * Existing passes are immutable here; regression removal remains manual.
 * @param {string} root @param {string} receipt @param {string} receiptCommit @param {string[]} shards */
export function latchGridEvidence(root,receipt,receiptCommit,shards) {
 if(!receipt||receiptCommit!==''&&!/^[a-f0-9]{40}$/u.test(receiptCommit)||shards.length===0||shards.some(slug=>slug===''))throw new Error('Requires --receipt, --shards and optionally a full --commit');
 const bytes=readFileSync(resolve(root,receipt));
 if(receiptCommit!==''&&!bytes.equals(execFileSync('git',['show',`${receiptCommit}:${receipt}`],{cwd:root})))throw new Error('Receipt differs from its committed observation');
 const observation=JSON.parse(bytes.toString('utf8')),source=observation.source??observation.sha;
 if(typeof source!=='string'||!/^[a-f0-9]{40}$/u.test(source))throw new Error('Missing measured source SHA');
 const path=resolve(root,GRID_READY_LATCHES);
 const latches=v.parse(GridReadyLatchesSchema,existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{schema:'grid-ready-latches/1',entries:[]});
 const caps=JSON.parse(readFileSync(formatSource(root,'memoryGates.json'),'utf8'));
 mkdirSync(resolve(root,'tmp'),{recursive:true});const scratch=mkdtempSync(resolve(root,'tmp/grid-latch-'));
 let added=0;
 try {
  for(const shard of shards) {
   const criteria=runtimeGridEvidence(root,shard,source,[receipt],caps,false);
   for(const criterion of /** @type {const} */ (['memory','oneFrameLooks'])) {
    if(latches.entries.some(row=>row.shard===shard&&row.criterion===criterion)||criteria[criterion]?.verdict!=='pass')continue;
    // Re-use the same grader for each run, so ignored profiles or incomplete
    // samples cannot supply the inline numbers of a qualified pass.
    let measured;
    if(criterion==='memory'&&observation.schema===3)measured={when:observation.driveStarted,surface:observation.surface,
     metrics:{seconds:observation.seconds,circuits:observation.circuits,playingPeakBytes:observation.grade.peakBytes,loadingPeakBytes:observation.grade.loadingPeakBytes}};
    for(const run of [...(observation.runs??[])].sort((a,b)=>Date.parse(b.when)-Date.parse(a.when))) {
     const single=resolve(scratch,'receipt.json');writeFileSync(single,JSON.stringify({...observation,runs:[run]}));
     if(runtimeGridEvidence(root,shard,source,[single],caps,false)[criterion]?.verdict!=='pass')continue;
     /** @type {Record<string,number>} */
     const metrics={};
     if(criterion==='memory') {
      for(const [key,value] of Object.entries(run.memory??{}))if(typeof value==='number'&&Number.isFinite(value)&&value>=0)metrics[key]=value;
     } else for(const scene of run.cases) {
      const names=scene.routes.filter(route=>(route.after.slug??route.after.current)===shard).map(route=>`grid-${route.name}`);
      for(const row of scene.rows.filter(window=>names.some(name=>window.name===name||window.name===`${name}-drive`||window.name===`${name}-travel`))) {
       for(const key of ['frames','maxMs','worstMs','p95Ms','medianFps','skipped'])if(typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0)metrics[`${row.name}.${key}`]=row[key];
      }
     }
     measured={when:run.when,surface:run.surface,metrics};break;
    }
    if(measured===undefined)throw new Error(`Missing inline measurement for ${shard} ${criterion}`);
    latches.entries.push({shard,criterion,source,measurement:measured,latchedAt:new Date().toISOString(),
     ...(receiptCommit===''?{}:{receiptCommit,receipt}),
     ...(typeof observation.protocol?.quiet==='boolean'?{quiet:observation.protocol.quiet}:{})});
    console.info(`Latched ${shard} ${criterion} with inline numbers`);added++;
   }
  }
  latches.entries.sort((a,b)=>a.shard.localeCompare(b.shard)||a.criterion.localeCompare(b.criterion));
  v.parse(GridReadyLatchesSchema,latches);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,`${JSON.stringify(latches,null,2)}\n`);
 } finally {rmSync(scratch,{recursive:true,force:true});}
 return added;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const arg=key=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3)??'';
 latchGridEvidence(resolve(import.meta.dirname,'..'),arg('receipt'),arg('commit'),arg('shards').split(','));
}

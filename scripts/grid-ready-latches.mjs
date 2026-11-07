import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as v from 'valibot';

export const GRID_READY_LATCHES='progress/shard-platform/grid-ready-latches.json';
const sha=v.pipe(v.string(),v.regex(/^[a-f0-9]{40}$/u));
const measurement=v.strictObject({when:v.string(),surface:v.string(),metrics:v.record(v.string(),v.pipe(v.number(),v.finite(),v.minValue(0)))});
export const GridReadyLatchesSchema=v.pipe(v.strictObject({schema:v.literal('grid-ready-latches/1'),entries:v.array(v.pipe(v.strictObject({
 shard:v.string(),criterion:v.picklist(['memory','oneFrameLooks']),source:sha,receiptCommit:v.optional(sha),receipt:v.optional(v.string()),latchedAt:v.string(),quiet:v.optional(v.boolean()),measurement:v.optional(measurement),
}),v.check(row=>(row.receiptCommit===undefined)===(row.receipt===undefined),'Receipt commit and path must be paired'),
 v.check(row=>row.measurement!==undefined||row.receipt!==undefined,'A latch requires inline measurements or a historical receipt')))}),v.check(value=>new Set(value.entries.map(row=>`${row.shard}:${row.criterion}`)).size===value.entries.length,'Duplicate grid-ready latch'));

/** A measured pass is trusted until a person removes its entry for a real regression (G560).
 * Product changes, runtime changes, receipt checksums and later failing samples never expire a latch.
 * An exact revision reads Git objects, including inside a build mirror which omits progress/.
 * Only this explicit read ignores Git's mirror discovery ceiling; it never reads HEAD or the index.
 * @param {string} root @param {string} slug @param {string|null} [revision]
 * @returns {Partial<Record<'memory'|'oneFrameLooks',import('./shard-milestones.mjs').Criterion>>} */
export function latchedGridEvidence(root,slug,revision=null) {
 let text;
 if(revision===null) {
  const path=resolve(root,GRID_READY_LATCHES);if(!existsSync(path))return {};
  text=readFileSync(path,'utf8');
 } else {
  if(!v.is(sha,revision))return {};
  // The ceiling prevents generic tools stamping the outer checkout's moving
  // HEAD. This command names only the caller's immutable tree and latch path.
  const env={...process.env,GIT_CEILING_DIRECTORIES:''};
  delete env.GIT_DIR;delete env.GIT_WORK_TREE;delete env.GIT_INDEX_FILE;
  // Synthetic or unavailable revisions must not trigger a promisor fetch.
  // Keep lazy fetching enabled below for a known commit's promised latch blob.
  const commit=spawnSync('git',['-C',root,'cat-file','-e',`${revision}^{commit}`],{env:{...env,GIT_NO_LAZY_FETCH:'1'},encoding:'utf8'});
  if(commit.error)throw commit.error;
  if(commit.status!==0)return {};
  const result=spawnSync('git',['-C',root,'show',`${revision}:${GRID_READY_LATCHES}`],{env,encoding:'utf8',maxBuffer:5_000_000});
  if(result.error)throw result.error;
  if(result.status!==0)return {};
  text=result.stdout;
 }
 const latches=v.parse(GridReadyLatchesSchema,JSON.parse(text));
 return Object.fromEntries(latches.entries.filter(row=>row.shard===slug).map(row=>[row.criterion,{verdict:'pass',
  evidence:`${GRID_READY_LATCHES}: latched G560 pass; source ${row.source}; ${row.measurement===undefined?'historical measurement':`inline measurement ${JSON.stringify(row.measurement)}`}${row.receipt===undefined?'':`; receipt ${row.receiptCommit}:${row.receipt}`}${row.quiet===undefined?'':`; quiet ${row.quiet}`}; retained until manual regression removal`} ]));
}

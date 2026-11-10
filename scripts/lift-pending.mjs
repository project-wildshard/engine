import {createHash} from 'node:crypto';
import {appendFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {resolveLiftBatches} from './lift-pending-batches.mjs';

/** One finite migration owner applies explicitly to every committed path.
 * This is not the J193 flaky cohort and confers no execution qualification.
 * @param {string} [root] @param {number} [now] */
export function readLiftPending(root,now){
 const directory=root??process.cwd();
 const checkedAt=now??Date.now();
 const bytes=readFileSync(resolve(directory,'test/lift-pending.json'));
 /** @type {unknown} */const files=JSON.parse(bytes.toString('utf8'));
 /** @type {unknown} */const value=JSON.parse(readFileSync(resolve(directory,'test/lift-pending-policy.json'),'utf8'));
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Missing lift-pending ownership policy');
 const policy=/** @type {Record<string,unknown>} */(value);
 if(policy.schema!==1||typeof policy.owner!=='string'||!/^codex-[a-z0-9-]+$/u.test(policy.owner)
  ||typeof policy.registeredAt!=='string'||typeof policy.deadline!=='string'||typeof policy.reason!=='string'||policy.reason.length<40
  ||policy.inventorySha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Lift-pending policy must own the exact committed inventory');
 const registered=Date.parse(policy.registeredAt),deadline=Date.parse(policy.deadline);
 if(!Number.isFinite(registered)||!Number.isFinite(deadline)||registered>checkedAt||deadline<=registered||deadline-registered>48*3_600_000)
  throw new Error('Lift-pending migration must have a fixed deadline within 48 hours');
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd:directory,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
 if(git(['rev-parse','--is-shallow-repository'])!=='false')throw new Error('Lift-pending ownership requires complete introducing history');
 const introduced=git(['log','--reverse','--diff-filter=A','--format=%H','--','test/lift-pending-policy.json']).split('\n')[0];
 if(introduced===undefined||introduced==='')throw new Error('Lift-pending policy has no committed introduction');
 /** @type {unknown} */const original=JSON.parse(git(['show',`${introduced}:test/lift-pending-policy.json`]));
 const admitted=Number(git(['show','-s','--format=%ct',introduced]))*1000;
 if(original===null||typeof original!=='object'||!('deadline'in original)||policy.deadline!==original.deadline||registered!==admitted)
  throw new Error('Lift-pending registration must match its first introducing commit and immutable original deadline');
 // J200: one recorded extension, at most 48 hours past the immutable original
 // deadline, carrying Jake's decision and its evidence. Once committed it is
 // frozen: the first commit that introduced it is the only extension allowed.
 let effective=deadline,effectiveDeadline=policy.deadline;
 if('extension'in policy){
  const extension=policy.extension;
  if(extension===null||typeof extension!=='object'||Array.isArray(extension))throw new Error('Lift-pending extension must be one recorded J200 decision');
  const record=/** @type {Record<string,unknown>} */(extension);
  if(record.rule!=='J200'||record.decidedBy!=='Jake'||typeof record.decidedAt!=='string'||!Number.isFinite(Date.parse(record.decidedAt))
   ||typeof record.decision!=='string'||record.decision.length<10||typeof record.evidence!=='string'||record.evidence.length<10
   ||typeof record.reason!=='string'||record.reason.length<40||typeof record.deadline!=='string')
   throw new Error('Lift-pending extension must record rule J200, Jake\'s decision, its date, evidence and a reason');
  effective=Date.parse(record.deadline);effectiveDeadline=record.deadline;
  if(!Number.isFinite(effective)||effective<=deadline||effective-deadline>48*3_600_000)
   throw new Error('Lift-pending extension must move the original deadline later by at most 48 hours (J200)');
  const added=git(['log','--reverse','--format=%H','-G','"extension"','--','test/lift-pending-policy.json']).split('\n')[0];
  if(added===undefined||added==='')throw new Error('Lift-pending extension has no committed introduction');
  /** @type {unknown} */const first=JSON.parse(git(['show',`${added}:test/lift-pending-policy.json`]));
  if(first===null||typeof first!=='object'||!('extension'in first)||JSON.stringify(first.extension)!==JSON.stringify(extension))
   throw new Error('Lift-pending allows one extension; it is immutable once committed');
 }
 if(!Array.isArray(files)||files.some(file=>typeof file!=='string'||! /^(?:src|test)\/[a-zA-Z0-9_./-]+\.test\.(?:ts|mjs)$/u.test(file))||new Set(files).size!==files.length)
  throw new Error('Invalid lift-pending inventory');
 const paths=/** @type {string[]} */(files);
 if('batchSchedule'in policy){
  const batch=resolveLiftBatches(policy.batchSchedule,paths,{priorDeadline:effectiveDeadline,...(now===undefined?{}:{now}),git});
  return {owner:policy.owner,originalDeadline:policy.deadline,extended:effective!==deadline,reason:policy.reason,files:paths,...batch};
 }
 // Git validation can itself cross the deadline. Only an explicitly supplied
 // observation time stays fixed; the ordinary loader decides after validation.
 return {owner:policy.owner,deadline:effectiveDeadline,originalDeadline:policy.deadline,extended:effective!==deadline,reason:policy.reason,files:paths,excluded:(now??Date.now())<effective?paths:[],batches:[]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const policy=readLiftPending();
 console.log(JSON.stringify({...policy,files:policy.files.map(file=>{
  const batch=policy.batches.find(item=>item.files.includes(file));
  return {file,owner:batch?.owner??policy.owner,deadline:batch===undefined?policy.deadline:batch.deadline,...(batch===undefined?{}:{batch:batch.id,waitingFor:batch.waitingFor})};
 }),excluded:policy.excluded.length}));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `\n### Inherited lift migration debt\n\n${policy.excluded.length} of ${policy.files.length} listed files remain excluded. Registration is not execution proof. ${policy.batches.length===0?`Owner ${policy.owner}, fixed deadline ${policy.deadline}. Expiry restores blocking discovery.`:`J237: a missed batch deadline fails the run; waiting batches activate only from their first committed enabler landing.\n\n${policy.batches.filter(batch=>batch.files.length>0).map(batch=>`- ${batch.id}: ${batch.files.length} pending, owner ${batch.owner}, ${batch.deadline??`waiting for ${batch.waitingFor.join(', ')}`}`).join('\n')}`}\n`);
}

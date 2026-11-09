import {createHash} from 'node:crypto';
import {appendFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** One finite migration owner applies explicitly to every committed path.
 * This is not the J193 flaky cohort and confers no execution qualification.
 * @param {string} [root] @param {number} [now] */
export function readLiftPending(root=process.cwd(),now=Date.now()){
 const bytes=readFileSync(resolve(root,'test/lift-pending.json'));
 /** @type {unknown} */const files=JSON.parse(bytes.toString('utf8'));
 /** @type {unknown} */const value=JSON.parse(readFileSync(resolve(root,'test/lift-pending-policy.json'),'utf8'));
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Missing lift-pending ownership policy');
 const policy=/** @type {Record<string,unknown>} */(value);
 if(policy.schema!==1||typeof policy.owner!=='string'||!/^codex-[a-z0-9-]+$/u.test(policy.owner)
  ||typeof policy.registeredAt!=='string'||typeof policy.deadline!=='string'||typeof policy.reason!=='string'||policy.reason.length<40
  ||policy.inventorySha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Lift-pending policy must own the exact committed inventory');
 const registered=Date.parse(policy.registeredAt),deadline=Date.parse(policy.deadline);
 if(!Number.isFinite(registered)||!Number.isFinite(deadline)||registered>now||deadline<=registered||deadline-registered>48*3_600_000)
  throw new Error('Lift-pending migration must have a fixed deadline within 48 hours');
 if(!Array.isArray(files)||files.some(file=>typeof file!=='string'||! /^(?:src|test)\/[a-zA-Z0-9_./-]+\.test\.(?:ts|mjs)$/u.test(file))||new Set(files).size!==files.length)
  throw new Error('Invalid lift-pending inventory');
 return {owner:policy.owner,deadline:policy.deadline,reason:policy.reason,files:/** @type {string[]} */(files),excluded:now<deadline?/** @type {string[]} */(files):[]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const policy=readLiftPending();
 console.log(JSON.stringify({...policy,files:policy.files.map(file=>({file,owner:policy.owner,deadline:policy.deadline})),excluded:policy.excluded.length}));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `\n### Inherited lift migration debt\n\n${policy.excluded.length} of ${policy.files.length} listed files remain excluded, owner ${policy.owner}, fixed deadline ${policy.deadline}. Registration is not execution proof. Expiry restores blocking discovery.\n`);
}

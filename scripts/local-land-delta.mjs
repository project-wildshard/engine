// J400 FL5b: prove a disjoint rebase, then select the incoming main delta.
import {execFileSync} from 'node:child_process';
import * as v from 'valibot';
import {readPriorFullProof} from './push-proof-cache.mjs';
import {pushSelection} from './push-selection.mjs';

const sha=v.pipe(v.string(),v.regex(/^[a-f0-9]{40}$/u));
const basisSchema=v.object({baseMain:sha,testedHead:sha,incomingMain:sha,head:sha});

/** @param {NonNullable<ReturnType<typeof import('./push-proof-cache.mjs').capturePushTree>>|null} context
 * @param {unknown} raw */
export function localDeltaPlan(context,raw){
 /** @param {string} reason */
 const full=reason=>({eligible:false,reason,selection:null,proof:null});
 const decoded=v.safeParse(basisSchema,raw);
 if(context===null||!decoded.success)return full('No valid local full-gate basis');
 const basis=decoded.output;
 if(context.commit!==basis.head)return full('Rebased HEAD differs from the claimed basis');
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd:context.root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  for(const [older,newer] of [[basis.baseMain,basis.testedHead],[basis.baseMain,basis.incomingMain],[basis.incomingMain,basis.head]])
   git(['merge-base','--is-ancestor',older,newer]);
  /** @param {string} a @param {string} b */
  const paths=(a,b)=>git(['diff','--name-only','--no-renames','-z',a,b]).split('\0').filter(Boolean);
  const own=new Set(paths(basis.baseMain,basis.testedHead)),delta=paths(basis.baseMain,basis.incomingMain);
  if(delta.some(file=>own.has(file)))return full('Incoming main overlaps branch-changed paths');
  /** @param {string} a @param {string} b */
  const patch=(a,b)=>git(['diff','--raw','--no-abbrev','--no-renames','-z',a,b]);
  if(patch(basis.baseMain,basis.testedHead)!==patch(basis.incomingMain,basis.head))return full('Replayed branch content changed');
  const proof=readPriorFullProof(context,basis.testedHead);
  if(proof===null)return full('No matching current-runtime full proof for the tested tree');
  if(proof.inherited!==undefined)return full('A composed proof cannot replace a directly completed full gate');
  return {eligible:true,reason:`Full proof ${proof.run}; disjoint incoming main delta`,proof,
   selection:pushSelection(`refs/heads/main ${basis.incomingMain} refs/heads/main ${basis.baseMain}`,context.root,{hosted:true})};
 }catch{return full('Cannot prove the complete disjoint rebase history');}
}

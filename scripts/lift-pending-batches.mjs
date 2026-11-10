// J237 applies only to the inherited CI21 inventory, never flaky quarantine.
/** @typedef {{repository:string,commit:string,landedAt:string,evidence:string}} Landing */
/** @typedef {{id:string,owner:string,members:string[],requires:string[],windowHours:number,deadline:string|null}} Batch */
/** @typedef {{schema:string,rule:string,decidedBy:string,decidedAt:string,evidence:string,startsAfter:string,sourceMap:{repository:string,revision:string,sha256:string},landings:Record<string,Landing|null>,batches:Batch[]}} Schedule */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** @param {unknown} value @returns {value is string[]} */
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string')&&new Set(value).size===value.length;
/** @param {unknown} value @returns {value is string} */
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
/** @param {unknown} value @returns {Schedule} */
function parse(value){
 if(!record(value)||value.schema!=='ci21-batches/1'||value.rule!=='J237'||value.decidedBy!=='Jake'||!date(value.decidedAt)
  ||typeof value.evidence!=='string'||value.evidence.length<20||!date(value.startsAfter)||!record(value.sourceMap)
  ||value.sourceMap.repository!=='Raynos/project-wildshard-meta'||typeof value.sourceMap.revision!=='string'||!/^[a-f0-9]{40}$/u.test(value.sourceMap.revision)
  ||typeof value.sourceMap.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(value.sourceMap.sha256)||!record(value.landings)||!Array.isArray(value.batches))
  throw new Error('CI21 batch schedule requires the recorded J237 decision and committed port-map identity');
 const ids=Object.keys(value.landings);
 if(ids.length===0||ids.some(id=>!/^CI21-H[1-9]\d*$/u.test(id)))throw new Error('Invalid CI21 enabler registry');
 for(const landing of Object.values(value.landings))if(landing!==null&&(!record(landing)
  ||typeof landing.repository!=='string'||!/^project-wildshard\/[a-z0-9-]+$/u.test(landing.repository)
  ||typeof landing.commit!=='string'||!/^[a-f0-9]{40}$/u.test(landing.commit)||!date(landing.landedAt)
  ||typeof landing.evidence!=='string'||landing.evidence.length<20))throw new Error('CI21 enabler landing needs repository, commit, date and evidence');
 /** @type {string[]} */const allMembers=[];
 /** @type {string[]} */const batchIds=[];
 for(const batch of value.batches){
  if(!record(batch)||typeof batch.id!=='string'||! /^[A-Z0-9-]+$/u.test(batch.id)||typeof batch.owner!=='string'||! /^[a-z][a-z0-9-]+$/u.test(batch.owner)
   ||!strings(batch.members)||batch.members.some(file=>! /^(?:src|test)\/[a-zA-Z0-9_./-]+\.test\.(?:ts|mjs)$/u.test(file))
   ||!strings(batch.requires)||batch.requires.some(id=>!ids.includes(id))||typeof batch.windowHours!=='number'||!Number.isSafeInteger(batch.windowHours)||batch.windowHours<1
   ||batch.deadline!==null&&!date(batch.deadline))throw new Error('Invalid CI21 batch membership, owner, dependencies or dated window');
  allMembers.push(...batch.members);batchIds.push(batch.id);
 }
 if(new Set(allMembers).size!==allMembers.length||new Set(batchIds).size!==batchIds.length)throw new Error('CI21 batches must own each inherited file exactly once');
 return /** @type {Schedule} */(value);
}
/** @param {Batch} batch @param {Schedule} schedule */
function due(batch,schedule){
 const landings=batch.requires.map(id=>schedule.landings[id]);
 if(landings.some(landing=>landing===null))return null;
 const ready=Math.max(Date.parse(schedule.startsAfter),...landings.map(landing=>{
  if(landing===undefined||landing===null)throw new Error('Unknown CI21 enabler');return Date.parse(landing.landedAt);
 }));
 const value=new Date(ready+batch.windowHours*3_600_000);
 if(!Number.isFinite(value.getTime()))throw new Error('CI21 batch deadline is out of range');
 return value.toISOString();
}
/** Authoring helper only: date ready batches, never invent an enabler landing.
 * The normal loader validates introducing history after the edit is committed.
 * @param {unknown} value @returns {Schedule} */
export function dateLiftBatches(value){
 const schedule=structuredClone(parse(value));
 for(const batch of schedule.batches)batch.deadline=due(batch,schedule);
 return schedule;
}
/** @param {Schedule} schedule */
const fixed=schedule=>JSON.stringify({schema:schedule.schema,rule:schedule.rule,decidedBy:schedule.decidedBy,decidedAt:schedule.decidedAt,evidence:schedule.evidence,
 startsAfter:schedule.startsAfter,sourceMap:schedule.sourceMap,enablers:Object.keys(schedule.landings).sort(),
 batches:schedule.batches.map(batch=>({id:batch.id,owner:batch.owner,members:[...batch.members].sort(),requires:[...batch.requires].sort(),windowHours:batch.windowHours})).sort((a,b)=>a.id.localeCompare(b.id))});
/** @param {Landing} landing */
const landingIdentity=landing=>JSON.stringify({repository:landing.repository,commit:landing.commit,landedAt:landing.landedAt,evidence:landing.evidence});

/** @param {unknown} value @param {string[]} files
 * @param {{priorDeadline:string,now?:number,git:(args:string[])=>string}} context */
export function resolveLiftBatches(value,files,context){
 const schedule=parse(value),checkedAt=context.now??Date.now();
 if(Date.parse(schedule.startsAfter)!==Date.parse(context.priorDeadline)||Date.parse(schedule.decidedAt)>checkedAt)
  throw new Error('J237 starts after the immutable first extension and needs an actual decision date');
 const {git}=context,path='test/lift-pending-policy.json';
 const introduced=git(['log','--reverse','--format=%H','-G','"batchSchedule"','--',path]).split('\n')[0];
 if(introduced===undefined||introduced==='')throw new Error('CI21 batch schedule needs a committed introduction');
 /** @type {unknown} */const firstPolicy=JSON.parse(git(['show',`${introduced}:${path}`]));
 if(!record(firstPolicy))throw new Error('Invalid first CI21 batch schedule');
 const original=parse(firstPolicy.batchSchedule);
 if(fixed(schedule)!==fixed(original))throw new Error('CI21 batch assignments, windows and decision are immutable; rename or re-add cannot renew a deadline');
 const history=[introduced,...git(['log','--reverse','--format=%H',`${introduced}..HEAD`,'--',path]).split('\n').filter(Boolean)];
 /** @type {Map<string,{landing:Landing,commit:string}>} */const firstLandings=new Map();
 for(const commit of history){
  /** @type {unknown} */const historical=JSON.parse(git(['show',`${commit}:${path}`]));
  if(!record(historical)||!record(historical.batchSchedule))continue;
  const prior=parse(historical.batchSchedule);
  for(const [id,landing] of Object.entries(prior.landings))if(landing!==null&&!firstLandings.has(id))firstLandings.set(id,{landing,commit});
 }
 for(const [id,landing] of Object.entries(schedule.landings)){
  const first=firstLandings.get(id);
  if(landing===null){if(first!==undefined)throw new Error(`CI21 enabler ${id} cannot be reset after landing`);continue;}
  if(first===undefined||landingIdentity(first.landing)!==landingIdentity(landing))throw new Error(`CI21 enabler ${id} must retain its first committed landing`);
  const instant=Date.parse(landing.landedAt),recorded=Number(git(['show','-s','--format=%ct',first.commit]))*1000;
  if(instant>checkedAt||instant>recorded+999)throw new Error(`CI21 enabler ${id} cannot postdate its introducing receipt`);
  if(landing.repository==='project-wildshard/engine'){
   try{git(['merge-base','--is-ancestor',landing.commit,'HEAD']);}
   catch{throw new Error(`CI21 enabler ${id} needs a landed engine commit`);}
   if(Math.abs(Number(git(['show','-s','--format=%ct',landing.commit]))*1000-instant)>999)
    throw new Error(`CI21 enabler ${id} date must match its actual engine commit`);
  }
 }
 const assigned=new Set(schedule.batches.flatMap(batch=>batch.members));
 if(files.some(file=>!assigned.has(file)))throw new Error('Unscheduled file cannot enter the J237 CI21 exclusion');
 const active=new Set(files),observed=context.now??Date.now();
 const batches=schedule.batches.map(batch=>{
  const deadline=due(batch,schedule);
  if(batch.deadline!==deadline)throw new Error(`CI21 batch ${batch.id} date must be derived from its immutable enabler landings`);
  return {id:batch.id,owner:batch.owner,files:batch.members.filter(file=>active.has(file)),deadline,
   waitingFor:batch.requires.filter(id=>schedule.landings[id]===null)};
 });
 const missed=batches.filter(batch=>batch.files.length>0&&batch.deadline!==null&&observed>=Date.parse(batch.deadline));
 if(missed.length>0)throw new Error(`CI21 batch deadline missed: ${missed.map(batch=>`${batch.id} (${batch.files.length} pending, ${batch.deadline}, owner ${batch.owner})`).join('; ')}`);
 const next=batches.flatMap(batch=>batch.files.length>0&&batch.deadline!==null?[Date.parse(batch.deadline)]:[]);
 // Prior-cutoff reuse always expires at the transition. If every remaining
 // batch waits on an enabler, the past cutoff deliberately disables reuse.
 const deadline=observed<Date.parse(schedule.startsAfter)||next.length===0?schedule.startsAfter:new Date(Math.min(...next)).toISOString();
 return {deadline,excluded:[...files],batches};
}

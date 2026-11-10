// Close a published integration with CI21-Enabler: CI21-H2 <source SHA>.
// Source references survive a queued rebase; commit the derived receipt normally.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dateLiftBatches} from './lift-pending-batches.mjs';

const path='test/lift-pending-policy.json';
/** @type {{batchSchedule:unknown}} */const policy=JSON.parse(readFileSync(path,'utf8'));
const schedule=dateLiftBatches(policy.batchSchedule);
/** @param {string[]} args */const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
for(const [id,landing] of Object.entries(schedule.landings)){
 if(landing!==null)continue;
 const marker=git(['log','--reverse','--format=%H',`--grep=^CI21-Enabler: ${id} [0-9a-f]\\{40\\}$`]).split('\n')[0];
 if(!marker)continue;
 const commit=git(['show','-s','--format=%B',marker]).split('\n').find(line=>new RegExp(`^CI21-Enabler: ${id} [a-f0-9]{40}$`,'u').test(line))?.split(' ')[2];
 if(!commit)throw new Error(`Missing ${id} integration source`);
 git(['merge-base','--is-ancestor',commit,marker]);git(['merge-base','--is-ancestor',commit,'refs/remotes/origin/main']);
 schedule.landings[id]={repository:'project-wildshard/engine',commit,landedAt:new Date(Number(git(['show','-s','--format=%ct',commit]))*1000).toISOString(),
  evidence:`First ${id} engine integration https://github.com/project-wildshard/engine/commit/${commit}; integration journal and normal gate bind the published prerequisite and public consumer proof.`};
}
policy.batchSchedule=dateLiftBatches(schedule);
writeFileSync(path,`${JSON.stringify(policy,null,2)}\n`);
console.log('Recorded first CI21-Enabler integration commits and derived dates; commit and validate with node scripts/lift-pending.mjs.');

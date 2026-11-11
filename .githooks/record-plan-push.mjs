// pre-push: remember every commit this worktree tries to push to a plan/* branch (J240). `scripts/land.mjs` may
// rewrite origin's plan branch when origin's tip is exactly one of these SHAs, so a hand push after a hand rebase
// stays this worktree's own. The hook runs before the gate decides, so these are attempts: they never vouch for an
// ancestor (land's own confirmed pushes do). Per worktree (`git rev-parse --git-path wildshard-plan-pushes`), one
// SHA per line, appended. Reads git's ref lines on stdin.
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';

const SHA=/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u,ZERO=/^0+$/u,PLAN=/^refs\/heads\/plan\/[a-z0-9][a-z0-9._-]*$/u;
const pushed=readFileSync(0,'utf8').split('\n').map(line=>line.trim().split(/\s+/u))
  .filter(([,local='',remote=''])=>SHA.test(local)&&!ZERO.test(local)&&PLAN.test(remote)).map(([,local])=>local);
if(pushed.length>0){
  try{
    const file=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','wildshard-plan-pushes'],{encoding:'utf8'}).trim();
    appendFileSync(file,pushed.map(sha=>`${sha}\n`).join(''));
  }catch(error){console.error(`  - plan push record unavailable: ${error instanceof Error?error.message:String(error)}`);}
}

import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real branch history without contacting a remote.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and retire the complete git fixture under repository scratch.
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all fixture paths under the lane's repository scratch.
import {join,resolve} from 'node:path';
import {smallPlanWarning} from '../scripts/.kit/land.mjs';

const BORN='2026-11-15T12:00:00-05:00',LATER='2026-11-15T12:15:00-05:00';
function fixture(commits,check){
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest');
 mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'land-size-'));
 const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
  GIT_AUTHOR_NAME:'Size fixture',GIT_COMMITTER_NAME:'Size fixture',
  GIT_AUTHOR_EMAIL:'size@example.test',GIT_COMMITTER_EMAIL:'size@example.test'};
 for(const key of Object.keys(env))if(key.startsWith('GIT_')&&!['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL'].includes(key))delete env[key];
 const git=(args,date=BORN)=>execFileSync('git',args,{cwd:root,env:{...env,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git(['init','--quiet','--initial-branch=main']);
  git(['commit','--quiet','--allow-empty','-m','seed'],'2020-01-01T00:00:00-05:00');
  git(['update-ref','refs/remotes/origin/main','HEAD']);
  git(['switch','--quiet','-c','plan/small']);
  for(let i=0;i<commits;i++){
   writeFileSync(join(root,`owned-${i}`),String(i));git(['add',`owned-${i}`],LATER);
   git(['commit','--quiet','-m',`own ${i}`],LATER);
  }
  check(root,git,env);
  return root;
 }finally{rmSync(root,{recursive:true,force:true});}
}

test('WL12: two commits on a thirty-minute branch warn using branch birth, not the old base commit',()=>{
 fixture(2,(root,_git,env)=>expect(smallPlanWarning(root,'plan/small',Date.parse(BORN)+30*60_000,env))
  .toBe('WARNING one-row land (J290): commit on main next time (2 commits, 30 min old; J336: land a whole plan once)'));
});

test('WL12: ten commits stay silent even on a young branch',()=>{
 fixture(10,(root,_git,env)=>expect(smallPlanWarning(root,'plan/small',Date.parse(BORN)+30*60_000,env)).toBeNull());
});

test('WL12: the three-hour boundary, future birth and missing history cannot warn',()=>{
 fixture(2,(root,_git,env)=>{
  expect(smallPlanWarning(root,'plan/small',Date.parse(BORN)+3*60*60_000-1,env)).not.toBeNull();
  expect(smallPlanWarning(root,'plan/small',Date.parse(BORN)+3*60*60_000,env)).toBeNull();
  expect(smallPlanWarning(root,'plan/small',Date.parse(BORN)-1,env)).toBeNull();
  expect(smallPlanWarning(root,'plan/missing',Date.parse(BORN)+30*60_000,env)).toBeNull();
  expect(smallPlanWarning(root,'main',Date.parse(BORN)+30*60_000,env)).toBeNull();
 });
});

test('WL12: a branch with no unique commit has no warning',()=>{
 fixture(0,(root,_git,env)=>expect(smallPlanWarning(root,'plan/small',Date.parse(BORN)+30*60_000,env)).toBeNull());
});

test('WL12: expired creation history is unknown rather than a younger commit timestamp',()=>{
 fixture(2,(root,git,env)=>{
  const now=Date.parse(BORN)+30*60_000;
  expect(smallPlanWarning(root,'plan/small',now,env)).not.toBeNull();
  git(['reflog','expire','--expire=2026-11-15T17:01:00Z','refs/heads/plan/small']);
  expect(smallPlanWarning(root,'plan/small',now,env)).toBeNull();
  git(['reflog','expire','--expire=all','refs/heads/plan/small']);
  expect(smallPlanWarning(root,'plan/small',now,env)).toBeNull();
 });
});

test('WL12a: foreign Git input cannot redirect warning fixtures or survive cleanup',()=>{
 const before={...process.env};
 const root=fixture(2,(cwd,_git,env)=>{
  // The actual warning runs in a child with hostile Git variables. Only
  // its explicit clean port can reach this fixture's branch history.
  const program=`import {smallPlanWarning} from ${JSON.stringify(new URL('../scripts/.kit/land.mjs',import.meta.url).href)};
   const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')||['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM'].includes(key)));
   console.log(smallPlanWarning(process.argv[1],'plan/small',Number(process.argv[2]),clean));`;
  const output=execFileSync(process.execPath,['--input-type=module','-e',program,cwd,String(Date.parse(BORN)+30*60_000)],{
   env:{...env,GIT_DIR:resolve('tmp/missing-git'),GIT_WORK_TREE:resolve('tmp/missing-worktree')},encoding:'utf8'});
  expect(output).toContain('WARNING one-row land (J290)');
  expect(process.env).toEqual(before);
 });
 expect(existsSync(root)).toBe(false);
});

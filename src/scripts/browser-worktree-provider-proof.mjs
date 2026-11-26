// A real linked Git worktree and real Vitest runner exercise the private
// policy's canonical path. No physical browser or machine policy is changed.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

await test('browser lane loads its own provider from a linked worktree',()=>{
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/codex-pagesize','browser-worktree');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-')),main=join(root,'main'),worktree=join(root,'linked');
 const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 const git=(/** @type {string[]} */...args)=>execFileSync('git',args,{cwd:main,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 mkdirSync(join(main,'src','scripts'),{recursive:true});
 try{
  writeFileSync(join(main,'package.json'),'{"type":"module","private":true}');
  writeFileSync(join(main,'pnpm-workspace.yaml'),'packages: []\n');
  copyFileSync(resolve('src/scripts/browser-machine-loader.mjs'),join(main,'src/scripts/browser-machine-loader.mjs'));
  writeFileSync(join(main,'src/scripts/browser-machine-policy.mjs'),'export async function install(value){value.provider=import.meta.dirname;}');
  writeFileSync(join(main,'vitest.config.mjs'),'export default {test:{globals:true,pool:"forks",maxWorkers:1,include:["browser.test.mjs"]}};');
  const policy=join(root,'private-policy.json');
  writeFileSync(policy,JSON.stringify({version:1,module:join(main,'src/scripts/browser-machine-policy.mjs')}),{mode:0o600});
  writeFileSync(join(main,'browser.test.mjs'),`import {installMachineBrowserAdmission} from './src/scripts/browser-machine-loader.mjs';
test('the browser lane uses this checkout provider',async()=>{
 const browser={provider:''};
 expect(await installMachineBrowserAdmission(browser,{path:${JSON.stringify(policy)}})).toBe(true);
 expect(browser.provider).toBe(${JSON.stringify(join(worktree,'src','scripts'))});
});\n`);
  git('init','--quiet','-b','main');git('add','--','package.json','pnpm-workspace.yaml','src/scripts/browser-machine-loader.mjs','src/scripts/browser-machine-policy.mjs','vitest.config.mjs','browser.test.mjs');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--quiet','-m','fixture');
  git('worktree','add','--quiet','--detach',worktree,'HEAD');
  const entry=join(dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))),'vitest.mjs');
  const result=spawnSync(process.execPath,[entry,'run','--config',join(worktree,'vitest.config.mjs')],{cwd:worktree,env,encoding:'utf8',timeout:30000});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/1 passed/u);
 }finally{rmSync(root,{recursive:true,force:true});}
});

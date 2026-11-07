// oxlint-disable-next-line import/no-nodejs-modules -- Exercise sparse checkout and the real release reader in tiny owned Git fixtures.
import {execFileSync,spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve actual controller/config bytes and remove only fixture files.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine temporary repositories below tmp.
import {resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';

const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function checkout(name:string):{block:string;patterns:string} {
 const block=workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
 if(block===undefined)throw new Error(`Missing checkout ${name}`);
 const patterns=/^ {10}sparse-checkout: \|\n((?: {12}[^\n]+\n)+)/mu.exec(block)?.[1];
 if(patterns===undefined)throw new Error('Missing sparse policy');
 return {block,patterns:`${patterns.split('\n').map(line=>line.trim()).filter(Boolean).join('\n')}\n`};
}
function fixture() {
 mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/release-checkout-'));owned.push(root);
 const put=(file:string,body:string)=>{mkdirSync(resolve(root,file,'..'),{recursive:true});writeFileSync(resolve(root,file),body);};
 const copied=/cp ([^\n]+) "\$RUNNER_TEMP\/"/u.exec(workflow)?.[1]?.split(' ');
 if(copied===undefined||copied.length===0)throw new Error('Missing copied controllers');
 const top=['package.json','vercel.json','.vercelignore','.gitignore'];
 const kept=[...copied,...top,'.github/deploy-pin.json'];
 const original=new Map(kept.map(file=>[file,readFileSync(file,'utf8')]));
 for(const [file,body] of original)put(file,body);
 const runtime=['src/game/actual.ts','public/assets/actual.bin','api/actual.cjs','scripts/generator/actual.mjs',
  'test/actual.test.ts','docs/actual.md','.github/workflows/deploy.yml'];
 for(const file of [...runtime,'art/unused/input','progress/unused/input','sources/unused/input'])put(file,`fixture:${file}`);
 // A future root CLI config must survive without growing a hand-maintained allowlist.
 put('.future-config','root policy');
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q','-b','main');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
 git('config','core.hooksPath','/dev/null');git('add','-f','.');git('-c','commit.gpgsign=false','commit','-qm','fixture');
 const sha=git('rev-parse','HEAD');
 const select=(patterns:string)=>{git('sparse-checkout','init','--no-cone');execFileSync('git',['sparse-checkout','set','--no-cone','--stdin'],{cwd:root,input:patterns,encoding:'utf8',stdio:['pipe','pipe','pipe']});};
 return {root,original,runtime,copied,sha,select};
}

test('automatic checkout retains actual controllers and every root config without materializing runtime source',()=>{
 const {block,patterns}=checkout('Check out automatic release controller');
 expect(block).toContain("github.event_name == 'push'");expect(block).toContain("env.RELEASE_ALLOWED == 'true'");
 expect(block).toContain('filter: blob:none');expect(block).toContain('sparse-checkout-cone-mode: false');
 const f=fixture();f.select(patterns);
 for(const [file,body] of f.original)expect(readFileSync(resolve(f.root,file),'utf8'),file).toBe(body);
 expect(readFileSync(resolve(f.root,'.future-config'),'utf8')).toBe('root policy');
 for(const file of f.runtime)expect(existsSync(resolve(f.root,file)),file).toBe(false);
});

test('manual and recovery checkout retains the original full build inputs and exclusions',()=>{
 const {block,patterns}=checkout('Check out manual release source');
 expect(block).toContain("github.event_name != 'push'");expect(block).toContain("env.RELEASE_ALLOWED == 'true'");
 const f=fixture();f.select(patterns);
 for(const [file,body] of f.original)expect(readFileSync(resolve(f.root,file),'utf8'),file).toBe(body);
 for(const file of f.runtime)expect(readFileSync(resolve(f.root,file),'utf8'),file).toBe(`fixture:${file}`);
 for(const folder of ['art','progress','sources'])expect(existsSync(resolve(f.root,folder)),folder).toBe(false);
 expect(workflow).toContain("steps.pin.outputs.recovery == 'true'");
 expect(workflow).toContain('vercel build --prod');
});

test('the actual sparse controller admits only its exact successful push and rejects foreign or red proof',()=>{
 const f=fixture();f.select(checkout('Check out automatic release controller').patterns);
 const needs=Object.fromEntries(['prepare','typecheck-lint','behaviour','native-escape','journeys'].map(name=>[name,{result:'success'}]));
 const env={...process.env,GH_TOKEN:'',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',
  GITHUB_REPOSITORY:'project-wildshard/engine',GITHUB_SHA:f.sha,GITHUB_RUN_ID:'123',
  CI_WAVE_NEEDS:JSON.stringify(needs),CI_WAVE_BOOT_OUTCOME:'success',GITHUB_OUTPUT:resolve(f.root,'wave-output')};
 const run=(delta:NodeJS.ProcessEnv={})=>spawnSync(process.execPath,['scripts/deploy-pin.mjs','read-wave'],{
  cwd:f.root,encoding:'utf8',env:{...env,...delta},timeout:5000});
 const actual=run();expect(actual.status,actual.stdout+actual.stderr).toBe(0);
 expect(readFileSync(resolve(f.root,'wave-output'),'utf8')).toContain(`sha=${f.sha}\n`);
 for(const result of ['failure','cancelled','skipped','timed_out']) {
  const red=run({CI_WAVE_NEEDS:JSON.stringify({...needs,behaviour:{result}})});
  expect(red.status).toBe(1);expect(red.stderr).toContain('Wave prerequisite did not succeed');
 }
 const foreign=run({GITHUB_SHA:'f'.repeat(40)});expect(foreign.status).toBe(1);expect(foreign.stderr).toContain('exact main push');
 const publisher=run({CI_WAVE_BOOT_OUTCOME:'failure'});expect(publisher.status).toBe(1);expect(publisher.stderr).toContain('boot publisher');
});

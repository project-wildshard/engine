// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual CI Node glue without starting a browser.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the maintained workflow as the executable source under test.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the maintained Actions condition in a fresh isolated context.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
const section=(name:string)=>workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z][a-z0-9-]*:\n/u)[0]??'';
const dependencies=(source:string):string[]=>{
  const value=/^ {4}needs: (.+)$/mu.exec(source)?.[1];
  if(value===undefined)return [];
  return value.startsWith('[')?value.slice(1,-1).split(',').map(name=>name.trim()):[value];
};

test('draw diagnostics read exact prepared worlds and never join source, boot or ship prerequisites',()=>{
  const diagnostic=section('draw-budget');
  expect(diagnostic).toContain('continue-on-error: true');
  expect(dependencies(diagnostic)).toContain('prepare');
  expect(diagnostic).toContain('runs-on: ubuntu-latest');
  expect(diagnostic).toContain('timeout-minutes: 20');
  for(const name of ['build-and-deploy','journeys']) {
    const needs=/^\s+needs: (.+)$/mu.exec(section(name))?.[1];
    expect(needs).toBeDefined();expect(needs).not.toContain('draw-budget');
  }
  expect(workflow).not.toContain('\n  boot-verdict:\n');
  expect(section('build-and-deploy')).toContain('name: Publish exact-SHA proof outcome');
  expect(diagnostic).toContain('name: boot-dist-worlds');
  expect(diagnostic).toContain('name: boot-dist-manifest');
  const readers=diagnostic.split(/\n {6}- /u).filter(step=>step.includes('actions/download-artifact@'));
  expect(readers.length).toBeGreaterThan(0);
  for(const reader of readers)expect(reader).toContain(`run-id: \${{ github.run_id }}`);
  expect(diagnostic).toContain('python3 scripts/boot-dist.py restore --sha "$TESTED_SHA" --run "$SOURCE_RUN" --part boot-grid');
  expect(diagnostic).not.toContain('serve-build.sh');
  expect(diagnostic).not.toContain('scripts/gen.mjs');
  const upload=diagnostic.split('- name: Retain paired draw budget evidence')[1];
  expect(upload).toContain('if: always()');
  expect(upload).toContain('path: tmp/ci-draw-budget/');
});

test('diagnostics allocate no push runner and still report required PR failures',()=>{
  const diagnostic=section('draw-budget'),shipNeeds=dependencies(section('build-and-deploy'));
  const optionalStage='stage-prebuilt',required=shipNeeds.filter(name=>name!==optionalStage);
  expect(required.length).toBeGreaterThan(0);
  expect(new Set(required)).toEqual(new Set(['prepare','typecheck-lint','behaviour','native-escape','journeys']));
  expect(shipNeeds).toContain(optionalStage);
  expect(dependencies(section(optionalStage))).toEqual(['prepare']);
  expect(section(optionalStage)).toContain('continue-on-error: true');
  expect(new Set(dependencies(diagnostic))).toEqual(new Set(required));
  expect(dependencies(diagnostic)).not.toContain('build-and-deploy');
  expect(dependencies(diagnostic)).not.toContain(optionalStage);
  for(const name of required)expect(dependencies(section(name))).not.toContain('draw-budget');
  const expression=/^ {4}if: \$\{\{ (.+) \}\}$/mu.exec(diagnostic)?.[1];
  if(expression===undefined)throw new Error('Missing actual diagnostic admission');
  const states:Record<string,{result:string}>={};
  for(const name of required)states[name]={result:'success'};
  const evaluate=(event:string,needs:typeof states,cancelled=false):unknown=>runInNewContext(expression,
    {github:{event_name:event},needs,always:()=>true,cancelled:()=>cancelled},{timeout:100});
  expect(evaluate('pull_request',states)).toBe(false);
  for(const event of ['push']){
    expect(evaluate(event,states)).toBe(true);
    for(const result of ['success','failure','cancelled','skipped','pending']){
      expect(evaluate(event,{...states,[optionalStage]:{result}})).toBe(true);
    }
    for(const name of required.filter(dependency=>dependency!=='prepare'))for(const result of ['failure','cancelled','skipped']){
      expect(evaluate(event,{...states,[name]:{result}})).toBe(true);
    }
    for(const result of ['failure','cancelled','skipped','pending']){
      expect(evaluate(event,{...states,prepare:{result}})).toBe(false);
    }
    expect(evaluate(event,states,true)).toBe(false);
  }
  for(const event of ['workflow_dispatch','schedule'])expect(evaluate(event,states)).toBe(false);
});

const executor=String.raw`
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
const record={};
const processStub=Object.assign(new EventEmitter(),{env:{GITHUB_SHA:'a'.repeat(40)},cwd:()=>'/fixture',execPath:process.execPath,exitCode:undefined});
const context=createContext({process:processStub});
const module=new SourceTextModule(readFileSync(0,'utf8'),{context});
await module.link(specifier=>{
  if(specifier==='node:child_process')return new SyntheticModule(['spawn'],function(){
    this.setExport('spawn',(executable,args)=>{
      record.executable=executable;record.args=args;
      const child=new EventEmitter();child.kill=()=>true;
      queueMicrotask(()=>process.env.DRAW_OUTCOME==='error'?child.emit('error',new Error('native child refused'))
        :child.emit('exit',Number(process.env.DRAW_OUTCOME),null));
      return child;
    });
  },{context});
  if(specifier==='./scripts/parity/serve.mjs')return new SyntheticModule(['serve'],function(){
    this.setExport('serve',async(...args)=>{
      record.serve=args;
      return {url:'http://127.0.0.1:4173/',close(){record.closed=true;}};
    });
  },{context});
  throw new Error('Unreviewed workflow dependency '+specifier);
});
try{await module.evaluate();}catch(error){record.error=String(error);}
record.exitCode=processStub.exitCode??null;record.listeners=processStub.eventNames().length;
console.log(JSON.stringify(record));
`;

test('the real report step preserves floor exit codes and closes its built-only server on success or failure',()=>{
  const step=section('draw-budget').split('- name: Report paired phone draw budgets')[1]?.split('- name: Retain')[0];
  const body=/<<'NODE'\n([\s\S]*?)\n {10}NODE/u.exec(step??'')?.[1];
  if(body===undefined)throw new Error('Missing native report program');
  const script=body.split('\n').map(line=>line.slice(10)).join('\n');
  for(const outcome of ['0','2','3','error']) {
    const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',executor],{
      input:script,encoding:'utf8',timeout:5000,env:{...process.env,DRAW_OUTCOME:outcome},
    });
    expect(result.status,result.stderr).toBe(0);
    const report: {serve:unknown[];closed:boolean;args:string[];exitCode:number|null;listeners:number;error?:string}=JSON.parse(result.stdout);
    expect(report.serve).toEqual(['/fixture','a'.repeat(40),true]);
    expect(report.closed).toBe(true);expect(report.listeners).toBe(0);
    if(outcome==='error')expect(report.error).toContain('native child refused');
    else expect(report.exitCode).toBe(Number(outcome));
    const args=report.args;
    expect(args[0]).toBe('scripts/frame-floor.mjs');
    expect(args).toContain('--draw-budget-report-only');expect(args).not.toContain('--draw-budget');
    expect(args).toContain('--chromium-cpu=4');expect(args).toContain('--chromium-phone');
    expect(args).toContain('--chromium-angle=swiftshader');
    expect(args).toContain('--software-draw-census');
    expect(args).toContain('--frames=4');expect(args).toContain('--settle=2');
    expect(args).toContain('--serve-base=http://127.0.0.1:4173/');
    expect(args).toContain(`--rev=${'a'.repeat(40)}`);
    const shards=args.find(arg=>arg.startsWith('--shards='))?.slice(9).split(',');
    expect(new Set(shards)).toEqual(new Set(['nine-dragon-stack','pine-hollow','driftwood-isle']));
  }
});

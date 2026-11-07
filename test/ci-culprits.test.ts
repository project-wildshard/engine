// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real Git history in a tiny owned fixture.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns and removes only its tiny scratch tree.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths without a checkout or application build.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Supply the explicit GitHub identity to the pure API selection fixture.
import { env } from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise a real promisor remote using only this tiny owned fixture.
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { culpritReport, prepareHistory, priorGreen } from '../scripts/ci-culprits.mjs';

test('a partial checkout fetches dependency waves together without reading imported data', () => {
  mkdirSync('tmp',{recursive:true});
  const root=mkdtempSync(resolve('tmp/ci-culprits-promisor-')),source=resolve(root,'source'),reader=resolve(root,'reader');
  mkdirSync(source);mkdirSync(reader);
  const git=(cwd:string,...args:string[]):string=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  const trace=resolve(root,'trace.log'),priorTrace=env['GIT_TRACE'];
  try {
    git(source,'init','-q','-b','main');mkdirSync(resolve(source,'src'));mkdirSync(resolve(source,'test'));
    git(source,'config','uploadpack.allowFilter','true');
    git(source,'config','uploadpack.allowAnySHA1InWant','true');
    const imports=Array.from({length:40},(_,i)=>`import '../src/dependency-${i}.js';`);
    writeFileSync(resolve(source,'test/failure.test.ts'),`${imports.join('\n')}\nimport '../src/chain-0.js';\nimport '../src/data.json';\n`);
    for(let i=0;i<40;i++)writeFileSync(resolve(source,`src/dependency-${i}.js`),`export const value=${i};\n`);
    const chain=(version:number):void=>{
      for(let i=0;i<12;i++)writeFileSync(resolve(source,`src/chain-${i}.js`),
        `${i<11?`import './chain-${i+1}.js';\n`:''}export const value=${version};\n`);
    };
    chain(0);
    writeFileSync(resolve(source,'src/data.json'),JSON.stringify({value:'old'.repeat(4000)}));
    const commit=():string=>{
      git(source,'add','.');git(source,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
        'commit','-qm','fixture\n\nAssisted-by: fixture:recorded');
      return git(source,'rev-parse','HEAD');
    };
    const base=commit();
    writeFileSync(resolve(source,'src/dependency-39.js'),'export const value=999;\n');
    chain(1);
    const dependency=commit();
    writeFileSync(resolve(source,'src/data.json'),JSON.stringify({value:'new'.repeat(4000)}));
    const sha=commit(),dataHash=git(source,'rev-parse',`${sha}:src/data.json`);
    git(reader,'init','-q');git(reader,'remote','add','origin',pathToFileURL(source).href);
    git(reader,'fetch','--quiet','--filter=blob:none','origin',sha);
    expect(git(reader,'config','--bool','--get','remote.origin.promisor')).toBe('true');
    // Match a real sparse CI checkout: current code is local, historical
    // versions and data payloads remain absent from the promisor object store.
    const current=git(source,'ls-tree','-r','--format=%(objectname) %(path)',sha).split('\n')
      .filter(row=>/\.[jt]s$/u.test(row)).map(row=>row.split(' ')[0]);
    execFileSync('git',['fetch','--quiet','--no-tags','--no-write-fetch-head','--filter=blob:none','origin','--stdin'],
      {cwd:reader,input:`${current.join('\n')}\n`,stdio:['pipe','pipe','pipe']});
    const dataPresent=():string=>execFileSync('git',['--no-lazy-fetch','cat-file','--batch-check=%(objectname) %(objecttype)'],
      {cwd:reader,encoding:'utf8',input:`${dataHash}\n`}).trim();
    expect(dataPresent()).toBe(`${dataHash} missing`);
    env['GIT_TRACE']=trace;
    const report=culpritReport(reader,base,sha,['test/failure.test.ts']);
    // A data-only change must remain a candidate even though its payload is
    // deliberately never downloaded or parsed by this source-import walk.
    expect(report.candidates.map(row=>row.sha)).toEqual([sha,dependency]);
    expect(report.missingImports).toEqual([]);
    expect(dataPresent()).toBe(`${dataHash} missing`);
    const fetches=readFileSync(trace,'utf8').match(/built-in: git fetch /gu)??[];
    expect(fetches.length).toBeGreaterThan(0);
    expect(fetches.length).toBeLessThanOrEqual(8);
  } finally {
    if(priorTrace===undefined)delete env['GIT_TRACE'];else env['GIT_TRACE']=priorTrace;
    rmSync(root,{recursive:true,force:true});
  }
});

test('a red window beyond 1000 commits still reaches the exact previous green from a shallow checkout', () => {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/ci-culprits-shallow-'));
  const source=resolve(root,'source'),reader=resolve(root,'reader');mkdirSync(source);mkdirSync(reader);
  const git=(cwd:string,...args:string[]):string=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  try {
    git(source,'init','-q','-b','main');mkdirSync(resolve(source,'test'));
    writeFileSync(resolve(source,'test/failure.test.ts'),'export const value=0;');git(source,'add','.');
    git(source,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
    const base=git(source,'rev-parse','HEAD');
    // Fast-import constructs only this tiny fixture's history, not a repo copy.
    let history='';
    for(let index=1;index<=1002;index++){
      const message=`change ${index}`,bytes=`export const value=${index};`;
      history+=`commit refs/heads/main\nmark :${index}\ncommitter Fixture <fixture@example.invalid> ${1700000000+index} +0000\ndata ${message.length}\n${message}\nfrom ${index===1?base:`:${index-1}`}\nM 100644 inline test/failure.test.ts\ndata ${bytes.length}\n${bytes}\n\n`;
    }
    execFileSync('git',['fast-import','--quiet'],{cwd:source,input:history});const sha=git(source,'rev-parse','main');
    git(reader,'init','-q');git(reader,'remote','add','origin',source);
    git(reader,'fetch','--quiet','--depth=200','origin',sha);
    expect(()=>culpritReport(reader,base,sha,['test/failure.test.ts'])).toThrow();
    prepareHistory(reader,sha);
    const report=culpritReport(reader,base,sha,['test/failure.test.ts']);
    expect(report.base).toBe(base);expect(report.candidates).toHaveLength(3);
    expect(report.candidates[0]?.sha).toBe(sha);expect(report.missingImports).toEqual([]);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('culprits follow committed imports and exports, prioritize the failing file and cap the report', () => {
  mkdirSync('tmp', { recursive: true });
  const root=mkdtempSync(resolve('tmp/ci-culprits-'));
  const git=(...args:string[]):string=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const write=(path:string,source:string):void=>{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),source);};
  const commit=(subject:string):string=>{
    git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',`${subject}\n\nAssisted-by: fixture:recorded`);
    return git('rev-parse','HEAD');
  };
  try {
    git('init','-q','-b','main');
    write('src/engine/package.json',JSON.stringify({exports:{'./value':'./value.ts'}}));
    write('src/engine/value.ts',"export {value} from './dependency.js';");
    write('src/engine/dependency.ts','export const value=0;');
    write('test/failure.test.ts',"import {value} from '@wildshard/engine/value'; console.log(value);");
    const base=commit('base');
    write('test/failure.test.ts',"import {value} from '@wildshard/engine/value'; console.log(value+1);");
    const direct=commit('change failing file');
    const related:string[]=[];
    for(let i=1;i<=4;i++){write('src/engine/dependency.ts',`export const value=${i};`);related.push(commit(`change dependency ${i}`));}
    write('src/unrelated.ts','export const unrelated=1;');const sha=commit('unrelated');
    // A peer's loose edit must never change the immutable failure graph.
    write('test/failure.test.ts',"import '../src/unrelated';");
    const report=culpritReport(root,base,sha,['test/failure.test.ts']);
    expect(report.candidates.map(row=>row.sha)).toEqual([direct,related[3],related[2]]);
    expect(report.candidates[0]).toMatchObject({match:'failing file',assistedBy:'fixture:recorded'});
    expect(report.candidates[1]?.match).toBe('literal import');
    expect(report.missingImports).toEqual([]);
    expect(()=>culpritReport(root,base,sha,['src/../outside.ts'])).toThrow('invalid');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('a deleted import remains attributable through the previous immutable tree', () => {
  mkdirSync('tmp', { recursive: true });const root=mkdtempSync(resolve('tmp/ci-culprits-delete-'));
  const git=(...args:string[]):string=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const commit=():string=>{git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  try {
    git('init','-q','-b','main');mkdirSync(resolve(root,'src'));mkdirSync(resolve(root,'test'));
    writeFileSync(resolve(root,'src/old.ts'),'export const old=1;');
    writeFileSync(resolve(root,'test/failure.test.ts'),"import '../src/old';");const base=commit();
    rmSync(resolve(root,'src/old.ts'));const sha=commit();
    const report=culpritReport(root,base,sha,['test/failure.test.ts']);
    expect(report.candidates.map(row=>row.sha)).toEqual([sha]);
    expect(report.missingImports).toContain('src/old');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('commas, spaces and Git glob characters name a literal committed file', () => {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/ci-culprits-literal-'));
  const git=(...args:string[]):string=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const commit=():string=>{git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  const file='test/a[1], notes.test.ts',other='test/a1, notes.test.ts';
  try {
    git('init','-q','-b','main');mkdirSync(resolve(root,'test'));
    writeFileSync(resolve(root,file),'export const value=1;');writeFileSync(resolve(root,other),'export const value=1;');
    const base=commit();writeFileSync(resolve(root,file),'export const value=2;');const direct=commit();
    writeFileSync(resolve(root,other),'export const value=3;');const sha=commit();
    expect(culpritReport(root,base,sha,[file]).candidates.map(row=>row.sha)).toEqual([direct]);
    expect(()=>culpritReport(root,base,sha,['test/../outside.ts'])).toThrow('invalid');
    expect(()=>culpritReport(root,base,sha,['test/line\nbreak.ts'])).toThrow('invalid');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('prior green excludes release-only, future and wrong-source runs', () => {
  const sha='a'.repeat(40),base='b'.repeat(40);
  const previous={event:'push',head_branch:'main',head_sha:base,status:'completed',conclusion:'success',created_at:'2026-10-24T10:00:00Z',path:'.github/workflows/deploy.yml'};
  const oldRepo=env['GITHUB_REPOSITORY'],oldRun=env['GITHUB_RUN_ID'];
  env['GITHUB_REPOSITORY']='owner/repo';env['GITHUB_RUN_ID']='42';
  try {
    const query=(path:string):unknown=>path.endsWith('/42')?{...previous,head_sha:sha,created_at:'2026-10-24T11:00:00Z'}:
      {workflow_runs:[{...previous,event:'workflow_dispatch',created_at:'2026-10-24T10:59:00Z'},
        {...previous,head_sha:'c'.repeat(40),created_at:'2026-10-24T12:00:00Z'},previous]};
    expect(priorGreen(sha,query)).toBe(base);
    expect(()=>priorGreen(sha,()=>({}))).toThrow();
    expect(()=>priorGreen('d'.repeat(40),query)).toThrow('not the exact main push');
  } finally {
    if(oldRepo===undefined)delete env['GITHUB_REPOSITORY'];else env['GITHUB_REPOSITORY']=oldRepo;
    if(oldRun===undefined)delete env['GITHUB_RUN_ID'];else env['GITHUB_RUN_ID']=oldRun;
  }
});

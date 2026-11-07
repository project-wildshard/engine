// oxlint-disable-next-line import/no-nodejs-modules -- Exercise exact Git inputs in owned tiny repositories.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Tiny fixtures are removed after each test.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixture paths remain beneath tmp/.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture invokes the real platform policy comparator.
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { linkNodeModules } from '../scripts/link-node-modules.mjs';

const repository=resolve('.');
function fixture() {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/git-fast-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const put=(file:string,text:string)=>{mkdirSync(resolve(root,file,'..'),{recursive:true});writeFileSync(resolve(root,file),text);};
  git('init','-q','-b','main');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');
  put('.gitignore','tmp/\nnode_modules/\n');
  put('scripts/guard-counts.mjs',`import{readFileSync}from'node:fs';export function readLintConfig(path){return JSON.parse(readFileSync(path,'utf8'));}export function hardRules(){return new Set();}`);
  put('scripts/precommit-checks.mjs','export function fastCommitLintConfig(value){return value;}');
  put('lint/plugin.mjs',`import{readFileSync}from'node:fs';import{resolve}from'node:path';
export default {
  meta:{name:'wildshard'},rules:{marker:{
    meta:{type:'problem',schema:[],messages:{bad:'Committed marker refused'}},
    create(context){return {Program(node){
      if(readFileSync(resolve('lint/marker.json'),'utf8').includes('BAD'))context.report({node,messageId:'bad'});
    }};}
  }}
};`);
  put('lint/marker.json','GOOD');put('lint/ratchet.json','{}');
  put('.oxlintrc.ratchet.json',JSON.stringify({jsPlugins:['./lint/plugin.mjs'],rules:{'wildshard/marker':'error'}}));
  put('scripts/push-checks.mjs',readFileSync(resolve('scripts/push-checks.mjs'),'utf8'));
  put('lint/layer-exports.mjs',readFileSync(resolve('lint/layer-exports.mjs'),'utf8'));
  put('scripts/gate-related-tests.mjs','export function pushGuards(){return [];}');
  put('.oxlintrc.json',JSON.stringify({options:{typeAware:false},plugins:['import'],jsPlugins:['./lint/plugin.mjs'],categories:{correctness:'off'},rules:{'no-eval':'error','import/no-cycle':'error','wildshard/marker':'error'}}));
  put('src/client/app/main.ts','export const value=1;\n');
  const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();linkNodeModules(repository,root);
  const run=(phase:string,tip:string,files=['src/client/app/main.ts'],from=base,trace=false,native=false,reportOnly=false)=>spawnSync('node',[resolve('scripts/committed-fast-checks.mjs'),root,from,tip,phase,JSON.stringify(files)],{cwd:repository,encoding:'utf8',timeout:15_000,env:{...process.env,...(trace?{GIT_TRACE:'1'}:{}),...(native?{WS_GIT_NATIVE_ROOT:root}:{}),...(reportOnly?{WS_GIT_NATIVE_REPORT_ONLY:'1'}:{})}});
  return {root,git,put,commit,base,run,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('source table guards pin producers, schema data and output to the checked commit', () => {
  const f = fixture();
  try {
    f.put('scripts/check-closed-components.mjs', 'export function closedComponentSources(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs', 'export const PLATFORM_LISTS=[];export function comparePlatformList(){return [];}');
    f.put('scripts/ratchet-approval.mjs', 'export function ratchetApprovalFailures(){return [];}');
    for (const file of ['gen-source.mjs', 'source-generators.mjs'])
      f.put(`scripts/${file}`, readFileSync(resolve('scripts', file), 'utf8'));
    const registry=readFileSync(resolve('scripts/source-generators.mjs'),'utf8');
    f.put('scripts/source-generators.mjs',registry.replace('export const SOURCE_GENERATORS = [',`export const SOURCE_GENERATORS = [
      ...['driftwood-isle','pine-hollow'].map(slug=>({id:slug+'-test-schema',outputs:['src/shards/'+slug+'/generators/sourceProbe.generated.ts','src/shards/'+slug+'/runtime/sourceProbe.generated.d.ts'],inputs:['src/format/schema.txt'],committed:true,generate:async root=>(await import(pathToFileURL(root+'/scripts/source-probe.mjs').href)).sourceProbeTables(root,slug).tables})),`));
    const producer = `import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
export function sourceProbeTables(root,slug){return {tables:{
 ['src/shards/'+slug+'/generators/sourceProbe.generated.ts']:readFileSync(resolve(root,'src/format/schema.txt'),'utf8'),
 ['src/shards/'+slug+'/runtime/sourceProbe.generated.d.ts']:'export interface SourceProbe {}\\n'
}};}`;
    f.put('scripts/source-probe.mjs', producer);
    f.put('src/format/schema.txt', 'export const schema="original";\n');
    const output = 'src/shards/pine-hollow/generators/sourceProbe.generated.ts';
    const sibling = 'src/shards/driftwood-isle/generators/sourceProbe.generated.ts';
    f.put(output, 'export const schema="original";\n');
    f.put(sibling, 'export const schema="original";\n');
    f.put('src/shards/pine-hollow/runtime/sourceProbe.generated.d.ts', 'export interface SourceProbe {}\n');
    f.put('src/shards/driftwood-isle/runtime/sourceProbe.generated.d.ts', 'export interface SourceProbe {}\n');
    const base = f.commit();
    f.put('src/format/schema.txt', 'export const schema="new";\n');
    const stale = f.commit();
    // A child reading these loose repairs would incorrectly accept stale output.
    f.put('src/format/schema.txt', 'export const schema="original";\n');
    f.put('scripts/source-probe.mjs', producer.replace('src/format/schema.txt', output));
    const index = readFileSync(resolve(f.root, '.git/index'));
    const refused = f.run('guards', stale, ['src/format/schema.txt'], base);
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stderr).toContain(`gen:source: stale ${sibling}, ${output} (run pnpm gen:source)`);
    expect(readFileSync(resolve(f.root, '.git/index'))).toEqual(index);
    expect(readFileSync(resolve(f.root, 'src/format/schema.txt'), 'utf8')).toContain('original');
    f.put('scripts/source-probe.mjs', producer);
    f.put('src/format/schema.txt', 'export const schema="new";\n');
    f.put(output, 'export const schema="new";\n');
    f.put(sibling, 'export const schema="new";\n');
    const current = f.commit();
    f.put(output, 'loose output poison');
    f.put('scripts/source-probe.mjs', 'throw new Error("loose producer poison");');
    const accepted = f.run('guards', current, ['src/format/schema.txt'], stale);
    expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
    expect(accepted.stdout).toContain('guards: exact committed inputs passed');
    expect(readFileSync(resolve(f.root, output), 'utf8')).toBe('loose output poison');
    expect(readFileSync(resolve(f.root, 'scripts/source-probe.mjs'), 'utf8')).toContain('loose producer poison');
  } finally { f.close(); }
});

test('a format bump the lock left behind is refused, naming the lock, and an untouching push is not',()=>{
  const f=fixture();try{
    f.put('scripts/check-closed-components.mjs','export function closedComponentSources(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs','export const PLATFORM_LISTS=[];export function comparePlatformList(){return [];}');
    f.put('scripts/ratchet-approval.mjs','export function ratchetApprovalFailures(){return [];}');
    f.put('scripts/format-lock.mjs',readFileSync(resolve('scripts/format-lock.mjs'),'utf8'));
    f.put('package.json',JSON.stringify({dependencies:{'@wildshard/format':'github:project-wildshard/shardfile#v0.3.4'}}));
    const sha='a'.repeat(40),row=`git+ssh://git@github.com/project-wildshard/shardfile.git#${sha}`;
    const lock=(version:string)=>`lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@wildshard/format':
        specifier: github:project-wildshard/shardfile#v0.3.4
        version: ${row}(typescript@7.0.2)

packages:

  '@wildshard/format@${row}':
    resolution: {commit: ${sha}, repo: ${f.root}/absent.git, type: git}
    version: ${version}
`;
    f.put('pnpm-lock.yaml',lock('0.3.4'));const good=f.commit();
    f.put('pnpm-lock.yaml',lock('0.3.3'));const bad=f.commit();
    const refused=f.run('guards',bad,['pnpm-lock.yaml'],good);
    expect(refused.status,refused.stdout+refused.stderr).toBe(1);
    expect(refused.stderr).toContain('pnpm-lock.yaml: @wildshard/format row says version 0.3.3, the pin says v0.3.4');
    const elsewhere=f.run('guards',bad,['src/client/app/main.ts'],good);
    expect(elsewhere.status,elsewhere.stdout+elsewhere.stderr).toBe(0);
    // The tag can't be read here, and an unreadable tag belongs to CI.
    const unread=f.run('guards',good,['pnpm-lock.yaml'],good);
    expect(unread.status,unread.stdout+unread.stderr).toBe(0);
    expect(unread.stdout).toContain('v0.3.4 unread');
  }finally{f.close();}
});

test('native-output handoff keeps ordinary source errors blocking',()=>{
  const f=fixture();try{
    f.put('.gitignore','tmp/\nnode_modules/\n*.generated.ts\n');
    f.put('scripts/source-generation-outputs.json',JSON.stringify({producers:{'scripts/gen-shards.mjs':['src/value.generated.ts']}}));
    f.put('src/client/app/main.ts',"import './value.generated';export const value=1;");
    const good=f.commit();f.put('src/value.generated.ts','eval("poison");');
    const handed=f.run('fast-lint',good,undefined,undefined,false,true,true);
    expect(handed.status,handed.stderr).toBe(0);
    expect(handed.stdout).toContain('Fast lint passed on 1 exact changed files');
    expect(handed.stdout).toContain('Gate-deferred: native-outputs');
    expect(handed.stdout).not.toContain('DEFERRED TO CI');
    expect(()=>readFileSync(resolve(f.root,'src/value.generated.ts'))).toThrow();
    f.put('src/client/app/main.ts',"import './value.generated';eval('1');");
    const refused=f.run('fast-lint',f.commit(),undefined,undefined,false,true,true);
    expect(refused.status,refused.stderr).toBe(1);expect(refused.stderr).toContain('no-eval');
    f.put('src/client/app/main.ts',"import './undeclared';export const value=1;");
    const missing=f.run('fast-lint',f.commit(),undefined,undefined,false,true,true);
    expect(missing.stdout).toContain('DEFERRED TO CI');
    expect(missing.stdout).not.toContain('Gate-deferred: native-outputs');
  }finally{f.close();}
});

test('native closure admits tracked declaration modules without a generation handoff',()=>{
  const f=fixture();try{
    f.put('src/shape.d.ts','export interface Shape {value:number}\n');
    f.put('src/client/app/main.ts',"import type {Shape} from './shape';export const value:Shape={value:1};");
    const result=f.run('fast-lint',f.commit(),undefined,undefined,false,true,true);
    expect(result.status,result.stderr).toBe(0);
    expect(result.stdout).toContain('Fast lint passed on 1 exact changed files');
    expect(result.stdout).not.toContain('DEFERRED');
    expect(result.stdout).not.toContain('Gate-deferred');
  }finally{f.close();}
});

test('lint refuses exact bad text and openly defers dirty or staged inputs',()=>{
  const f=fixture();try {
    f.put('src/client/app/main.ts','export const value=eval("1");');const bad=f.commit();
    const badIndex=readFileSync(resolve(f.root,'.git/index'));
    const exact=f.run('fast-lint',bad);expect(exact.status,exact.stderr).toBe(1);expect(exact.stderr).toContain('no-eval');
    expect(readFileSync(resolve(f.root,'.git/index'))).toEqual(badIndex);
    expect(readFileSync(resolve(f.root,'src/client/app/main.ts'),'utf8')).toBe('export const value=eval("1");');
    f.put('src/client/app/main.ts','export const value=2;');f.git('add','src/client/app/main.ts');
    const before=readFileSync(resolve(f.root,'src/client/app/main.ts'),'utf8'),index=f.git('write-tree');
    const result=f.run('fast-lint',bad);
    expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('DEFERRED TO CI fast-lint src/client/app/main.ts');expect(result.stdout).not.toContain('Fast lint passed');
    expect(readFileSync(resolve(f.root,'src/client/app/main.ts'),'utf8')).toBe(before);expect(f.git('write-tree')).toBe(index);
    expect(f.run('fast-lint',f.base).status).toBe(0);
  }finally{f.close();}
});

test('the push ratchet refuses committed debt despite loose peer repairs',()=>{
  const f=fixture();try {
    f.put('scripts/committed-fast-checks.mjs','// Registered exact-input counter entry.\n');
    f.put('lint/plugin.mjs',`import{readFileSync}from'node:fs';import{resolve}from'node:path';
export default {meta:{name:'wildshard'},rules:{marker:{meta:{type:'problem',schema:[]},create(context){return {Program(node){
 for(let i=0;i<Number(readFileSync(resolve('lint/marker.json'),'utf8'));i++)context.report({node,message:'Counted existing debt'});
}};}}}};`);
    f.put('lint/ratchet.json',JSON.stringify({'wildshard/marker':{'src/client/app/main.ts':1}}));
    f.put('lint/marker.json','1');const base=f.commit();
    f.put('lint/marker.json','2');f.put('src/client/app/main.ts','export const value=2;');const tip=f.commit();
    const index=readFileSync(resolve(f.root,'.git/index'));
    // A peer's loose rescue and broken plugin must not hide committed growth.
    f.put('lint/marker.json','0');f.put('lint/plugin.mjs','throw Error("foreign plugin");');
    const result=f.run('ratchet',tip,['src/client/app/main.ts'],base);
    expect(result.status,result.stderr).toBe(1);
    expect(result.stderr).toContain('was 1, now 2');
    expect(result.stderr).not.toContain('Error: foreign plugin');
    expect(readFileSync(resolve(f.root,'.git/index'))).toEqual(index);
    expect(readFileSync(resolve(f.root,'lint/marker.json'),'utf8')).toBe('0');
    expect(readFileSync(resolve(f.root,'lint/plugin.mjs'),'utf8')).toContain('foreign plugin');
  }finally{f.close();}
});

test('plugin executable and policy reads stay on Git even when both are dirty',()=>{
  const f=fixture();try {
    f.put('lint/marker.json','BAD');const bad=f.commit();
    f.put('lint/marker.json','GOOD');f.put('lint/plugin.mjs','throw Error("foreign plugin");');
    const lint=f.run('fast-lint',bad);expect(lint.status).toBe(1);expect(lint.stderr).toContain('Committed marker refused');expect(lint.stderr).not.toContain('foreign plugin');
    const result=f.run('ratchet',bad);
    expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain('was 0, now 1');
    expect(result.stderr).not.toContain('foreign plugin');
  }finally{f.close();}
});

test('native lint detects exact cycles and defers a changed dependency',()=>{
  const f=fixture();try {
    f.put('src/client/app/main.ts',"import {other} from './other';export const value=other+1;");
    f.put('src/other.ts',"import {value} from './main';export const other=value+1;");const bad=f.commit();
    const exact=f.run('fast-lint',bad);expect(exact.status,exact.stderr).toBe(1);expect(exact.stderr).toContain('no-cycle');
    f.put('src/other.ts','export const other=1;');
    const result=f.run('fast-lint',bad);expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('DEFERRED TO CI fast-lint src/client/app/main.ts');expect(result.stdout).not.toContain('Fast lint passed');
  }finally{f.close();}
});

test('native closure resolves query and fragment imports to their tracked file',()=>{
  const f=fixture();try {
    f.put('src/worker.ts','export const value=1;');
    f.put('src/client/app/main.ts',"import first from '../lint/ratchet.json?raw';import second from '../lint/ratchet.json#text';import worker from './worker?worker&inline';export const value=[first,second,worker];");
    const tip=f.commit(),index=f.git('write-tree');
    const result=f.run('fast-lint',tip);
    expect(result.status,result.stdout+result.stderr).toBe(0);
    expect(result.stdout).toContain('Fast lint passed on 1 exact changed files');
    expect(result.stdout).not.toContain('DEFERRED TO CI');
    expect(f.git('write-tree')).toBe(index);
    expect(readFileSync(resolve(f.root,'src/client/app/main.ts'),'utf8')).toContain('ratchet.json?raw');
    f.put('src/worker.ts','export const value=2;');
    const dirty=f.run('fast-lint',tip);
    expect(dirty.stdout).toContain('unverified inputs src/worker.ts');
    expect(dirty.stdout).not.toContain('Fast lint passed');
    f.put('src/client/app/main.ts',"import worker from './missing?worker&inline';export const value=worker;");
    const missing=f.run('fast-lint',f.commit());
    expect(missing.stdout).toContain('unverified inputs src/missing');
    expect(missing.stdout).not.toContain('Fast lint passed');
  }finally{f.close();}
});

test('committed good policy ignores a loose poison and still checks the source',()=>{
  const f=fixture();try {
    f.put('src/client/app/main.ts','export const value=2;');const tip=f.commit();
    const hash=f.git('rev-parse',`${tip}:src/client/app/main.ts`);f.put('lint/marker.json','BAD');
    const result=f.run('fast-lint',tip,['src/client/app/main.ts'],f.base,true);
    expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Fast lint passed on 1 exact changed files');
    expect(result.stderr).toContain(`cat-file blob ${hash}`);expect(result.stdout).not.toContain('DEFERRED TO CI');
  }finally{f.close();}
});

test('native generated inputs match canonical committed producer bytes',()=>{
  const f=fixture();try {
    f.put('scripts/gen-starter-weapons.mjs',readFileSync(resolve('scripts/gen-starter-weapons.mjs'),'utf8'));
    f.put('src/shared/game/weapons/starterBow.json','{"damage":1}');
    f.put('src/client/app/main.ts',"import {STARTER_BOW} from './game/shared/weapons/starter.generated';export const value=STARTER_BOW;");
    f.put('.gitignore','.gitignore\ntmp/\nnode_modules/\n*.generated.ts\n');
    const tip=f.commit();
    const generate=()=>execFileSync('node',['--input-type=module','--eval',"import {genStarterWeapons} from './scripts/gen-starter-weapons.mjs';genStarterWeapons();"],{cwd:f.root});
    generate();
    const passed=f.run('fast-lint',tip);
    expect(passed.status,passed.stdout+passed.stderr).toBe(0);
    expect(passed.stdout).toContain('Fast lint passed on 1 exact changed files');
    expect(passed.stdout).not.toContain('DEFERRED TO CI');
    f.put('src/shared/game/weapons/starter.generated.ts','export const STARTER_BOW={damage:999};');
    const poisoned=f.run('fast-lint',tip);
    expect(poisoned.stdout).toContain('unverified inputs src/shared/game/weapons/starter.generated.ts');
    expect(poisoned.stdout).not.toContain('Fast lint passed');
    f.put('src/shared/game/weapons/starterBow.json','{"damage":2}');
    const changed=f.commit();generate();
    const changedResult=f.run('fast-lint',changed);
    expect(changedResult.status,changedResult.stdout+changedResult.stderr).toBe(0);
    expect(changedResult.stdout).toContain('Fast lint passed on 1 exact changed files');
  }finally{f.close();}
});

test('loose data without a current provider cannot supply committed inputs',()=>{
  const f=fixture();try {
    const file='src/layout.generated.json';
    f.put('.gitignore','tmp/\nnode_modules/\n*.generated.json\n');
    f.put('src/client/app/main.ts',"import layout from './layout.generated.json';export const value=layout;");
    const tip=f.commit();
    for(const bytes of [undefined,'{"layout":1}','{"layout":2}']) {
      if(bytes!==undefined)f.put(file,bytes);
      const result=f.run('fast-lint',tip);
      expect(result.stdout).toContain('unverified inputs src/layout.generated.json');
      expect(result.stdout).not.toContain('Fast lint passed');
    }
  }finally{f.close();}
});

test('literal discovery providers require native context and exact tracked correspondence',()=>{
  const f=fixture();try {
    const file='src/derived.generated.ts',retained='src/owned.json';
    f.put('.gitignore','tmp/\nnode_modules/\n*.generated.ts\n');
    f.put('src/client/app/main.ts',"import {value} from './derived.generated';export const result=value;");
    const registry=(outputs:string[]):void=>f.put('scripts/source-generation-outputs.json',JSON.stringify({producers:{'scripts/gen-shards.mjs':outputs}}));
    registry([file,retained]);f.put(retained,'{"id":1}');
    f.put('scripts/shard-platform-format.mjs','// Fixture has no format imports.');
    const provider=`import{mkdirSync,writeFileSync}from'node:fs';export function genShards(){mkdirSync('src',{recursive:true});writeFileSync('${file}','export const value=1;');writeFileSync('${retained}','{"id":1}');}`;
    f.put('scripts/gen-shards.mjs',provider);const tip=f.commit();
    expect(f.run('fast-lint',tip).stdout).toContain('unverified inputs src/derived.generated');
    const native=f.run('fast-lint',tip,['src/client/app/main.ts'],f.base,false,true);
    expect(native.status,native.stdout+native.stderr).toBe(0);
    expect(native.stdout).toContain('Fast lint passed on 1 exact changed files');
    expect(native.stdout).not.toContain('DEFERRED TO CI');
    expect(readFileSync(resolve(f.root,file),'utf8')).toBe('export const value=1;');
    expect(readFileSync(resolve(f.root,retained),'utf8')).toBe('{"id":1}');
    f.put('scripts/gen-shards.mjs',provider.replace('{"id":1}','{"id":2}'));
    const moved=f.run('fast-lint',f.commit(),['src/client/app/main.ts'],f.base,false,true);
    expect(moved.status).toBe(1);expect(moved.stderr).toContain('Generated output differs from committed source');
    // This native root represents a disposable mirror; mismatched bytes never
    // gain admission even though the rejected writer emitted them there.
    expect(readFileSync(resolve(f.root,retained),'utf8')).toBe('{"id":2}');
    f.put('scripts/gen-shards.mjs',provider);registry([file,'src/missing.generated.ts']);
    const incomplete=f.run('fast-lint',f.commit(),['src/client/app/main.ts'],f.base,false,true);
    expect(incomplete.status).toBe(1);expect(incomplete.stderr).toContain('ENOENT');
    registry([file,'src/../escape']);
    const escaped=f.run('fast-lint',f.commit(),['src/client/app/main.ts'],f.base,false,true);
    expect(escaped.status).toBe(1);expect(escaped.stderr).toContain('Invalid native source output');
  }finally{f.close();}
});

test('deleted-path guard ignores loose rescues and keeps frozen legacy references historical',()=>{
  const f=fixture();try {
    f.put('src/other.ts','export const other=1;');f.commit();f.git('rm','src/other.ts');
    f.put('src/client/app/main.ts',"export{other}from'./other';");const bad=f.commit();f.put('src/other.ts','export const other=1;');
    const index=readFileSync(resolve(f.root,'.git/index'));
    const result=f.run('deleted-paths',bad,['src/other.ts']);expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain('deleted path src/other.ts');
    expect(readFileSync(resolve(f.root,'.git/index'))).toEqual(index);
    expect(readFileSync(resolve(f.root,'src/other.ts'),'utf8')).toBe('export const other=1;');
    f.put('src/client/app/main.ts','export const value=1;');f.put('src/shards/example-legacy/runtime/index.ts',"export{other}from'../../../other';");const fixed=f.commit();
    f.put('src/client/app/main.ts',"export{other}from'./other';");
    const fixedIndex=readFileSync(resolve(f.root,'.git/index'));
    expect(f.run('deleted-paths',fixed,['src/other.ts']).status).toBe(0);
    expect(readFileSync(resolve(f.root,'.git/index'))).toEqual(fixedIndex);
    expect(readFileSync(resolve(f.root,'src/client/app/main.ts'),'utf8')).toBe("export{other}from'./other';");
  }finally{f.close();}
});

test('ratchet retains old unrecorded counts but refuses new counts and cannot borrow hard debt',()=>{
  const f=fixture();try {
    f.put('lint/marker.json','BAD');const bad=f.commit();
    const result=f.run('ratchet',bad);expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain('was 0, now 1');
    expect(f.run('ratchet',bad,['src/client/app/main.ts'],bad).status).toBe(0);
    f.put('scripts/guard-counts.mjs',`import{readFileSync}from'node:fs';export function readLintConfig(path){return JSON.parse(readFileSync(path,'utf8'));}export function hardRules(){return new Set(['wildshard/marker']);}`);
    const hard=f.commit();const refused=f.run('ratchet',hard,['src/client/app/main.ts'],bad);expect(refused.status).toBe(1);expect(refused.stderr).toContain('was 0, now 1');
    f.put('lint/ratchet.json',JSON.stringify({'wildshard/marker':{'src/client/app/main.ts':1}}));const allowed=f.commit();
    expect(f.run('ratchet',allowed).status).toBe(0);
  }finally{f.close();}
});

test('guards lock zero through immutable committed inputs',()=>{
  const f=fixture();try{
    f.put('scripts/check-closed-components.mjs','export function closedComponentSources(){return [];}');
    f.put('scripts/ratchet-approval.mjs','export function ratchetApprovalFailures(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs',`export {comparePlatformList} from '${pathToFileURL(resolve('scripts/check-platform-ratchets.mjs')).href}';
export const PLATFORM_LISTS=['lint/ratchet.json'];`);
    f.put('lint/ratchet.json',JSON.stringify({budgets:{'custom-sections/total':0}}));const base=f.commit();
    f.put('lint/ratchet.json',JSON.stringify({budgets:{'custom-sections/total':1}}));const raised=f.commit();
    f.put('lint/ratchet.json',JSON.stringify({budgets:{'custom-sections/total':0}}));
    const bad=f.run('guards',raised,[],base);expect(bad.status).toBe(1);expect(bad.stderr).toContain('custom-sections/total must equal 0');
    const sealed=f.commit();f.put('lint/ratchet.json','foreign invalid policy');
    const good=f.run('guards',sealed,[],raised);expect(good.status,good.stdout+good.stderr).toBe(0);
  }finally{f.close();}
});

test('guards refuse paths written as data and a file outside a shard\'s layout',()=>{
  const f=fixture();try{
    f.put('scripts/check-closed-components.mjs','export function closedComponentSources(){return [];}');
    f.put('scripts/ratchet-approval.mjs','export function ratchetApprovalFailures(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs','export const PLATFORM_LISTS=[];export function comparePlatformList(){return [];}');
    for(const file of ['check-spelled-paths.mjs','check-shards.mjs','shard-outputs.mjs'])f.put(`scripts/${file}`,readFileSync(resolve('scripts',file),'utf8'));
    f.put('lint/shard-layout.json',JSON.stringify({sourceLayout:{requiredFiles:['shard.config.ts'],allowedFiles:[],folders:['data']}}));
    f.put('src/shards/one/shard.config.ts','export default {};\n');f.put('src/shards/one/data/map.json','{"inputs":["data"]}\n');
    f.put('src/client/engine/view.ts','export const view=1;\n');f.put('src/engine/isolated-x.test.ts','const names=["client/view"];\n');
    const base=f.commit();
    expect(f.run('guards',base,['src/shards/one/data/map.json'],base).status).toBe(0);
    f.put('src/shards/one/mounts.json','{}\n');const stray=f.commit();
    const layout=f.run('guards',stray,['src/shards/one/mounts.json'],base);
    expect(layout.status).toBe(1);expect(layout.stderr).toContain('src/shards/one/mounts.json: outside the standalone source layout');
    f.git('rm','-q','src/shards/one/mounts.json');f.git('mv','src/client/engine/view.ts','src/server/engine-view.ts');
    const moved=f.commit(),spelled=f.run('guards',moved,['src/server/engine-view.ts'],stray);
    expect(spelled.status).toBe(1);expect(spelled.stderr).toContain('src/engine/isolated-x.test.ts: no module at src/client/engine/view');
  }finally{f.close();}
});

test('the census phase runs the ratchets over the tip, and only for source',()=>{
  const f=fixture();try{
    for(const file of ['sort-sides.mjs','git-source-view.mjs'])f.put(`scripts/${file}`,readFileSync(resolve('scripts',file),'utf8'));
    f.put('scripts/check-engine-sides.mjs','console.log("sides fine");\n');
    f.put('scripts/check-sim-players.mjs',"import {readFileSync} from 'node:fs';if(readFileSync('src/client/app/main.ts','utf8').includes('rose')){console.error('  src/client/app/main.ts: 2 → 4');process.exitCode=1;}\n");
    const base=f.commit();
    expect(f.run('census',base,['src/client/app/main.ts'],base).status).toBe(0);
    f.put('src/client/app/main.ts','export const rose=1;\n');const risen=f.commit();
    expect(f.run('census',risen,['docs/note.md'],base).status).toBe(0);
    const bad=f.run('census',risen,['src/engine/x.ts'],base);
    expect(bad.status).toBe(1);expect(bad.stderr).toContain('src/client/app/main.ts: 2 → 4');
    f.put('src/client/app/main.ts','export const value=1;\n');
    expect(f.run('census',risen,['src/engine/x.ts'],base).stderr).toContain('src/client/app/main.ts: 2 → 4');
  }finally{f.close();}
});

test('side edges compare net across a push, so only the published step cannot rise',()=>{
  const f=fixture();try{
    const edges=(count:number)=>JSON.stringify({files:{'src/client/game/a.ts':{'client → server':count}}});
    f.put('scripts/check-closed-components.mjs','export function closedComponentSources(){return [];}');
    f.put('scripts/ratchet-approval.mjs','export function ratchetApprovalFailures(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs',`export {comparePlatformList} from '${pathToFileURL(resolve('scripts/check-platform-ratchets.mjs')).href}';
export const PLATFORM_LISTS=['lint/engine-side-edges.json'];`);
    f.put('lint/engine-side-edges.json',edges(2));const base=f.commit();
    f.put('lint/engine-side-edges.json',edges(3));const raised=f.commit();
    f.put('lint/engine-side-edges.json',edges(2));const back=f.commit();
    const interim=f.run('guards',back,[],base);expect(interim.status,interim.stdout+interim.stderr).toBe(0);
    f.put('lint/engine-side-edges.json',edges(3));const net=f.commit();
    const bad=f.run('guards',net,[],base);expect(bad.status).toBe(1);expect(bad.stderr).toContain('rose 2 → 3');
    const single=f.run('guards',raised,[],base);expect(single.status).toBe(1);expect(single.stderr).toContain('rose 2 → 3');
  }finally{f.close();}
});

test('a later exact approval repairs a net candidate but cannot approve a larger final row',()=>{
  const f=fixture();try {
    f.put('scripts/check-closed-components.mjs','export function closedComponentSources(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs','export const PLATFORM_LISTS=[];export function comparePlatformList(){return [];}');
    f.put('scripts/ratchet-approval.mjs',readFileSync(resolve('scripts/ratchet-approval.mjs'),'utf8'));
    const rule='wildshard/generator-imports',file='src/client/app/main.ts';
    f.put('lint/ratchet.json',JSON.stringify({[rule]:{[file]:0}}));const base=f.commit();
    f.put('lint/ratchet.json',JSON.stringify({[rule]:{[file]:11}}));const unapproved=f.commit();
    expect(f.run('guards',unapproved,[],base).status).toBe(1);
    f.git('commit','--allow-empty','-qm',`docs(policy): correct approval\n\nRatchet-Approved: wildshard-new ${rule} ${file} +11`);
    const approved=f.git('rev-parse','HEAD'),result=f.run('guards',approved,[],base);
    expect(result.status,result.stderr).toBe(0);
    f.put('lint/ratchet.json',JSON.stringify({[rule]:{[file]:22}}));const larger=f.commit();
    const refused=f.run('guards',larger,[],base);expect(refused.status).toBe(1);expect(refused.stderr).toContain('+22');
  }finally{f.close();}
});

test('committed guards seed a new rule atomically and ignore dirty future config for its predecessor',()=>{
  const f=fixture();try {
    f.put('scripts/check-closed-components.mjs','export function closedComponentSources(){return [];}');
    f.put('scripts/check-platform-ratchets.mjs','export const PLATFORM_LISTS=[];export function comparePlatformList(){return [];}');
    f.put('scripts/ratchet-approval.mjs',readFileSync(resolve('scripts/ratchet-approval.mjs'),'utf8'));
    const base=f.commit(),rule='wildshard/no-generated-json-import',file='scripts/old.ts';
    f.put(file,"import rows from './rows.generated.json';export default rows;");
    const predecessor=f.commit();
    const config={jsPlugins:['./lint/plugin.mjs'],rules:{[rule]:['error',{count:true}]}};
    f.put('.oxlintrc.ratchet.json',JSON.stringify(config));f.put('lint/ratchet.json',JSON.stringify({[rule]:{[file]:1}}));
    const old=f.run('guards',predecessor,[],base);expect(old.status,old.stderr).toBe(0);
    const oldCounts=f.run('ratchet-counts',predecessor,['src/client/app/main.ts','scripts/old.ts'],base);
    expect(oldCounts.status,oldCounts.stderr).toBe(0);
    const measured:unknown=JSON.parse(oldCounts.stdout);expect(measured).not.toHaveProperty(rule);
    const seeded=f.commit(),initial=f.run('guards',seeded,[],base);expect(initial.status,initial.stderr).toBe(0);
    f.put('lint/ratchet.json',JSON.stringify({[rule]:{[file]:2}}));
    const raised=f.commit(),refused=f.run('guards',raised,[],seeded);
    expect(refused.status).toBe(1);expect(refused.stderr).toContain(`${rule} ${file} +1`);
  }finally{f.close();}
});

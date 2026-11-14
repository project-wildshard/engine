// oxlint-disable-next-line import/no-nodejs-modules -- Run the real policy plugin against an isolated fixture.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned small compiler inputs, removed after each test.
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve policy fixture paths.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Child oxlint inherits this process environment.
import { cwd, env, execPath } from 'node:process';
import { expect, test } from 'vitest';
import { parseSync } from 'vite';
import { hostCallbackSites } from '../lint/host-callback-syntax.mjs';
import { hostAnalysis, hostCallbackViolations } from '../lint/host-callbacks.mjs';
import { hostCatalogue, hostVerdicts, renderHostCatalogue } from '../scripts/gen-host-catalogue.mjs';

const file = 'src/shards/sample/runtime/main.ts';
function fixture(source: string) {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/host-callback-'));
  const write = (path: string, text: string) => { mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(resolve(root, path), text); };
  write('src/game/host.ts', `export function host(options: unknown) { return options; }
export class Base { install(options: object) { return options; } }
export interface Ports { onTick: (fn: () => void) => void }`);
  write('src/shards/sample/runtime/rows.ts', 'export const rows = { step() {} };');
  write(file, source);
  return { root, write, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('resolved host boundaries follow aliases, inherited methods, named callbacks and option spreads', () => {
  const f = fixture(`import {host as accept, Base, type Ports} from '../../../game/host';
import * as api from '../../../game/host'; import {rows} from './rows';
const named=()=>{}; const options={...rows, tick:named};
accept(options); api.host({next: named});
class Derived extends Base { go() { this.install({ready(){}}); } }
function setup(ctx:Ports, callback:()=>void) {ctx.onTick(callback);}
accept.call(null,{run:named}); accept.apply(null,[{run:named}]);`);
  try {
    const issues = hostCallbackViolations(f.root, file);
    expect(hostCallbackSites(f.root, file, parseSync(file, readFileSync(resolve(f.root, file), 'utf8')).program)).toEqual(issues);
    expect(issues).toHaveLength(7);
    expect(new Set(issues.map(row => row.module))).toEqual(new Set(['src/game/host.ts']));
    expect(issues.map(row => row.path)).toContain('arg0.*.step');
    expect(issues.some(row => row.export === 'Base' && row.member === 'install')).toBe(true);
    expect(hostAnalysis(f.root).scan(file).calls).toHaveLength(6);
  } finally { f.close(); }
});

test('ordinary helpers, array callbacks, data and build inputs do not count', () => {
  const f = fixture(`import {host} from '../../../game/host';
function local(fn:()=>void) { fn(); } local(()=>{}); [1].map(x=>x+1);
host({rows:[{value:1}]}); { const host=(fn:()=>void)=>fn(); host(()=>{}); }`);
  try {
    f.write('src/shards/sample/data/build.ts', `import {host} from '../../../game/host'; host(()=>{});`);
    f.write('src/shards/sample/runtime/module.mts', `import {host} from '../../../game/host'; host(()=>{});`);
    expect(hostCallbackViolations(f.root, file)).toEqual([]);
    expect(hostCallbackSites(f.root, file, parseSync(file, readFileSync(resolve(f.root, file), 'utf8')).program)).toEqual([]);
    expect(hostCallbackViolations(f.root, 'src/shards/sample/data/build.ts')).toEqual([]);
    expect(hostCallbackViolations(f.root, 'src/shards/sample/runtime/module.mts')).toHaveLength(1);
    for (const [target,count] of [['src/shards/sample/data/build.ts',0],['src/shards/sample/runtime/module.mts',1]] as const) {
      expect(hostCallbackSites(f.root,target,parseSync(target,readFileSync(resolve(f.root,target),'utf8')).program)).toHaveLength(count);
    }
  } finally { f.close(); }
});

test('optional and nested forwarded callbacks count without expanding platform service methods', () => {
  const f = fixture(`import {host, Base} from '../../../game/host';
function forward(options:{nested:{run?:()=>void},service:Base},yes:boolean){host(options);host(yes ? ()=>{} : null);}`);
  try {
    const issues = hostCallbackViolations(f.root, file);
    expect(hostCallbackSites(f.root, file, parseSync(file, readFileSync(resolve(f.root, file), 'utf8')).program)).toEqual(issues);
    expect(issues.map(row => row.path)).toEqual(['arg0.nested.run', 'arg0.true']);
  } finally { f.close(); }
});

test('ordinary oxlint refuses callback growth and new files, while count mode emits old debt', () => {
  const f = fixture("import {host} from '../../../game/host'; host(()=>{});");
  try {
    const baseline = resolve(f.root, 'ratchet.json'), config = resolve(f.root, 'lint.json');
    f.write('ratchet.json', JSON.stringify({ 'wildshard/no-shard-host-callback': { [file]: 1 } }));
    const run = (count: boolean) => {
      f.write('lint.json', JSON.stringify({ jsPlugins: [resolve(cwd(), 'lint/wildshard-plugin.js')], categories: { correctness: 'off' }, rules: { 'wildshard/no-shard-host-callback': ['error', { count }] } }));
      return spawnSync(execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json', '--no-ignore', resolve(f.root, file)], { env: { ...env, WILDSHARD_RATCHET_FILE: baseline }, encoding: 'utf8' });
    };
    expect(run(false).status).toBe(0);
    expect(run(true).stdout).toContain('Shard TS callback');
    f.write(file, "import {host} from '../../../game/host'; host(()=>{}); host({run(){}});");
    expect(run(false).status).toBe(1);
    f.write('ratchet.json', '{}');
    expect(run(false).status).toBe(1);
  } finally { f.close(); }
});

test('catalogue joins section fields and actual callers; pending users grant no pass', () => {
  const f = fixture("import {host} from '../../../game/host'; host('world/props');");
  try {
    f.write('node_modules/@wildshard/format/src/format/sections.ts', "export interface PlatformSections { 'world/props': { props: number[] }; 'ui/ui': { title: string } }");
    f.write('src/shards/second/runtime/main.ts', "import {host} from '../../../game/host'; host({answer:7});");
    const reference = { fields: [{ path: '$.props', type: 'array' }], abi: [{ name: 'query' }], contract: { version: 0 } };
    const result = hostCatalogue(f.root, reference), called = result.hosts.find(row => row.export === 'host'), planned = result.hosts.find(row => row.export === 'Base');
    expect(called?.users).toEqual(['sample', 'second']);
    // Both source files may be orphaned: static calls prove candidates, not live adoption.
    expect(called?.verdicts['twoRealUsers']?.status).toBe('needs-review');
    expect(called?.verdicts['dataOnly']?.status).toBe('needs-review');
    expect(planned?.users).toEqual([]);
    expect(planned?.verdicts['twoRealUsers']?.status).toBe('needs-review');
    expect(result.sections[1]?.fields.map(field => field.name)).toEqual(['props']);
    expect(result.sections[1]?.hosts).toEqual(['src/game/host.ts#host']);
    expect(result.sections[1]?.users).toEqual(['sample']);
    expect(result.fields).toEqual(reference.fields);
    expect(result.wasm.signatures).toEqual(reference.abi);
    expect(renderHostCatalogue(result)).toContain('world/props');
    expect(hostCatalogue(f.root, reference)).toEqual(result);
  } finally { f.close(); }
});

test('review credit expires on changed source and never overrides observed callbacks', () => {
  const f = fixture("import {host} from '../../../game/host'; host(()=>{});");
  try {
    const callbacks = hostCallbackViolations(f.root, file);
    const audit = { sourceHash: 'exact', evidence: 'reviewed source and live entry reach', verdicts: { twoRealUsers: 'pass', noShardNouns: 'pass', dataOnly: 'pass', serverSafe: 'fail', deletionTest: 'pass' } };
    const exact = hostVerdicts(['sample'], callbacks, audit, 'exact');
    expect(exact['noShardNouns']?.status).toBe('pass');
    expect(exact['dataOnly']?.status).toBe('fail');
    expect(exact['serverSafe']?.status).toBe('fail');
    expect(exact['twoRealUsers']?.status).toBe('pass');
    expect(hostVerdicts(['sample', 'second'], [], audit, 'changed')['twoRealUsers']?.status).toBe('needs-review');
    expect(hostVerdicts(['sample'], [], audit, 'changed')['noShardNouns']?.status).toBe('needs-review');
  } finally { f.close(); }
});


test('syntax guard follows computed access, destructuring, callback returns and nested type aliases', () => {
  const f = fixture(`import {host, Base, type Ports} from '../../../game/host';
import * as api from '../../../game/host';
const {host:send}=api; const method=api['host'];
const callback=()=>{}; function options(){return {ready:callback};}
type Nested={run?:()=>void}; interface Rows {nested:Nested; service:Base}
function forward(rows:Rows, ctx:Ports){send(rows); const {onTick:tick}=ctx;tick(callback);}
method(options()); const bound=host.bind(null); bound({run:callback});
{function host(_value:unknown){};host({ignored:callback});}
function shadow(api:{host:(value:unknown)=>void}){api.host(callback);}`);
  try {
    const source=readFileSync(resolve(f.root,file),'utf8');
    expect(hostCallbackSites(f.root,file,parseSync(file,source).program)).toEqual(hostCallbackViolations(f.root,file));
  } finally {f.close();}
});

test('syntax dependency cache follows current bytes without retaining a stale callback', () => {
  const f=fixture("import {host} from '../../../game/host';import {rows} from './rows';host(rows);");
  try {
    const program=parseSync(file,readFileSync(resolve(f.root,file),'utf8')).program;
    expect(hostCallbackSites(f.root,file,program)).toHaveLength(1);
    f.write('src/shards/sample/runtime/rows.ts','export const rows={value:1};');
    expect(hostCallbackSites(f.root,file,program)).toEqual([]);
  } finally {f.close();}
});

test('syntax callback guard runs with TypeScript compiler imports forbidden', () => {
  const f=fixture("import {host} from '../../../game/host';host({run(){}});");
  try {
    const helper=resolve('lint/host-callback-syntax.mjs');
    const child=spawnSync(execPath,['--input-type=module','-e',`
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
  if (/typescript/u.test(specifier)) throw new Error('Compiler import forbidden: '+specifier);
  return next(specifier,context);
}});
const {readFileSync}=await import('node:fs');
const {parseSync}=await import('vite');
const {hostCallbackSites}=await import(${JSON.stringify(helper)});
const program=parseSync(${JSON.stringify(file)},readFileSync(${JSON.stringify(resolve(f.root,file))},'utf8')).program;
const issues=hostCallbackSites(${JSON.stringify(f.root)},${JSON.stringify(file)},program);
if (issues.length!==1) throw new Error(JSON.stringify(issues));
`],{encoding:'utf8'});
    expect(child.stderr).toBe('');expect(child.status).toBe(0);
  } finally {f.close();}
});


test('syntax keeps generic callback constraints and imported callback aliases', () => {
  const f=fixture(`import {host} from '../../../game/host.js';
import type {Callback} from '../../../game/types';
type Bag<T>={run:T}; type DefaultBag<T=()=>void>={run:T};
function generic<T extends {run:()=>void}>(rows:T){host(rows);}
function nested(rows:Readonly<Bag<Callback>>,defaults:DefaultBag){host(rows);host(defaults);}`);
  try {
    f.write('src/game/types.ts','export type Callback=()=>void;');
    const source=readFileSync(resolve(f.root,file),'utf8');
    const issues=hostCallbackSites(f.root,file,parseSync(file,source).program);
    expect(issues.map(row=>row.path)).toEqual(['arg0.run','arg0.run','arg0.run']);
    expect(issues).toEqual(expect.arrayContaining(hostCallbackViolations(f.root,file)));
  } finally {f.close();}
});


test('syntax resolves literal computed selectors and typeof callback annotations', () => {
  const f=fixture(`import * as api from '../../../game/host';
const key='host'; const named=()=>{};
api[key]({run:named});
function forward(selector:'host',callback:typeof named){api[selector](callback);}`);
  try {
    const source=readFileSync(resolve(f.root,file),'utf8');
    expect(hostCallbackSites(f.root,file,parseSync(file,source).program)).toEqual(hostCallbackViolations(f.root,file));
    expect(hostCallbackSites(f.root,file,parseSync(file,source).program)).toHaveLength(2);
  } finally {f.close();}
});

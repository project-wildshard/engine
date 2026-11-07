// oxlint-disable-next-line import/no-nodejs-modules -- Run the actual guard in an isolated Node process.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only tiny source fixtures.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the policy source and fixture paths.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Invoke the current runtime without a shell.
import { execPath } from 'node:process';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseSync } from 'vite';
import { authoredHtmlSites } from '../lint/authored-html.mjs';

function fixture(source: string) {
  mkdirSync('tmp', {recursive:true});const root=mkdtempSync(resolve('tmp/html-syntax-'));
  const put=(file:string,text:string):string=>{const path=resolve(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);return path;};
  const file=put('src/engine/example.ts',source);
  return {root,file,put,close:()=>rmSync(root,{recursive:true,force:true})};
}
function count(source:string):number {
  const f=fixture(source);
  try {
    const direct=authoredHtmlSites(f.root,f.file);
    expect(authoredHtmlSites(f.root,f.file,parseSync(f.file,source).program)).toEqual(direct);
    return direct.length;
  }finally{f.close();}
}

test.each([
 ['node.innerHTML=label;',1],['node.outerHTML=label;',1],['node.srcdoc=label;',1],
 ['node.innerHTML+=label;',1],['node["innerHTML"]=label;',1],['const key="innerHTML";node[key]=label;',1],
 ['node.insertAdjacentHTML("beforeend",label);',1],['document.createRange().createContextualFragment(label);',1],
 ['document.write(label);',1],['const write=document.writeln;write(label);',1],
 ['const append=node.insertAdjacentHTML.bind(node);append("beforeend",label);',1],
 ['node.insertAdjacentHTML.call(node,"beforeend",label);',1],['node.insertAdjacentHTML.apply(node,["beforeend",label]);',1],
 ['Reflect.set(node,"innerHTML",label);',1],['Object.defineProperty(node,"innerHTML",{value:label});',1],
 ['const props={__html:label};',1],['const props={innerHTML:label};',1],
 ['node.textContent=label;',0],['const helper={write(value:string){}};helper.write(label);',0],
 ['node.innerHTML="<i>static</i>";',0],[`node.innerHTML=\`<b>\${42}</b>\`;`,0],
 ['node.innerHTML=label.replaceAll("<","&lt;");',1],
] as const)('sink provenance: %s', (source,expected)=>{
  expect(count(`declare const node:HTMLElement,label:string;${source}`)).toBe(expected);
});

test('numeric, boolean and literal-union data stay safe; authored strings stay unsafe',()=>{
  expect(count(`declare const node:HTMLElement,n:number,b:boolean,s:string,tag:'left'|'right';
node.innerHTML=\`<i>\${n}/\${b}/\${tag}</i>\`;
node.innerHTML=\`<i>\${s}</i>\`;
node.innerHTML=String(n);
node.innerHTML=Math.round(Number(s)).toFixed(1);
node.innerHTML=\`\${parseInt(s)}/\${s.length}\`;
`)).toBe(1);
});

test('forwarded private helpers report the unsafe caller and preserve optional defaults',()=>{
 const source=`declare const node:HTMLElement,label:string;
function fill(html=''){node.innerHTML=html;}
fill('<i>safe</i>');
fill(label);
fill();`;
 const f=fixture(source);
 try{expect(authoredHtmlSites(f.root,f.file).map(row=>row.line)).toEqual([4]);}finally{f.close();}
});

test('exported helpers cannot trust unknown callers, aliases or shadowed names',()=>{
 expect(count(`declare const node:HTMLElement,label:string;
export function fill(html:string){node.innerHTML=html;}
const safe='<i>safe</i>';{const safe=label;node.innerHTML=safe;}
const alias=label;node.innerHTML=alias;
`)).toBe(3);
});

test('mutation and property aliases cannot hide unknown markup',()=>{
 expect(count(`declare const node:HTMLElement,label:string;
let html='<i>safe</i>';html=label;node.innerHTML=html;
const row={markup:'<i>safe</i>'};const alias=row;alias.markup=label;node.innerHTML=row.markup;
`)).toBe(2);
});

test('local return values and static array map/join preserve provenance',()=>{
 expect(count(`declare const node:HTMLElement,label:string;
function wrap(value:string){return '<i>'+value+'</i>';}
node.innerHTML=wrap('safe');node.innerHTML=wrap(label);
node.innerHTML=[{n:1},{n:2}].map(row=>\`<b>\${row.n}</b>\`).join('');
node.innerHTML=[label].map(value=>\`<b>\${value}</b>\`).join('');
`)).toBe(2);
});

test('imported scalar declarations and exact trusted port identities remain distinct',()=>{
 const f=fixture(`import type {Values} from './values';import {icon as draw} from './client/ui/icons';
import type {DiscOpts} from './client/ui/hudSlots';import type {DiscOpts as Fake} from './fake';
declare const node:HTMLElement,data:Values,good:DiscOpts,bad:Fake;
node.innerHTML=\`<b>\${data.count}</b>\`;
node.innerHTML=data.label;
node.innerHTML=draw('play');
node.innerHTML=good.icon;
node.innerHTML=bad.icon;`);
 try{
  f.put('src/engine/values.ts','export interface Values{count:number;label:string}');
  f.put('src/client/engine/ui/icons.ts','export function icon(_id:string):string{return "<svg/>";}');
  f.put('src/client/engine/ui/hudSlots.ts','export interface DiscOpts{icon:string}');
  f.put('src/engine/fake.ts','export interface DiscOpts{icon:string}');
  expect(authoredHtmlSites(f.root,f.file).map(row=>row.line)).toEqual([5,8]);
 }finally{f.close();}
});

test('HTML reads require a proven DOM receiver, not an arbitrary innerHTML field',()=>{
 expect(count(`declare const node:HTMLElement,row:{innerHTML:string};
node.innerHTML=node.innerHTML;
node.innerHTML=row.innerHTML;
`)).toBe(1);
});

test('HTML analyzer runs while compiler imports are forbidden',()=>{
 const f=fixture('declare const node:HTMLElement,label:string;node.innerHTML=label;');
 try{
  const child=spawnSync(execPath,['--input-type=module','-e',`
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(/typescript/u.test(specifier))throw new Error('Compiler import forbidden');return next(specifier,context);}});
const {authoredHtmlSites}=await import(${JSON.stringify(resolve('lint/authored-html.mjs'))});
if(authoredHtmlSites(${JSON.stringify(f.root)},${JSON.stringify(f.file)}).length!==1)throw new Error('Missing refusal');
`],{encoding:'utf8'});
  expect(child.stderr).toBe('');expect(child.status).toBe(0);
 }finally{f.close();}
});

test('syntax dependencies follow changed bytes in a long-lived process',()=>{
 const f=fixture(`import {markup} from './values';declare const node:HTMLElement;node.innerHTML=markup;`);
 try{
  f.put('src/engine/values.ts','export const markup="<i>safe</i>";');
  expect(authoredHtmlSites(f.root,f.file)).toEqual([]);
  f.put('src/engine/values.ts','export const markup:string=globalThis.name;');
  expect(authoredHtmlSites(f.root,f.file)).toHaveLength(1);
  expect(readFileSync(f.file,'utf8')).toContain('node.innerHTML');
 }finally{f.close();}
});

test('reused dependency scopes still read transitive changes and new edges',()=>{
 const f=fixture(`import {markup} from './values';declare const node:HTMLElement;node.innerHTML=markup;`);
 try{
  f.put('src/engine/values.ts',`export {markup} from './leaf';`);
  f.put('src/engine/leaf.ts','export const markup="<i>safe</i>";');
  expect(authoredHtmlSites(f.root,f.file)).toEqual([]);
  expect(authoredHtmlSites(f.root,f.file)).toEqual([]);
  f.put('src/engine/leaf.ts','export const markup:string=globalThis.name;');
  expect(authoredHtmlSites(f.root,f.file)).toHaveLength(1);
  f.put('src/engine/values.ts',`export {markup} from './other';`);
  f.put('src/engine/other.ts','export const markup="<b>safe again</b>";');
  expect(authoredHtmlSites(f.root,f.file)).toEqual([]);
  f.put('src/engine/other.ts','export const markup:string=globalThis.name;');
  expect(authoredHtmlSites(f.root,f.file)).toHaveLength(1);
 }finally{f.close();}
});

test('analysis-local import lookups recheck package targets and absent files',()=>{
 const f=fixture(`import {markup} from '@wildshard/engine/game/values';declare const node:HTMLElement;node.innerHTML=markup;node.outerHTML=markup;`);
 try{
  const program=parseSync(f.file,readFileSync(f.file,'utf8')).program;
  f.put('src/game/package.json',JSON.stringify({exports:{'./values':'./first.ts'}}));
  expect(authoredHtmlSites(f.root,f.file,program)).toHaveLength(2);
  f.put('src/game/first.ts','export const markup="<b>safe</b>";');
  expect(authoredHtmlSites(f.root,f.file,program)).toEqual([]);
  f.put('src/game/second.ts','export const markup:string=globalThis.name;');
  f.put('src/game/package.json',JSON.stringify({exports:{'./values':'./second.ts'}}));
  expect(authoredHtmlSites(f.root,f.file,program)).toHaveLength(2);
  f.put('src/game/second.ts','export const markup="<b>safe again</b>";');
  expect(authoredHtmlSites(f.root,f.file,program)).toEqual([]);
 }finally{f.close();}
});

test('typed static record values remain safe through nested string helpers',()=>{
 const f=fixture(`import {engineString} from './shared/strings';declare const node:HTMLElement;
const esc=(value:string):string=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
const rows={title:engineString('title'),unrelated:()=>document.title};
const labels:Record<string,string>={video:engineString('video'),unrelated:rows.title};
function fill(html:string){node.innerHTML=html;}
fill(esc(labels.video));`);
 try{
  f.put('src/shared/engine/strings.ts','export function engineString(_id:string):string{return "<i/>";}');
  expect(authoredHtmlSites(f.root,f.file)).toEqual([]);
 }finally{f.close();}
});

test('keyof stays finite only when no declaration adds an open index signature',()=>{
 const f=fixture(`declare const node:HTMLElement;interface Keys{one:true;two:true};declare const key:keyof Keys;node.innerHTML=key;`);
 try{
  expect(authoredHtmlSites(f.root,f.file)).toEqual([]);
  f.put('src/engine/augmentation.merge.d.ts','interface Keys{[name:string]:true}');
  expect(authoredHtmlSites(f.root,f.file)).toHaveLength(1);
 }finally{f.close();}
});

test('default object arguments cannot conceal unsafe actual values',()=>{
 expect(count(`declare const node:HTMLElement,label:string;function fill(row={html:'safe'}){node.innerHTML=row.html;}fill({html:label});`)).toBe(1);
});

test('exported function values retain unknown external callers',()=>{
 expect(count(`declare const node:HTMLElement;export const fill=(html:string)=>{node.innerHTML=html;};fill('safe');`)).toBe(1);
});


test('AST sink prefilter retains native provenance diagnostics and ignores comments',()=>{
 const cases=[
  'node.innerHTML=label;',
  'const key="innerHTML";node[key]=label;',
  'const append=node.insertAdjacentHTML.bind(node);append("beforeend",label);',
  'Reflect.set(node,"innerHTML",label);',
  'Object.defineProperty(node,"innerHTML",{value:label});',
  'const props={__html:label};',
  'const write=document.writeln;write(label);',
  'node.textContent=label; // innerHTML is forbidden',
  'Object.assign(node,{textContent:label});',
 ];
 const f=fixture('export {};');
 try{
  const files=cases.map((source,index)=>f.put(`src/engine/case-${index}.ts`,`declare const node:HTMLElement,label:string;${source}`));
  const expected=files.map(file=>authoredHtmlSites(f.root,file).length);
  const config=f.put('policy.json',JSON.stringify({jsPlugins:[resolve('lint/wildshard-plugin.js')],categories:{correctness:'off'},rules:{'wildshard/no-authored-html':'error'}}));
  const result=spawnSync(resolve('node_modules/.bin/oxlint'),['--no-ignore','-c',config,'-f','json',...files],{cwd:f.root,encoding:'utf8'});
  expect(result.status,result.stderr).toBe(1);
  const output=v.parse(v.object({diagnostics:v.array(v.object({filename:v.string()}))}),JSON.parse(result.stdout));
  const counts=files.map(file=>output.diagnostics.filter(row=>resolve(f.root,row.filename)===file).length);
  expect(counts).toEqual(expected);
 }finally{f.close();}
});

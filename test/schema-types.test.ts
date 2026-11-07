// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real policy plugin against small owned inputs.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and clean isolated policy fixtures.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the exact local plugin and checker.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Pass the current executable and explicit policy location.
import { env, execPath } from 'node:process';
import { parseSync } from 'vite';
import { expect,test } from 'vitest';
import { pruneSchemaTypeAllowances,untypedSchemaExports } from '../lint/schema-types.mjs';
import { ratchetApprovalFailures,SCHEMA_TYPE_RULE } from '../scripts/ratchet-approval.mjs';

const file='src/format/sample.ts',prefix="import * as v from 'valibot';\n";
const program=(source:string)=>parseSync(file,source).program;
const exportsOf=(source:string)=>untypedSchemaExports(program(source)).map(row=>row.name);

test('syntax-only detection follows factories, aliases, wrappers and export forms',()=>{
 expect(exportsOf(`${prefix}const local=v.object({}); export {local as Public};
 const list=(schema:object)=>v.array(schema); export const Rows=list(local);
 export const HasCastSchema=v.string() as v.GenericSchema;
 export const HasSatisfiesSchema=v.string() satisfies v.GenericSchema;
 export function make(){if(true)return v.object({});return v.string();}
 export const build=()=>v.object({}); export default local;`))
 .toEqual(['Public','Rows','HasCastSchema','HasSatisfiesSchema','make','build','default']);
 expect(exportsOf("import {object as row,objectAsync as asyncRow} from 'valibot'; export const A=row({}), B=asyncRow({});")).toEqual(['A','B']);
});

test('explicit value and factory signatures pass; actions and shadowed owners are not schemas',()=>{
 expect(exportsOf(`${prefix}export const ValueSchema:v.GenericSchema<unknown,number>=v.number();
 export function make():v.GenericSchema{return v.object({});}
 export const build=():v.GenericSchema=>v.object({});
 export const finite=v.finite(); export const parsed=v.parse(ValueSchema,1);
 export const data={value:1}; export type {ValueSchema};
 export const foreign=(v:{object:()=>object})=>v.object();`)).toEqual([]);
});

test('paid-down identities retire in scope, preserve siblings, and cannot traverse outside format',()=>{
 const old={[`${file}#OldSchema`]:'existing',[`${file}#GoneSchema`]:'existing','src/format/other.ts#OtherSchema':'existing'};
 const typed=program(`${prefix}export const OldSchema:v.GenericSchema=v.object({});`);
 expect(pruneSchemaTypeAllowances(old,()=>typed,[file])).toEqual({'src/format/other.ts#OtherSchema':'existing'});
 expect(pruneSchemaTypeAllowances(old,()=>null)).toEqual({});
 expect(()=>pruneSchemaTypeAllowances({'src/format/../../outside.ts#Bad':'invalid'},()=>{throw new Error('read');})).toThrow('Invalid schema export identity');
});

test('identity replacements need approval even when their file count does not rise',()=>{
 const before={allow:{[SCHEMA_TYPE_RULE]:{[`${file}#OldSchema`]:'existing'}},[SCHEMA_TYPE_RULE]:{[file]:1}};
 const after={allow:{[SCHEMA_TYPE_RULE]:{[`${file}#NewSchema`]:'existing'}},[SCHEMA_TYPE_RULE]:{[file]:1}};
 const approval=`Ratchet-Approved: wildshard-new ${SCHEMA_TYPE_RULE} ${file} +1`;
 expect(ratchetApprovalFailures(before,after,'fix(test): replace')).toEqual([`Missing ratchet approval: ${approval}`]);
 expect(ratchetApprovalFailures(before,after,`fix(test): approve\n\n${approval}\n\nAssisted-by: Codex:gpt-6.1-sol`)).toEqual([]);
 expect(ratchetApprovalFailures(after,{allow:{[SCHEMA_TYPE_RULE]:{}}},'fix(test): lower')).toEqual([]);
});

test('ordinary fast lint admits only recorded identities and count mode exposes every untyped export',()=>{
 mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/schema-types-'));
 const target=resolve(root,file),baseline=resolve(root,'ratchet.json'),config=resolve(root,'lint.json');
 mkdirSync(resolve(target,'..'),{recursive:true});
 const run=(source:string,count=false)=>{
  writeFileSync(target,prefix+source);
  writeFileSync(config,JSON.stringify({jsPlugins:[resolve('lint/wildshard-plugin.js')],categories:{correctness:'off'},rules:{[SCHEMA_TYPE_RULE]:['error',{count}]}}));
  return spawnSync(execPath,[resolve('node_modules/oxlint/bin/oxlint'),'-c',config,'--no-ignore',target],{encoding:'utf8',env:{...env,WILDSHARD_RATCHET_FILE:baseline}});
 };
 try{
  writeFileSync(baseline,JSON.stringify({allow:{[SCHEMA_TYPE_RULE]:{[`${file}#OldSchema`]:'existing'}},[SCHEMA_TYPE_RULE]:{[file]:1}}));
  expect(run('export const OldSchema=v.object({});').status).toBe(0);
  expect(run('export const NewSchema=v.object({});').status).toBe(1);
  expect(run('export const OldSchema=v.object({}),NewSchema=v.string();').status).toBe(1);
  expect(run('export const OldSchema:v.GenericSchema=v.object({});').status).toBe(0);
  expect(run('export const OldSchema=v.object({});',true).status).toBe(1);
  writeFileSync(baseline,JSON.stringify({allow:{[SCHEMA_TYPE_RULE]:{[`${file}#OldSchema`]:'existing'}},[SCHEMA_TYPE_RULE]:{[file]:0}}));
  expect(run('export const OldSchema=v.object({});').status).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the real ratchet update lowers counts and retires paid-down identity allowances',()=>{
 mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/schema-ratchet-'));
 const target=resolve(root,file),baseline=resolve(root,'ratchet.json');
 mkdirSync(resolve(target,'..'),{recursive:true});
 try{
  writeFileSync(target,`${prefix}export const PaidSchema:v.GenericSchema=v.object({}); export const OldSchema=v.string();`);
  writeFileSync(baseline,JSON.stringify({allow:{[SCHEMA_TYPE_RULE]:{[`${file}#PaidSchema`]:'existing',[`${file}#OldSchema`]:'existing'}},[SCHEMA_TYPE_RULE]:{[file]:2}}));
  const paths=resolve(root,'paths.json');writeFileSync(paths,JSON.stringify([file]));
  const update=spawnSync(execPath,[resolve('lint/ratchet.mjs'),'--root',root,'--baseline',baseline,'--update','--files-from',paths],{encoding:'utf8'});
  expect(update.status,update.stdout+update.stderr).toBe(0);
  expect(JSON.parse(readFileSync(baseline,'utf8'))).toEqual({allow:{[SCHEMA_TYPE_RULE]:{[`${file}#OldSchema`]:'existing'}},[SCHEMA_TYPE_RULE]:{[file]:1}});
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('the approval helper executes from the copied push-tool directory without source neighbours',()=>{
 mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/schema-approval-'));
 const target=resolve(root,'ratchet-approval.mjs');
 try{
  writeFileSync(target,readFileSync(resolve('scripts/ratchet-approval.mjs'),'utf8'));
  const run=spawnSync(execPath,['--input-type=module','--eval',`const {ratchetApprovalFailures,SCHEMA_TYPE_RULE}=await import(process.argv[1]);
   const after={allow:{[SCHEMA_TYPE_RULE]:{'src/format/sample.ts#NewSchema':'existing'}}};
   process.stdout.write(JSON.stringify(ratchetApprovalFailures({},after,'')));`,target],{encoding:'utf8'});
  expect(run.status,run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual([`Missing ratchet approval: Ratchet-Approved: wildshard-new ${SCHEMA_TYPE_RULE} ${file} +1`]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

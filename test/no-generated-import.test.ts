// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual cheap lint CLI.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and retire bounded rule fixtures.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve exact fixture paths only.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the current runtime for the linter.
import {execPath} from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the defining rule beside this test.
import {fileURLToPath} from 'node:url';
import {expect,test} from 'vitest';
import {parseSync} from 'vite';
import {generatedImportContext,generatedJsonImportContext,noGeneratedJsonImportRule} from '../lint/no-generated-import.mjs';

test('G8 resolves JSON literals, query suffixes and public exports from committed snapshot bytes',()=>fixture((root,put)=>{
  put('src/game/package.json',JSON.stringify({exports:{'./rows':'./loose.generated.ts'}}));
  const files=new Map([
    ['src/game/package.json',JSON.stringify({exports:{'./rows':{types:'./owned.generated.json',default:'./owned.generated.json'},'./tables/*':'./data/*.generated.json'}})],
    ['src/game/only.generated.json','{}'],['src/game/both.generated.json','{}'],['src/game/both.generated.ts','export {};'],
  ]);
  const snapshot={files:new Set(files.keys()),read:(file:string):string=>{const value=files.get(file);if(value===undefined)throw new Error('Missing committed fixture input');return value;}};
  const generated=generatedJsonImportContext(root,snapshot);
  for(const source of ['./only.generated.json?raw#data','./only.generated','@wildshard/engine/game/rows','@wildshard/engine/game/tables/instances'])
    expect(generated('src/game/reader.ts',source)).toBe(true);
  for(const source of ['./authored.json','./owned.generated.ts','./both.generated'])expect(generated('src/game/reader.ts',source)).toBe(false);
}));

test('G8 preserves the exact old file count and refuses the next import or any new reader',()=>fixture(root=>{
  const limits={'src/game/reader.ts':2};
  const rule=noGeneratedJsonImportRule(root,limits);
  const check=(file:string,sites:number,count=false):number=>{
    const reports:unknown[]=[];
    const visitor=rule.create({filename:resolve(root,file),options:[{count}],report:issue=>{reports.push(issue);}});
    for(let i=0;i<sites;i++){
      const parsed=parseSync('reader.ts',`import rows${i} from './rows.generated.json';`);
      const node=parsed.program.body[0];if(node?.type!=='ImportDeclaration')throw new Error('Missing real import AST');
      visitor.ImportDeclaration?.(node);
    }
    return reports.length;
  };
  expect(check('src/game/reader.ts',2)).toBe(0);
  expect(check('src/game/reader.ts',3)).toBe(1);
  expect(check('src/game/new.ts',1)).toBe(1);
  expect(check('src/game/reader.ts',2,true)).toBe(2);
}));

function fixture(run:(root:string,put:(path:string,text:string)=>void)=>void):void{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/generated-import-'));
  const put=(path:string,text:string):void=>{const target=resolve(root,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,text);};
  try{run(root,put);}finally{rmSync(root,{recursive:true,force:true});}
}

test('declared outputs and public conditional exports resolve without a type program',()=>fixture((root,put)=>{
  put('src/game/package.json',JSON.stringify({exports:{'.':'./index.generated.ts','./table':{types:'./table.generated.ts',default:'./table.generated.ts'},'./rows/*':'./data/*.json'}}));
  const check=generatedImportContext(root,['src/game/index.generated.ts','src/game/table.generated.ts','src/game/data/rows.json','src/game/binary.bin'],['src/game/table.generated.ts']);
  expect(check('src/game/reader.ts','@wildshard/engine/game/table')).toBe(false);
  expect(check('src/game/reader.ts','@wildshard/game')).toBe(true);
  expect(check('src/game/reader.ts','@other/game')).toBe(false);
  expect(check('src/game/reader.ts','./table.generated')).toBe(false);
  expect(check('src/game/reader.ts','@wildshard/engine/game/rows/rows')).toBe(true);
  expect(check('test/reader.ts','../src/game/binary.bin?url')).toBe(true);
  expect(check('src/game/unit.test.ts','vitest')).toBe(false);
  expect(check('src/game/reader.ts','./authored.json')).toBe(false);
  expect(check('src/game/reader.ts','./unknown.generated.json')).toBe(true);
}));

test('actual lint covers value, type, export, dynamic and require imports with exact shrinking debt',()=>fixture((root,put)=>{
  const helper=fileURLToPath(new URL('../lint/no-generated-import.mjs',import.meta.url));
  put('scripts/source-generation-outputs.json',JSON.stringify({producers:{'scripts/rows.mjs':['src/game/rows.json','src/game/raw.bin']}}));
  put('policy.json',JSON.stringify({sources:[],files:{'src/game/old.ts':1}}));
  put('rule.mjs',`import {noGeneratedImportRule} from ${JSON.stringify(helper)};export default {meta:{name:'wildshard'},rules:{'no-generated-import':noGeneratedImportRule(${JSON.stringify(root)},${JSON.stringify(resolve(root,'policy.json'))})}};`);
  const run=(file:string,source:string,count=false)=>{
    put(file,source);put('lint.json',JSON.stringify({jsPlugins:[resolve(root,'rule.mjs')],categories:{correctness:'off'},rules:{'wildshard/no-generated-import':['error',{count}]}}));
    return spawnSync(execPath,[resolve('node_modules/oxlint/bin/oxlint'),'-c',resolve(root,'lint.json'),'--no-ignore',resolve(root,file)],{encoding:'utf8',maxBuffer:256*1024*1024});
  };
  for(const code of [
    'import rows from "./rows.json";', 'import type {X} from "./x.generated";',
    'export {X} from "./x.generated.ts";', 'export * from "./x.generated.ts";',
    'const p=import("./x.generated.json");', 'type X=import("./x.generated.json").X;',
    'const rows=require("./rows.json");', 'import bytes from "./raw.bin?url";',
  ]){const result=run('src/game/new.ts',code);expect(result.status,result.stdout+result.stderr).toBe(1);expect(result.stdout+result.stderr).toContain('NO-GENERATED-IMPORT');}
  expect(run('src/game/old.ts','import rows from "./rows.json";').status).toBe(0);
  expect(run('src/game/old.ts','import rows from "./rows.json";',true).status).toBe(1);
  expect(run('src/game/old.ts','import rows from "./rows.json";import more from "./x.generated.json";').status).toBe(1);
  expect(run('test/new.test.ts','import rows from "../src/game/rows.json";').status).toBe(1);
  expect(run('src/game/unit.test.ts','import {test} from "vitest";import {f} from "./authored";').status).toBe(0);
  expect(run('scripts/bake.mjs','import rows from "./x.generated.json";').status).toBe(0);
}));

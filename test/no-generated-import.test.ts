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
import { noGeneratedJsonImportRule } from '../lint/no-generated-import.mjs';

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

test('actual lint covers value, type, export, dynamic and require imports with exact shrinking debt',()=>fixture((root,put)=>{
  const helper=fileURLToPath(new URL('../lint/no-generated-import.mjs',import.meta.url));
  put('src/scripts/source-generation-outputs.json',JSON.stringify({producers:{'scripts/rows.mjs':['src/game/rows.json','src/game/raw.bin']}}));
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

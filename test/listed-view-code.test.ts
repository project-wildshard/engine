// oxlint-disable-next-line import/no-nodejs-modules -- Isolated ruler/register fixtures.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep fixtures inside the repository scratch directory.
import {dirname,resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {loadListedViews,listedViewInventory,type ListedViewRegister} from '../scripts/listed-view-code.mjs';
import {codeLines,sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture():string{mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/listed-view-'));owned.push(root);return root;}
function put(root:string,path:string,text:string):void{const file=resolve(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
const reason={reason:'Reviewed presentation of an existing native actor.',decision:'G570'};
function register(root:string,rows:ListedViewRegister['shards']['pine-hollow']):ListedViewRegister{
  const value:ListedViewRegister={schema:1,shards:{'pine-hollow':rows}};put(root,'lint/listed-view-code.json',JSON.stringify(value));return loadListedViews(root);
}

// LD10: a product ships no runtime TypeScript, so authored runtime is measured on the source basis
test('named view declarations partition real source custom without changing credit or closure',()=>{
  const root=fixture(),path='src/shards/pine-hollow/runtime/index.ts';
  const source=['export interface ViewRows { colour: string }','export function draw() { return "// literal"; }','export function decide() { return 4; }'].join('\n');
  platformOutput(root,'pine-hollow',{'runtime/index.ts':source});
  const before=sourceProgressInventory(root)['pine-hollow'];if(before===undefined)throw new Error('Missing fixture output');
  register(root,[{path,name:'ViewRows',...reason},{path,name:'draw',...reason}]);
  const after=sourceProgressInventory(root)['pine-hollow'];if(after===undefined)throw new Error('Missing fixture output');
  expect(after.listedView).toMatchObject({totalCustomLines:3,listedViewLines:2,otherCustomLines:1});
  expect(after.conversion).toEqual(before.conversion);expect(after.components).toEqual(before.components);
  expect(after.listedView?.register.every(row=>row.matched)).toBe(true);
});

test('whole-file and sole-export labels count only actual charged contributions',()=>{
  const root=fixture(),path='src/game/view/example.ts',source='export function draw() { return 1; }\nexport function decide() { return 2; }';
  put(root,path,source);const rows=register(root,[{path,...reason}]);
  const result=listedViewInventory(root,'pine-hollow',[{path,name:'draw',kind:'sole-export',lines:1}],1,rows);
  expect(result.listedViewLines).toBe(1);expect(result.otherCustomLines).toBe(0);
  expect(listedViewInventory(root,'pine-hollow',[],0,rows).listedViewLines).toBe(0);
});

test('physical comment handling and shared declaration lines never double-count',()=>{
  const root=fixture(),path='src/shards/pine-hollow/runtime/view.ts';
  const source='/* heading */\nexport const red = "/* colour */", blue = "// colour";\nexport function decide() {\n  return 2;\n}';
  put(root,path,source);const rows=register(root,[{path,name:'red',...reason},{path,name:'blue',...reason}]);
  const total=codeLines(source,path),result=listedViewInventory(root,'pine-hollow',[{path,kind:'runtime-ts',lines:total}],total,rows);
  expect(result.listedViewLines).toBe(1);expect(result.otherCustomLines+result.listedViewLines).toBe(total);
  expect(result.register.map(row=>row.lines)).toEqual([1,0]);expect(result.register.every(row=>row.matched)).toBe(true);
});

test('retired or uncharged view declarations stay visible without inventing lines',()=>{
  const root=fixture(),path='src/shards/pine-hollow/runtime/view.ts';put(root,path,'export const rule = 1;');
  const rows=register(root,[{path,name:'retiredView',...reason}]);
  const result=listedViewInventory(root,'pine-hollow',[{path,kind:'runtime-ts',lines:1}],1,rows);
  expect(result).toMatchObject({listedViewLines:0,otherCustomLines:1});expect(result.register[0]?.matched).toBe(false);
});

test('register refuses overlapping labels, foreign-shard paths and traversal',()=>{
  const root=fixture(),path='src/shards/pine-hollow/runtime/view.ts';
  expect(()=>register(root,[{path,...reason},{path,name:'draw',...reason}])).toThrow('Overlapping');
  expect(()=>register(root,[{path,name:'draw',...reason},{path,name:'draw',...reason}])).toThrow('Overlapping');
  expect(()=>register(root,[{path:'src/shards/driftwood-isle/runtime/view.ts',...reason}])).toThrow('another shard');
  expect(()=>register(root,[{path:'src/shards/pine-hollow/../../outside.ts',...reason}])).toThrow();
});

test('the reviewed repository register has reasons and no whole-file overlap',()=>{
  const rows=loadListedViews('.');expect(Object.keys(rows.shards)).toHaveLength(6);
  expect(readFileSync('docs/HOST-BAR.md','utf8')).toContain('lint/listed-view-code.json');
  expect(rows.shards['driftwood-isle']?.some(row=>row.path==='src/shards/driftwood-isle/quest/install.ts')).toBe(false);
});

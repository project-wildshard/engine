// oxlint-disable-next-line import/no-nodejs-modules -- Own a small throwaway git repository.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Write and read the fixture tree.
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import {dirname,resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {AGENTS_MARKER,appliedTree,headTree,main,planFailures,planSort} from '../src/scripts/sort-sides.mjs';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

const sides={
  'src/engine/sim.ts':'server',
  'src/engine/sim/step.ts':'server',
  'src/engine/ui/hud.ts':'client',
  'src/engine/ui/worker.ts':'client',
  'src/engine/core/config.ts':'shared',
  'src/engine/core/view.ts':'client',
  'src/engine/species/deer.ts':'server',
  'src/engine/species/loft.ts':'client',
  'src/game/ui/hud.ts':'client',
  'src/game/bake.ts':'cook',
} as const;
const sources:Record<string,string>={
  'src/engine/sim.ts':"export const sim=1;\n",
  'src/engine/sim/step.ts':"import {sim} from '../sim';\nimport {config} from '../core/config';\nexport const step=sim+config;\n",
  'src/engine/ui/hud.ts':"import {config} from '../core/config.ts';\nimport './hud.css';\nconst worker=new Worker(new URL('worker.ts',import.meta.url));\nimport.meta.glob(['../species/*.ts','!../species/loft.ts'],{eager:true});\nexport const hud=[config,worker,'src/engine/core/config.ts'];\n",
  'src/engine/ui/hud.css':".hud{color:red}\n",
  'src/engine/ui/hud.test.ts':"import {hud} from './hud';\nexport const seen=hud;\n",
  'src/engine/ui/worker.ts':"export const worker=1;\n",
  'src/engine/core/config.ts':"export const config=1;\n",
  'src/engine/core/view.ts':"export const view=1;\n",
  'src/engine/species/deer.ts':"export const deer=1;\n",
  'src/engine/species/loft.ts':"export const loft=1;\n",
  'src/test/engine/fake.ts':"import {config} from '../core/config';\nexport const fake=config;\n",
  'src/game/ui/hud.ts':"import {config} from '@wildshard/engine/core/config';\nexport const gameHud=config;\n",
  'src/game/bake.ts':"export const bake=readFileSync(new URL('../../budgets/a.json',import.meta.url));\n",
  'src/shards/one/run.ts':"import {step} from '../../engine/sim/step';\nimport {hud} from '@wildshard/engine/game/ui/hud';\nexport const run=[step,hud];\n",
  'test/hud.test.ts':"import {hud} from '../src/engine/ui/hud.ts';\nexport const paths=[hud,/src\\/engine\\/ui\\//u,'src/engine/core','src/engine/species/deer.ts'];\n",
  'scripts/tool.mjs':"const prefixes=['src/engine/core/'];\nexport const inCore=path=>path.startsWith('src/engine/core/')||src('engine/ui/hud.ts');\nexport {prefixes};\n",
  'docs/ENGINE.md':"The HUD is `src/engine/ui/hud.ts`; the folder is `src/engine/ui/`.\n",
  'AGENTS.md':"Do not touch src/engine/ui/hud.ts.\n",
  'budgets/a.json':"{}\n",
  'lint/ratchet.json':`${JSON.stringify({'wildshard/rule':{'src/engine/core/view.ts':1,'src/engine/ui/hud.ts':2}},null,2)}\n`,
  'lint/engine-side-edges.json':`${JSON.stringify({files:{'src/engine/ui/hud.ts':{'client → server':1}}},null,1)}\n`,
  'src/scripts/check-paths.allow.json':`${JSON.stringify([{path:'../../budgets/a.json',file:'src/game/bake.ts',why:'fixture'}],null,2)}\n`,
  'src/engine/package.json':`${JSON.stringify({name:'@wildshard/engine',exports:{'./core/config':'./core/config.ts','./ui/hud':'./ui/hud.ts'}},null,2)}\n`,
  'src/game/package.json':`${JSON.stringify({name:'@wildshard/game',exports:{'./ui/hud':'./ui/hud.ts'}},null,2)}\n`,
  'src/engine/tsconfig.json':'{}\n',
};

function git(root:string,...args:string[]):string{return execFileSync('git',args,{cwd:root,encoding:'utf8'});}
function put(root:string,files:Record<string,string>):void{
  for(const [path,text] of Object.entries(files)){mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),text);}
}
function commit(root:string):void{git(root,'add','-A');git(root,'-c','user.name=t','-c','user.email=t@t','-c','commit.gpgsign=false','commit','-qm','fixture');}
function fixture(tags:Record<string,string>=sides):string{
  mkdirSync(resolve('tmp'),{recursive:true});
  const root=mkdtempSync(resolve('tmp/sort-sides-'));roots.push(root);
  git(root,'init','-q');
  put(root,{...sources,'lint/engine-sides.json':`${JSON.stringify({about:'x',files:tags},null,1)}\n`});
  commit(root);
  return root;
}
const clean=(root:string)=>planFailures(headTree(root),planSort(headTree(root)),root);

test('rewrites AGENTS.md only below its J241 marker',()=>{
  const root=fixture(),top='# AGENTS.md\n\nJake: see `src/engine/ui/hud.ts`.\n\n';
  put(root,{'AGENTS.md':`${top}${AGENTS_MARKER}\n\n## Agent-written\n\n- Do not touch \`src/engine/ui/hud.ts\`.\n`});
  commit(root);
  const tree=headTree(root),plan=planSort(tree),after=appliedTree(tree,plan).text.get('AGENTS.md')??'';
  const moved=plan.moves.get('src/engine/ui/hud.ts');
  expect(moved).toBeDefined();
  expect(after.startsWith(`${top}${AGENTS_MARKER}\n`)).toBe(true);
  expect(after).toContain(`- Do not touch \`${moved}\`.`);
  expect(planFailures(tree,plan,root).filter(failure=>failure.includes('AGENTS.md'))).toEqual([]);
});

test('leaves an AGENTS.md at any depth alone above an exact marker line, or whole without one',()=>{
  const root=fixture(),name='`src/engine/ui/hud.ts`';
  const quoted=`# AGENTS.md\n\n${AGENTS_MARKER} is the line to add.\n\nJake: ${name}\n`;
  const crlf=`# AGENTS.md\r\n\r\nJake: ${name}\r\n${AGENTS_MARKER}\r\n\r\n## Agent-written\r\n\r\n- ${name}\r\n`;
  put(root,{'AGENTS.md':quoted,'docs/AGENTS.md':`Jake: ${name}\n`,'docs/team/AGENTS.md':crlf});
  commit(root);
  const tree=headTree(root),plan=planSort(tree),after=appliedTree(tree,plan).text;
  expect(plan.writes.has('AGENTS.md')).toBe(false);
  expect(plan.writes.has('docs/AGENTS.md')).toBe(false);
  const team=after.get('docs/team/AGENTS.md')??'',cut=crlf.indexOf(`${AGENTS_MARKER}\r\n`)+AGENTS_MARKER.length+2;
  expect(team.slice(0,cut)).toBe(crlf.slice(0,cut));
  expect(team.slice(cut)).toContain(`- \`${plan.moves.get('src/engine/ui/hud.ts')}\`\r\n`);
});

test('refuses an untagged file by name',()=>{
  const {'src/engine/core/view.ts':_view,...tags}=sides,root=fixture(tags);
  expect(clean(root)).toContain('untagged: src/engine/core/view.ts has no side in lint/engine-sides.json');
  expect(main([],root)).toBe(1);
});

test('refuses a dirty tree and a missing agent',()=>{
  const root=fixture();
  expect(main(['--apply'],root)).toBe(2);
  writeFileSync(resolve(root,'src/engine/sim.ts'),'export const sim=2;\n');
  expect(main(['--apply','--agent','a:b'],root)).toBe(1);
  expect(existsSync(resolve(root,'src/engine/sim.ts'))).toBe(true);
});

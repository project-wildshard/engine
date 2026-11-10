// oxlint-disable-next-line import/no-nodejs-modules -- Own a small throwaway git repository.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Write and read the fixture tree.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths.
import {dirname,resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {compareSideEdges} from '../lint/engine-sides.mjs';
import {unsortedPath} from '../lint/layer-exports.mjs';
import {spelledPathFailures} from '../scripts/check-spelled-paths.mjs';
import {compareCounts} from '../scripts/guard-counts.mjs';
import {AGENTS_MARKER,appliedTree,applyPlan,carryWorkingText,GATE_PHASES,gatePhaseCommand,headTree,main,planFailures,planMove,planSort} from '../scripts/sort-sides.mjs';

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
  'scripts/check-paths.allow.json':`${JSON.stringify([{path:'../../budgets/a.json',file:'src/game/bake.ts',why:'fixture'}],null,2)}\n`,
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
const json=(text:string):Record<string,Record<string,unknown>>=>JSON.parse(text) as Record<string,Record<string,unknown>>;
const clean=(root:string)=>planFailures(headTree(root),planSort(headTree(root)),root);

test('the gate proof runs the push gate\'s phases on its path lists',()=>{
  const gate=/names = \(([^)]+)\)/u.exec(readFileSync('scripts/push-loop.py','utf8'))?.[1]?.split(',').map(name=>name.trim().replaceAll("'",''));
  expect(gate?.filter(name=>name!=='tool-inputs')).toEqual(GATE_PHASES);
  const root=fixture(),from='src/game/bake.ts',to='src/cook/game/bake.ts',base=git(root,'rev-parse','HEAD').trim();
  mkdirSync(resolve(root,'src/cook/game'),{recursive:true});
  git(root,'mv',from,to);commit(root);
  const tip=git(root,'rev-parse','HEAD').trim();
  const paths=(phase:string):unknown=>JSON.parse(gatePhaseCommand(root,base,tip,phase).at(-1)??'[]');
  expect(gatePhaseCommand(root,base,tip,'binary-json')).toEqual(['scripts/no-binary-json.mjs','--range',base,tip]);
  expect(paths('deleted-paths')).toEqual([from]);
  expect(paths('storage')).toEqual([from,to]);
  // --gate-proof's candidate is in a private store: a phase's path list has to look there too.
  const store=resolve(root,'.git/private-objects');mkdirSync(store,{recursive:true});
  const env={...process.env,GIT_OBJECT_DIRECTORY:store,GIT_ALTERNATE_OBJECT_DIRECTORIES:resolve(root,'.git/objects')};
  const candidate=execFileSync('git',['-c','user.name=sort-sides','-c','user.email=sort@local','commit-tree',`${base}^{tree}`,'-p',tip,'-m','candidate'],{cwd:root,encoding:'utf8',env}).trim();
  expect(()=>gatePhaseCommand(root,tip,candidate,'storage')).toThrow();
  expect(JSON.parse(gatePhaseCommand(root,tip,candidate,'storage',env).at(-1)??'[]')).toEqual([from,to]);
});

test('plans each layer under its sides without colliding',()=>{
  const root=fixture(),plan=planSort(headTree(root));
  expect(clean(root)).toEqual([]);
  expect(plan.moves.get('src/engine/ui/hud.ts')).toBe('src/client/engine/ui/hud.ts');
  expect(plan.moves.get('src/game/ui/hud.ts')).toBe('src/client/game/ui/hud.ts');
  expect(plan.moves.get('src/engine/ui/hud.css')).toBe('src/client/engine/ui/hud.css');
  expect(plan.moves.get('src/engine/ui/hud.test.ts')).toBe('src/client/engine/ui/hud.test.ts');
  expect(plan.moves.has('src/test/engine/fake.ts')).toBe(false);
  expect(plan.moves.has('src/engine/package.json')).toBe(false);
});

test('rewrites every spelling that names a moved path',()=>{
  const root=fixture(),tree=headTree(root),plan=planSort(tree),after=appliedTree(tree,plan),text=(path:string)=>after.text.get(path)??'';
  expect(json(text('src/engine/package.json'))['exports']).toEqual({'./core/config':'./shared/core/config.ts','./ui/hud':'./client/ui/hud.ts'});
  expect(text('src/client/game/ui/hud.ts')).toContain("'@wildshard/engine/core/config'");
  expect(text('src/client/engine/ui/hud.ts')).toContain("'../../shared/core/config.ts'");
  expect(text('src/client/engine/ui/hud.ts')).toContain("new URL('worker.ts',import.meta.url)");
  expect(text('src/client/engine/ui/hud.ts')).toContain("['../../server/species/*.ts','!../species/loft.ts']");
  expect(text('src/server/engine/sim/step.ts')).toContain("'../sim'");
  expect(text('src/cook/game/bake.ts')).toContain("'../../../budgets/a.json'");
  expect(text('src/shards/one/run.ts')).toContain("'../../engine/server/sim/step'");
  expect(text('test/hud.test.ts')).toContain(String.raw`src\/(?:client|cook|server|shared)\/engine\/ui\/`);
  expect(text('test/hud.test.ts')).toContain("'src/server/engine/species/deer.ts'");
  expect(text('scripts/tool.mjs')).toContain("src('engine/client/ui/hud.ts')");
  expect(text('scripts/tool.mjs')).toContain("['src/client/engine/core/', 'src/shared/engine/core/']");
  expect(text('docs/ENGINE.md')).toContain('`src/client/engine/ui/hud.ts`');
  expect(plan.writes.has('AGENTS.md')).toBe(false);
  expect(Object.keys(json(text('lint/ratchet.json'))['wildshard/rule']??{})).toEqual(['src/client/engine/core/view.ts','src/client/engine/ui/hud.ts']);
  expect(json(text('scripts/check-paths.allow.json'))['0']).toMatchObject({path:'../../../budgets/a.json',file:'src/cook/game/bake.ts'});
});

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

test('a dry run leaves the tree alone and an apply is idempotent',()=>{
  const root=fixture(),before=git(root,'rev-parse','HEAD');
  expect(main([],root)).toBe(0);
  expect(git(root,'status','--porcelain','--','src')).toBe('');
  const tree=headTree(root);
  applyPlan(root,tree,planSort(tree));
  commit(root);
  expect(git(root,'rev-parse','HEAD')).not.toBe(before);
  const again=planSort(headTree(root));
  expect([again.moves.size,again.writes.size]).toEqual([0,0]);
  expect(clean(root)).toEqual([]);
  expect(git(root,'diff','--name-status','-M','HEAD~1','HEAD','--','src/client/engine/ui/worker.ts','src/engine/ui/worker.ts')).toMatch(/^R100/u);
});

test('a late retag after the sort moves one file and its importers follow',()=>{
  const root=fixture(),tree=headTree(root);
  applyPlan(root,tree,planSort(tree));commit(root);
  const raw=json(readFileSync(resolve(root,'lint/engine-sides.json'),'utf8'));
  put(root,{'lint/engine-sides.json':`${JSON.stringify({...raw,files:{...raw['files'],'src/client/engine/core/view.ts':'shared'}},null,1)}\n`});commit(root);
  const plan=planSort(headTree(root));
  expect([...plan.moves]).toEqual([['src/client/engine/core/view.ts','src/shared/engine/core/view.ts']]);
  expect(clean(root)).toEqual([]);
});

const sorted=():string=>{const root=fixture(),tree=headTree(root);applyPlan(root,tree,planSort(tree));commit(root);return root;};

test('--move plans a retag from HEAD on a dirty tree and takes its test with it',()=>{
  const root=sorted();
  put(root,{'src/client/engine/core/view.test.ts':"import {view} from './view';\nexport const seen=view;\n"});commit(root);
  put(root,{'src/client/engine/ui/hud.ts':'// a lane is here\n'});
  const {tree,plan}=planMove(headTree(root),['src/client/engine/core/view.ts'],'shared'),after=appliedTree(tree,plan);
  expect([...plan.moves]).toEqual([['src/client/engine/core/view.test.ts','src/shared/engine/core/view.test.ts'],['src/client/engine/core/view.ts','src/shared/engine/core/view.ts']]);
  expect(planFailures(tree,plan,root)).toEqual([]);
  expect(json(after.text.get('lint/engine-sides.json')??'')['files']).toMatchObject({'src/shared/engine/core/view.ts':'shared'});
  expect(Object.keys(json(after.text.get('lint/ratchet.json')??'')['wildshard/rule']??{})).toContain('src/shared/engine/core/view.ts');
  expect(git(root,'status','--porcelain','--','src/client/engine/core')).toBe('');
});

test('--move leaves a folder literal that still names its side',()=>{
  const root=sorted();
  put(root,{'scripts/names.mjs':"export const dir='src/client/engine/ui';\n"});commit(root);
  const {tree,plan}=planMove(headTree(root),['src/client/engine/ui/worker.ts'],'shared');
  expect(planFailures(tree,plan,root)).toEqual([]);
  expect(plan.writes.has('scripts/names.mjs')).toBe(false);
});

test('--move follows the root spelling of an isolated declaration test',()=>{
  const root=sorted();
  put(root,{'src/engine/isolated-x.test.ts':"const names=[\"client/core/view\",\"client/ui/hud\"];\nconst source=\"import {view} from './client/core/view';\\n\";\n"});commit(root);
  const {tree,plan}=planMove(headTree(root),['src/client/engine/core/view.ts'],'shared');
  expect(plan.writes.get('src/engine/isolated-x.test.ts')).toBe("const names=[\"shared/core/view\",\"client/ui/hud\"];\nconst source=\"import {view} from './shared/core/view';\\n\";\n");
  expect(planFailures(tree,plan,root)).toEqual([]);
});

test('--move follows what a generator emits and what a shard map declares',()=>{
  const root=sorted(),emitted="export const table=`import {view} from '../../engine/client/core/view';\nimport {hud} from '../../engine/client/ui/hud';\n`;\nexport const near=\"import './engine/client/core/view';\";\n";
  put(root,{'scripts/gen-table.mjs':emitted,'src/shards/one/data/map.json':'{"inputs":["../../engine/client/core/view.ts","../../engine/client/ui/hud.ts","generators"]}\n'});commit(root);
  const {tree,plan}=planMove(headTree(root),['src/client/engine/core/view.ts'],'shared');
  expect(plan.writes.get('scripts/gen-table.mjs')).toBe(emitted.replaceAll('engine/client/core/view','engine/shared/core/view'));
  expect(plan.writes.get('src/shards/one/data/map.json')).toBe('{"inputs":["../../engine/shared/core/view.ts","../../engine/client/ui/hud.ts","generators"]}\n');
  expect(planFailures(tree,plan,root)).toEqual([]);
});
test('the spelled-path guard names what no resolver reads',()=>{
  const files=new Map([['src/client/engine/core/view.ts',''],['src/shards/one/generators/x.ts','']]);
  const rows:Record<string,string>={
    'src/engine/isolated-x.test.ts':"const names=[\"client/core/view\",\"server/core/view\"];\nconst source=\"import './shared/gone';\";\n",
    'scripts/gen-table.mjs':"export const a=\"import '../../engine/client/core/view';\";export const b=\"import '../../engine/server/core/view';\";\n",
    'src/shards/one/data/map.json':'{"inputs":["generators","absent-is-allowed.json","../../engine/client/core/view.ts","../../sdk/bake/gone.ts","../../../public/assets/x.glb"]}\n',
  };
  for(const path of Object.keys(rows))files.set(path,'');
  expect(spelledPathFailures(files,path=>rows[path]??'').map(row=>row.split(': ').slice(0,2).join(': '))).toEqual([
    'src/engine/isolated-x.test.ts: no module at src/server/engine/core/view',
    'src/engine/isolated-x.test.ts: no module at src/shared/engine/gone',
    'scripts/gen-table.mjs: no module at src/server/engine/core/view',
    'src/shards/one/data/map.json: input ../../sdk/bake/gone.ts is gone',
  ]);
});
test('--move refuses an untagged path, a wrong side and a file already there',()=>{
  const tree=headTree(sorted());
  expect(()=>planMove(tree,['src/client/engine/core/none.ts'],'shared')).toThrow(/no tag/u);
  expect(()=>planMove(tree,['src/client/engine/core/view.ts'],'moon')).toThrow(/not one of/u);
  expect(()=>planMove(tree,['src/client/engine/core/view.ts'],'client')).toThrow(/already client/u);
});

test('a move carries other lanes\' working text and keeps their hunks',()=>{
  const root=sorted();
  put(root,{'src/client/engine/core/peer.ts':"import {view} from './view';\nexport const peer=view;\n"});commit(root);
  put(root,{
    'src/client/engine/core/peer.ts':"import {view} from './view';\nexport const peer=[view,'a lane'];\n",
    'src/client/engine/core/view.ts':"export const view=2; // a lane\n",
    'src/client/engine/core/fresh.ts':"export {view} from './view';\n",
  });
  const paths=['src/client/engine/core/view.ts'],{tree,plan}=planMove(headTree(root),paths,'shared');
  const {carried,refused}=carryWorkingText(root,tree,plan,paths,'shared');
  expect(refused).toEqual([]);
  expect(carried.sort()).toEqual(['src/client/engine/core/fresh.ts','src/client/engine/core/peer.ts','src/shared/engine/core/view.ts']);
  expect(readFileSync(resolve(root,'src/client/engine/core/peer.ts'),'utf8')).toBe("import {view} from '../../shared/core/view';\nexport const peer=[view,'a lane'];\n");
  expect(readFileSync(resolve(root,'src/client/engine/core/fresh.ts'),'utf8')).toContain("'../../shared/core/view'");
  expect(readFileSync(resolve(root,'src/shared/engine/core/view.ts'),'utf8')).toContain('a lane');
  expect(existsSync(resolve(root,'src/client/engine/core/view.ts'))).toBe(false);
});

test('undo returns a failed apply to HEAD',()=>{
  const root=fixture(),tree=headTree(root);
  expect(main([],root)).toBe(0);
  applyPlan(root,tree,planSort(tree));
  writeFileSync(resolve(root,'src/client/engine/ui/stray.generated.ts'),'export {};\n');
  expect(main(['--undo'],root)).toBe(0);
  expect(git(root,'status','--porcelain','--','src','lint','scripts','test')).toBe('');
  expect(existsSync(resolve(root,'src/client/engine'))).toBe(false);
});

test('ratchets read a side move as the same file',()=>{
  expect(unsortedPath('src/server/game/quest/a.ts')).toBe('src/game/quest/a.ts');
  expect(unsortedPath('src/commons/server/a.ts')).toBe('src/commons/server/a.ts');
  expect(unsortedPath('src/sharddev/server/a.ts')).toBe('src/server/host/server/a.ts');
  const edge='client → server';
  expect(compareSideEdges({files:{'src/engine/ui/a.ts':{[edge]:2}}},{files:{'src/client/engine/ui/a.ts':{[edge]:2}}})).toEqual([]);
  expect(compareSideEdges({files:{'src/engine/ui/a.ts':{[edge]:2}}},{files:{'src/client/engine/ui/a.ts':{[edge]:3}}})).toHaveLength(1);
  const moved=compareCounts({'wildshard/rule':{'src/engine/ui/a.ts':1}},{'wildshard/rule':{'src/client/engine/ui/a.ts':1}},new Set(),undefined);
  expect(moved.failures).toEqual([]);
});

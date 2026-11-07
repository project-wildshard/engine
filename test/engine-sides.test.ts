// oxlint-disable-next-line import/no-nodejs-modules -- Run the real rule in an owned fixture.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and retire bounded source fixtures.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only exact rule and fixture paths.
import {dirname,resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use this runtime for the local linter.
import {execPath} from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the defining rule beside this test.
import {fileURLToPath} from 'node:url';
import {expect,test} from 'vitest';
import {SIDES_FILE,SIDE_EDGES_FILE,compareSideEdges,readEdges,readSides,sideCensus} from '../lint/engine-sides.mjs';

// P1-E2: the ownership map's rule, run for real through oxlint on a fixture tree.
test('a new forbidden edge, DOM or renderer use, or an untagged file fails; recorded debt passes',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/engine-sides-'));
  const sides=resolve(root,'sides.json'),edges=resolve(root,'edges.json'),config=resolve(root,'lint.json'),plugin=resolve(root,'rule.mjs');
  const helper=fileURLToPath(new URL('../lint/engine-sides.mjs',import.meta.url));
  writeFileSync(plugin,`import {engineSidesRule} from ${JSON.stringify(helper)};export default {meta:{name:'wildshard'},rules:{'engine-sides':engineSidesRule(${JSON.stringify(sides)},${JSON.stringify(edges)})}};`);
  writeFileSync(config,JSON.stringify({jsPlugins:[plugin],categories:{correctness:'off'},rules:{'wildshard/engine-sides':'error'}}));
  writeFileSync(sides,JSON.stringify({files:{
    'src/engine/view/hud.ts':'client','src/engine/view/meter.ts':'client','src/engine/sim/law.ts':'server',
    'src/engine/sim/motor.ts':'shared','src/game/old.ts':{side:'server',mixed:true},
  }}));
  writeFileSync(edges,JSON.stringify({files:{'src/game/old.ts':{'server → client':1}}}));
  const run=(file:string,source:string)=>{
    const target=resolve(root,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);
    const result=spawnSync(execPath,[resolve('node_modules/oxlint/bin/oxlint'),'-c',config,'--no-ignore',target],{encoding:'utf8'});
    return {status:result.status,out:result.stdout+result.stderr};
  };
  try{
    for(const file of ['src/engine/view/hud.ts','src/engine/view/meter.ts','src/engine/sim/law.ts'])run(file,'export const x = 1;');
    // recorded: one server → client edge in the mixed file
    expect(run('src/game/old.ts',"import {x} from '@wildshard/engine/view/hud';export const y = x;").status).toBe(0);
    // a second client import from the same file rises above the recorded count
    const rise=run('src/game/old.ts',"import {x} from '@wildshard/engine/view/hud';import {x as z} from '../engine/view/meter';export const y = x + z;");
    expect(rise.status,rise.out).toBe(1);expect(rise.out).toContain('server → client');
    // shared may import neither side; client may not import server
    expect(run('src/engine/sim/motor.ts',"import {x} from './law';export const y = x;").out).toContain('shared → server');
    expect(run('src/engine/sim/motor.ts',"import {x} from '../view/hud';export const y = x;").status).toBe(1);
    expect(run('src/engine/view/hud.ts',"import {x} from '../sim/law';export const y = x;").out).toContain('client → server');
    // type-only imports erase; maths types from three are headless
    expect(run('src/engine/sim/motor.ts',"import type {x} from './law';import {Vector3,type Mesh} from 'three';export const y: typeof x = 1;export const v = new Vector3();export type M = Mesh;").status).toBe(0);
    // no renderer and no DOM on the headless sides
    expect(run('src/engine/sim/motor.ts',"import {Mesh} from 'three';export const m = new Mesh();").out).toContain('shared → render');
    expect(run('src/engine/sim/motor.ts',"import * as THREE from 'three';export const m = new THREE.Mesh();").out).toContain('shared → render');
    expect(run('src/engine/sim/motor.ts',"import * as THREE from 'three';export const v = new THREE.Vector3();").status).toBe(0);
    expect(run('src/engine/sim/law.ts',"export const w = document.body;").out).toContain('server → dom');
    expect(run('src/engine/sim/law.ts',"export const w = typeof window;").out).toContain('server → dom');
    expect(run('src/engine/view/hud.ts',"export const w = document.body;").status).toBe(0);
    // a new file must be tagged; tests are not
    const untagged=run('src/game/fresh.ts','export const x = 1;');
    expect(untagged.status).toBe(1);expect(untagged.out).toContain('has no side');
    expect(run('src/game/fresh.test.ts','export const x = 1;').status).toBe(0);
    expect(run('src/shards/x/fresh.ts','export const x = 1;').status).toBe(0);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('the recorded counts only fall from one commit to the next',()=>{
  const before={files:{'src/game/a.ts':{'server → client':2},'src/engine/b.ts':{'shared → dom':1}}};
  expect(compareSideEdges(undefined,before)).toEqual([]);
  expect(compareSideEdges(before,{files:{'src/game/a.ts':{'server → client':1}}})).toEqual([]);
  expect(compareSideEdges(before,{files:{'src/game/a.ts':{'server → client':3}}})[0]).toContain('rose 2 → 3');
  expect(compareSideEdges(before,{files:{...before.files,'src/game/c.ts':{'client → server':1}}})[0]).toContain('src/game/c.ts client → server rose 0 → 1');
  expect(compareSideEdges(before,undefined)[0]).toContain('removed');
  // A file that moves side trades its edges for the other side's; its total can't rise.
  const moved={files:{'src/server/game/a.ts':{'server → client':6}}};
  expect(compareSideEdges(moved,{files:{'src/client/game/a.ts':{'client → server':1}}})).toEqual([]);
  expect(compareSideEdges(moved,{files:{'src/client/game/a.ts':{'client → server':7}}})[0]).toContain('rose 6 → 7 across its move');
  expect(compareSideEdges(before,{files:{'src/game/a.ts':{'client → shared':1}}})[0]).toContain('invalid');
});

test('every engine and game file is tagged and no count is above the ratchet',()=>{
  const sides=readSides(JSON.parse(readFileSync(SIDES_FILE,'utf8')));
  const recorded=readEdges(JSON.parse(readFileSync(SIDE_EDGES_FILE,'utf8')));
  const census=sideCensus(resolve('.'),sides);
  expect(census.untagged).toEqual([]);
  const rises=Object.entries(census.counts).flatMap(([path,edges])=>Object.entries(edges)
    .filter(([edge,count])=>count>(recorded[path]?.[edge]??0)).map(([edge,count])=>`${path} ${edge} ${count}`));
  expect(rises).toEqual([]);
});

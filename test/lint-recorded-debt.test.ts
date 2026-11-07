// oxlint-disable-next-line import/no-nodejs-modules -- Run the installed real policy plugin against owned fixtures.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the source and policy fixtures.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture files retain production-relative source paths.
import {dirname,resolve} from 'node:path';
import * as v from 'valibot';
import {expect,test} from 'vitest';
import {hardRules,readLintConfig} from '../scripts/guard-counts.mjs';

test.each([
  ['no-raw-random-time','src/engine/example.ts','Math.random();','Math.random();'],
  ['shard-sandbox','src/shards/pine-hollow/runtime/example.ts','window.innerWidth;','window.innerHeight;'],
  ['shard-game-imports','src/shards/pine-hollow/generators/example.ts',"import {a} from '@wildshard/engine/game/shard/context';","import {b} from '@wildshard/engine/game/shard/context';"],
  ['shard-game-plugins','src/shards/pine-hollow/runtime/example.ts',"import {a} from '@wildshard/engine/game/shard/context';","import {b} from '@wildshard/engine/game/shard/context';"],
  ['generator-imports','src/shards/pine-hollow/generators/example.ts',"import {a} from '@wildshard/engine/core/Game';","import {b} from '@wildshard/engine/core/Game';"],
  ['shard-engine-imports','src/shards/pine-hollow/generators/example.ts',"import {a} from '@wildshard/engine/core/Game';","import {b} from '@wildshard/engine/core/Game';"],
  ['sdk-no-facade','src/sharddev/example.ts',"export {a} from '@wildshard/engine/game/shard/context';","export {b} from '@wildshard/engine/game/shard/context';"],
])('%s preserves its recorded ceiling and the original raw detection', (name,file,first,second)=>{
  if(name===undefined||file===undefined||first===undefined||second===undefined)throw new Error('Incomplete rule fixture');
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/lint-debt-rule-'));
  const config=resolve(root,'lint.json'),policy=resolve(root,'debt.json'),target=resolve(root,file),rule=`wildshard/${name}`;
  mkdirSync(dirname(target),{recursive:true});writeFileSync(policy,JSON.stringify({[rule]:{[file]:1}}));
  const run=(source:string,ratchet:boolean)=>{
    writeFileSync(target,source);writeFileSync(config,JSON.stringify({jsPlugins:[resolve('lint/wildshard-plugin.js')],categories:{correctness:'off'},
      rules:{[rule]:ratchet?['error',{ratchet:true}]:'error'}}));
    return spawnSync(resolve('node_modules/.bin/oxlint'),['-c',config,'--no-ignore','--threads=1',target],
      {encoding:'utf8',timeout:10_000,maxBuffer:8*1024*1024,env:{...process.env,WILDSHARD_RATCHET_FILE:policy}});
  };
  try {
    const existing=run(first,true);expect(existing.status,existing.stdout+existing.stderr).toBe(0);
    const growth=run(first+second,true);expect(growth.status,growth.stdout+growth.stderr).toBe(1);
    expect(growth.stdout).toContain('recorded debt 1, observed 2');
    const raw=run(first,false);expect(raw.status,raw.stdout+raw.stderr).toBe(1);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('ordinary lint enforces exact recorded file counts while raw census still reports every site',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/lint-recorded-debt-'));
  const config=resolve(root,'lint.json'),policy=resolve(root,'debt.json');
  const file='src/engine/example.ts',other='src/engine/other.ts';
  const put=(path:string,source:string):string=>{const target=resolve(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);return target;};
  const run=(path:string,source:string,ratchet=true,limit:unknown=1)=>{
    writeFileSync(policy,JSON.stringify({'wildshard/no-raw-random-time':{[file]:limit}}));
    writeFileSync(config,JSON.stringify({jsPlugins:[resolve('lint/wildshard-plugin.js')],categories:{correctness:'off'},
      rules:{'wildshard/no-raw-random-time':ratchet?['error',{ratchet:true}]:'error'}}));
    return spawnSync(resolve('node_modules/.bin/oxlint'),['-c',config,'--no-ignore','--threads=1',put(path,source)],
      {encoding:'utf8',timeout:10_000,maxBuffer:8*1024*1024,env:{...process.env,WILDSHARD_RATCHET_FILE:policy}});
  };
  try {
    expect(run(file,'Math.random();').status).toBe(0);
    expect(run(file,'export const clean=1;').status).toBe(0);
    const growth=run(file,'Math.random();Math.random();');expect(growth.status,growth.stdout+growth.stderr).toBe(1);
    expect(growth.stdout).toContain('recorded debt 1, observed 2');
    expect(run(other,'Math.random();').status).toBe(1);
    expect(run(file,'Math.random();',false).status).toBe(1);
    expect(run('scripts/tool.mjs','Math.random();').status).toBe(0);
    // LD6 retired the last registered frozen source: appending -legacy grants no census exemption.
    expect(run('src/shards/retired-fixture-legacy/plugin.ts','Math.random();').status).toBe(1);
    for(const invalid of [-1,1.5,'1',null])expect(run(file,'Math.random();',true,invalid).status).not.toBe(0);
    const configData=v.parse(v.object({rules:v.record(v.string(),v.unknown()),overrides:v.array(v.object({files:v.optional(v.array(v.string())),rules:v.optional(v.record(v.string(),v.unknown()))}))}),
      readLintConfig(resolve('.oxlintrc.json'))),hard=hardRules(resolve('.oxlintrc.json'));
    for(const name of ['no-raw-random-time','shard-sandbox','shard-game-imports','shard-game-plugins','generator-imports','shard-engine-imports','sdk-no-facade']) {
      const rule=`wildshard/${name}`;
      expect(configData.overrides.find(row=>row.files?.includes('src/**/*'))?.rules?.[rule]).toEqual(['error',{ratchet:true}]);
      expect(configData.rules[rule]).toBeUndefined();expect(hard.has(rule)).toBe(false);
      expect(configData.overrides?.some(row=>row.rules?.[rule]==='off')).toBe(false);
    }
    expect(readFileSync('scripts/typecheck-lint.sh','utf8')).not.toContain('lint:ratchet');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('the actual lint configuration applies source debt only to the primary source tree',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/lint-debt-scope-'));
  const config=resolve(root,'lint.json');
  const original=v.parse(v.object({jsPlugins:v.array(v.string()),options:v.record(v.string(),v.unknown())}),readLintConfig(resolve('.oxlintrc.json')));
  // Same real rules/overrides and plugin, with fast syntax execution for these
  // owned JS fixtures, which have no TypeScript project. No rule is disabled.
  writeFileSync(config,JSON.stringify({...readLintConfig(resolve('.oxlintrc.json')),
    jsPlugins:original.jsPlugins.map(file=>resolve(file)),options:{...original.options,typeAware:false}}));
  try {
    for(const folder of ['src','src/game','drafts/src','admin/src']) {
      const file=resolve(root,folder,'clock.js');mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,'export const measured = performance.now();\n');
      const result=spawnSync(resolve('node_modules/.bin/oxlint'),['-c',config,'--threads=1',file],
        {encoding:'utf8',timeout:10_000,maxBuffer:8*1024*1024});
      const primary=folder==='src'||folder.startsWith('src/');
      expect(result.status,folder+result.stdout+result.stderr).toBe(primary?1:0);
      expect(result.stdout.includes('recorded debt')).toBe(primary);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});

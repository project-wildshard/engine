import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated ruler fixtures only.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confined fixture paths.
import {join,dirname} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small disposable test roots.
import {tmpdir} from 'node:os';
import {componentInventory,componentStates} from '../scripts/shard-components.mjs';
import {codeLines,sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';

test('crumbs stay with their file while executable owner APIs keep their component',()=>{
  const root=mkdtempSync(join(tmpdir(),'component-crumbs-'));
  const path='src/shards/nalati-grasslands/runtime/facts.ts';
  const source=[
    "import {windFx} from './windFx';",
    "export {weapon} from './weapon';",
    "export * from './audio';",
    'export class State {',
    '  windFx = windFx;',
    '  weapon?: string;',
    '  audio = this.voice;',
    '  run() { windFx(); }',
    '}',
    'export const value = windFx({weapon: 1});',
  ].join('\n');
  try {
    mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),source);
    const lines=codeLines(source,path),result=componentInventory(root,'nalati-grasslands',[{path,kind:'runtime-ts',lines}],lines);
    expect(result.total).toBe(lines);
    expect(result.unknown).toEqual([]);
    expect(result.counts).toEqual({C1:0,C2:0,C3:1,C4:0,C5:0,C6:1,C7:0,C8:0,C9:8});
    expect(result.spans.filter(row=>row.reason==='file owner wiring').reduce((sum,row)=>sum+row.lines,0)).toBe(6);
  }finally{rmSync(root,{recursive:true,force:true});}
});

// LD10: a product ships no runtime TypeScript, so authored runtime roots its G294 users on the source basis
test('type-only users share their declarations without sharing unrelated combat exports',()=>{
  const root=mkdtempSync(join(tmpdir(),'combat-type-users-'));
  const put=(path:string,source:string):void=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),source);};
  try {
    put('src/engine/package.json',JSON.stringify({name:'@wildshard/engine',exports:{'./combat/types':'./combat/types.ts','./combat/targets':'./combat/targets.ts'}}));
    put('src/shared/engine/combat/targets.ts','export interface RayTargets { distance: number }\nexport function authoredTargets() { return 1; }');
    put('src/client/app/entry.ts',"import {authoredTargets} from '@wildshard/engine/combat/targets'; authoredTargets();");
    put('src/client/engine/combat/types.ts',[
      'export interface EffectDef { id: string }',
      'export interface SourceMulDef { mul: number }',
      'const anyTag = () => true;',
      'export function sourceMultiplier(rows: SourceMulDef[]) { return anyTag() ? rows.length : 0; }',
    ].join('\n'));
    platformOutput(root,'nalati-grasslands',{'runtime/index.ts':"import {sourceMultiplier,type EffectDef} from '@wildshard/engine/combat/types'; import type {RayTargets} from '@wildshard/engine/combat/targets'; export const value=sourceMultiplier([]); export type Effect=EffectDef; export type Ray=RayTargets;"});
    const only=sourceProgressInventory(root)['nalati-grasslands'];
    expect(only?.conversion.gameSystemAttribution.modules).toContainEqual({path:'src/client/engine/combat/types.ts',lines:4});
    platformOutput(root,'pine-hollow',{'runtime/index.ts':"import type {EffectDef} from '@wildshard/engine/combat/types'; export type Effect=EffectDef;"});
    platformOutput(root,'driftwood-isle',{'runtime/index.ts':"export type {EffectDef} from '@wildshard/engine/combat/types';"});
    const rows=sourceProgressInventory(root);
    expect(rows['nalati-grasslands']?.conversion.gameSystemAttribution.modules).toEqual([{path:'src/shared/engine/combat/targets.ts',lines:2}]);
    expect(rows['nalati-grasslands']?.conversion.gameSystemAttribution.exports.map(row=>row.name)).toEqual(['SourceMulDef','anyTag','sourceMultiplier']);
    expect(rows['pine-hollow']?.conversion.gameSystemAttribution.lines).toBe(0);
    expect(rows['driftwood-isle']?.conversion.gameSystemAttribution.lines).toBe(0);
    platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {type SourceMulDef} from '@wildshard/engine/combat/types'; export type Source=SourceMulDef;"});
    expect(sourceProgressInventory(root)['nalati-grasslands']?.conversion.gameSystemAttribution.exports.map(row=>row.name)).toEqual(['anyTag','sourceMultiplier']);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('borrowed service fields retain their owner; calls and tuning keep semantics', () => {
  const root = mkdtempSync(join(tmpdir(), 'component-borrowed-'));
  const path = 'src/shards/nalati-grasslands/runtime/facts.ts';
  const source = [
    'export const field = { audio: services.audio };',
    'const {audio, score} = services;',
    'const audio = services.audio;',
    "const cues = book.presentations.get('night');",
    'export const direct = installAudio();',
    'export const row = { score: true };',
  ].join('\n');
  try {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source);
    const lines = codeLines(source, path), result = componentInventory(root, 'nalati-grasslands', [{ path, kind: 'runtime-ts', lines }], lines);
    expect(result.counts.C8).toBe(2);
    expect(result.counts.C9).toBe(4);
    expect(result.total).toBe(lines);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('known zeros close; pending charges stay closing and unresolved owners stay in C9', () => {
  const inventory = (lines: number) => componentInventory('', 'nalati-grasslands',
    [{ path: 'src/shards/nalati-grasslands/ride/charged.ts', kind: 'sole-export', lines }], lines);
  const pending = inventory(93); pending.unknown.push('unresolved boot binding');
  const states = componentStates({ nalati: { components: pending } }, ['nalati'], ['C7']);
  expect(states.C8.state).toBe('closed'); expect(states.C7.state).toBe('closing'); expect(states.C9.state).toBe('open');
  expect(states.C7.lines['nalati']).toBe(93);
  expect(componentStates({ nalati: { components: inventory(0) } }, ['nalati'], ['C7']).C7.state).toBe('closed');
  expect(componentStates({}, ['missing'], ['C7']).C8.closed).toBe(false);
});

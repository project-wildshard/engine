import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parseCarriedQuest } from '@wildshard/format/questSteps';
import { parse, object, number } from 'valibot';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import type { Scope } from '../../../src/shared/engine/app/scope';
import { frozenRuntimeJson } from './snapshots';
import { frozenAsset } from './assets';
export const carriedQuestRows = parseCarriedQuest(frozenRuntimeJson('carried-quest.json'));
export const carriedPropFiles = new Map([['models/specimens/quest-prop.bin', frozenAsset('carried-prop.bin')]]);
const script = parseDecisionScripts([carriedQuestRows.program.script])[0];
if (script === undefined) throw new Error('Missing original carried quest script');
const module = script.module;
const modules = new Map([[module.slice('blobs/wasm/'.length, -'.wasm'.length), frozenAsset('kokpar.wasm')]]);
export function lendFrozenKokpar(owner: Scope): void {
  ReturnProgram.lendModules(owner, modules, parseDecisionScripts([carriedQuestRows.program.script]));
}
export const KOKPAR = parse(object({x:number(),z:number(),rx:number(),rz:number(),rot:number()}),frozenRuntimeJson('kokpar-layout.json'));
/** Independent predecessor oval formula; never computed from the runtime pose graph. */
export function kokparOval(t: number, k: number): {x:number;z:number} {
  const c=Math.cos(KOKPAR.rot),s=Math.sin(KOKPAR.rot),lx=Math.cos(t)*KOKPAR.rx*k,lz=Math.sin(t)*KOKPAR.rz*k;
  return {x:KOKPAR.x+lx*c+lz*s,z:KOKPAR.z-lx*s+lz*c};
}

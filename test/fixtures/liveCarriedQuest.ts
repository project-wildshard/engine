// ZONE-SNAPSHOTS ZS9 (J507): Nalati's live Kokpar quest (quests/carried.json), its carried prop and its decision guest,
// read from the live pin; the Kokpar oval is a hand-written oracle, never computed from the runtime pose graph.
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parseCarriedQuest } from '@wildshard/format/questSteps';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import type { Scope } from '../../src/shared/engine/app/scope';
import { liveBytes, liveJson, livePath } from './livePin';
const NALATI = 'nalati-grasslands';
export const carriedQuestRows = parseCarriedQuest(liveJson(NALATI, 'quests/carried.json'));
export const carriedPropFiles = new Map([['models/specimens/quest-prop.bin', liveBytes(NALATI, 'models/specimens/quest-prop.bin')]]);
const script = parseDecisionScripts([carriedQuestRows.program.script])[0];
if (script === undefined) throw new Error('Missing live carried quest script');
const modules = new Map([[script.module.slice('blobs/wasm/'.length, -'.wasm'.length), livePath(NALATI, script.module)]]);
export function lendLiveKokpar(owner: Scope): void {
  ReturnProgram.lendModules(owner, modules, parseDecisionScripts([carriedQuestRows.program.script]));
}
/** Nalati's Kokpar oval as authored (centre, radii and turn), written down by hand as the test's independent oracle. */
export const KOKPAR = { x: -61, z: 36, rx: 34, rz: 22, rot: 0.25 } as const;
export function kokparOval(t: number, k: number): {x:number;z:number} {
  const c=Math.cos(KOKPAR.rot),s=Math.sin(KOKPAR.rot),lx=Math.cos(t)*KOKPAR.rx*k,lz=Math.sin(t)*KOKPAR.rz*k;
  return {x:KOKPAR.x+lx*c+lz*s,z:KOKPAR.z-lx*s+lz*c};
}

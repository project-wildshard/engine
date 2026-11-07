import * as v from 'valibot';
import type { Scope } from '../../src/shared/engine/app/scope';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { ReturnProjectionV2Schema } from '@wildshard/format/returnProjectionV2';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import { NALATI_TITAN, NALATI_TITAN_PROGRAMS } from './nalati-titan';
import { originalHeldMetadata } from './nalati-held-original';
import { originalSpeciesFile } from './nalati-original-species';
import { NALATI_ADMISSION, NALATI_ADMISSION_PROGRAM } from './nalati-admission';

const attack = NALATI_TITAN_PROGRAMS.attack.v2, wind = NALATI_TITAN_PROGRAMS.wind.v2;
const held = v.parse(v.object({ program: v.strictObject({ ...ReturnProgramSchema.entries, v2: ReturnProjectionV2Schema }) }), originalHeldMetadata().held).program;
const heldScript = parseDecisionScripts([held.script])[0];
if (heldScript === undefined) throw new Error('Missing actual held script');
const admission = v.parse(v.object({ script: v.unknown(), v2: ReturnProjectionV2Schema }), NALATI_ADMISSION);
const admissionScript = parseDecisionScripts([admission.script])[0];
if (admissionScript === undefined) throw new Error('Missing actual admission script');
const modules = new Map([
  [NALATI_TITAN_PROGRAMS.attack.script.module.slice('blobs/wasm/'.length, -'.wasm'.length), Uint8Array.from(NALATI_TITAN.titan.witness)],
  [NALATI_TITAN_PROGRAMS.wind.script.module.slice('blobs/wasm/'.length, -'.wasm'.length), Uint8Array.from(NALATI_TITAN.pasture.witness)],
  [attack.artifact.hash, Uint8Array.from(NALATI_TITAN.titan.wasm)],
  [wind.artifact.hash, Uint8Array.from(NALATI_TITAN.pasture.wasm)],
  [heldScript.module.slice('blobs/wasm/'.length, -'.wasm'.length), originalSpeciesFile('held-witness.bin')],
  [held.v2.artifact.hash, originalSpeciesFile('held-weapons.wasm')],
  [admissionScript.module.slice('blobs/wasm/'.length, -'.wasm'.length), Uint8Array.from(NALATI_ADMISSION_PROGRAM.witness)],
  [admission.v2.artifact.hash, Uint8Array.from(NALATI_ADMISSION_PROGRAM.wasm)],
]);
const rows = v.parse(ReturnModulesSchema, [
  ['nalati.titan.projection', attack], ['nalati.pasture.projection', wind],
  ['nalati.held-weapons.projection', held.v2],
  ['nalati.admission.projection', admission.v2],
].map(([id, program]) => {
  if (typeof id !== 'string' || typeof program === 'string' || program === undefined) throw new Error('Missing fixture return descriptor');
  return { id, module: `blobs/wasm/${program.artifact.hash}.wasm`, side: 'sim', abi: 2, lane: 'project', pages: program.artifact.pages,
    ioBytes: program.artifact.ioBytes, compilerRevision: program.artifact.compilerRevision, admissionRevision: program.artifact.admissionRevision };
}));

/** Fight fixtures retain Titan, pasture and both actor damage projections through
 * the same scoped intake without constructing unrelated riding/Kokpar loans. */
export function lendNalatiPasture(owner: Scope): void { ReturnProgram.lendModules(owner, modules, rows); }

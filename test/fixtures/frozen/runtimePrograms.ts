import { parse, object, string } from 'valibot';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { ReturnProjectionV2Schema } from '@wildshard/format/returnProjectionV2';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { WildlifePopulationSchema } from '@wildshard/format/wildlifePopulation';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import type { Scope } from '../../../src/shared/engine/app/scope';
import { frozenNalatiBytes, frozenNalatiJson, frozenAdmissionAssets, frozenAdmissionModules } from './nalati';

const programSchema = object({...ReturnProgramSchema.entries, script: DecisionScriptsSchema.pipe[2].item, v2: ReturnProjectionV2Schema});
export const frozenRiding = parse(object({approach: programSchema, breaking: programSchema, riding: programSchema}), frozenNalatiJson('nalati-riding-programs.json'));
export const frozenHeld = parse(object({held: object({program: programSchema})}), frozenNalatiJson('nalati-held.json')).held;
export const frozenTitanPrograms = parse(object({
  attack: programSchema, fire: programSchema,
  wind: programSchema, rules: programSchema,
}), frozenNalatiJson('nalati-titan-programs.json'));
export const frozenWildlife = parse(WildlifePopulationSchema, frozenNalatiJson('nalati-wildlife.json'));
const modules = new Map<string, Uint8Array>(frozenAdmissionAssets);
const declarations: unknown[] = [...frozenAdmissionModules];
for (const [name, program] of [['titan', frozenTitanPrograms.attack], ['pasture', frozenTitanPrograms.wind], ['riding', frozenRiding.approach], ['held', frozenHeld.program]] as const) {
  const artifact = program.v2?.artifact;
  if (artifact === undefined) throw new Error('Frozen runtime guest lacks ABI2');
  const script = parse(object({ module: string() }), program.script);
  modules.set(artifact.hash, frozenNalatiBytes(`nalati-${name}-wasm.wasm`));
  modules.set(script.module.slice('blobs/wasm/'.length, -'.wasm'.length), frozenNalatiBytes(`nalati-${name}-witness.bin`));
  declarations.push({ id: `ci21.frozen.${name}`, module: `blobs/wasm/${artifact.hash}.wasm`,
    side: 'sim', abi: 2, lane: artifact.lane, pages: artifact.pages, ioBytes: artifact.ioBytes,
    compilerRevision: artifact.compilerRevision, admissionRevision: artifact.admissionRevision });
}
const rows = parse(ReturnModulesSchema, declarations);
export function lendFrozenPasture(owner: Scope): void {
  ReturnProgram.lendModules(owner, modules, rows);
}

export const frozenRidingWitness = frozenNalatiBytes('nalati-riding-witness.bin');
export const frozenTitanModule = frozenNalatiBytes('nalati-titan-wasm.wasm');
const attack = Buffer.from(frozenNalatiBytes('nalati-titan-witness.bin')).toString('base64');
const wind = Buffer.from(frozenNalatiBytes('nalati-pasture-witness.bin')).toString('base64');
const native = Buffer.from(frozenTitanModule).toString('base64');
export const frozenTitanInline = { ...frozenTitanPrograms,
 attack: {...frozenTitanPrograms.attack, bytes: attack, v2: {...frozenTitanPrograms.attack.v2, bytes: native}},
 rules: {...frozenTitanPrograms.rules, bytes: attack, v2: {...frozenTitanPrograms.rules.v2, bytes: native}},
 wind: {...frozenTitanPrograms.wind, bytes: wind}, fire: {...frozenTitanPrograms.fire, bytes: wind} };

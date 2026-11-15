import { parse, object, string } from 'valibot';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { WildlifePopulationSchema } from '@wildshard/format/wildlifePopulation';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import type { Scope } from '../../../src/shared/engine/app/scope';
import { frozenNalatiBytes, frozenNalatiJson, frozenAdmissionAssets, frozenAdmissionModules } from './nalati';

export const frozenTitanPrograms = parse(object({
  attack: ReturnProgramSchema, fire: ReturnProgramSchema,
  wind: ReturnProgramSchema, rules: ReturnProgramSchema,
}), frozenNalatiJson('nalati-titan-programs.json'));
export const frozenWildlife = parse(WildlifePopulationSchema, frozenNalatiJson('nalati-wildlife.json'));
const modules = new Map<string, Uint8Array>(frozenAdmissionAssets);
const declarations: unknown[] = [...frozenAdmissionModules];
for (const [name, program] of [['titan', frozenTitanPrograms.attack], ['pasture', frozenTitanPrograms.wind]] as const) {
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

import * as v from 'valibot';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { EncounterPatrolSchema, EncounterSlotsSchema, EncounterScheduleSchema, SlotViewSchema, PatrolViewSchema } from '@wildshard/format/encounterRows';
import { StealthRowsSchema } from '@wildshard/format/stealth';
import { ReturnProgram } from '../../../src/shared/game/population/returnProgram';
import type { Scope } from '../../../src/shared/engine/app/scope';
import { frozenNalatiJson, frozenAdmissionProgram, lendFrozenNalatiAdmission } from './nalati';

const program = v.object({ ...ReturnProgramSchema.entries, script: DecisionScriptsSchema.pipe[2].item });
/** Original complete encounter inputs, admitted independently of their old shard constructor. */
export const frozenNight = v.parse(v.object({
  program, cues: v.unknown(), slots: EncounterSlotsSchema, view: SlotViewSchema,
  patrol: EncounterPatrolSchema, motion: EncounterScheduleSchema, ride: PatrolViewSchema,
  phases: v.object({slots: v.array(v.string()), patrol: v.array(v.string())}),
  parameters: v.record(v.string(), v.number()), respawn: v.number(), lightFloor: v.number(),
  tell: v.object({cone: v.number(), reach: v.number(), wind: v.number(), strike: v.number()}),
}), frozenNalatiJson('nalati-night.json'));

const heldProgram = v.object({...program.entries, signal: v.string()});
export function frozenHeldMetadata() {
  return v.parse(v.object({held: v.object({programs: v.object({polearm: heldProgram})}), stealth: StealthRowsSchema}), frozenNalatiJson('nalati-held.json'));
}

export function frozenAdmissionPage(owner: Scope): ReturnProgram {
  lendFrozenNalatiAdmission(owner);
  return ReturnProgram.page(frozenAdmissionProgram, owner);
}

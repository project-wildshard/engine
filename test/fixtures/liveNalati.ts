// ZONE-SNAPSHOTS ZS9 (J507): Nalati's live guest programs and population rows, read from the live pin
// (engine-lift/pins.ts) where the frozen CI21 extracts used to be. Every guest these rows name is lent from the pin's
// own return-script modules.
import * as v from 'valibot';
import { DecisionScriptsSchema } from '@wildshard/format/decisionScripts';
import { ReturnProjectionV2Schema } from '@wildshard/format/returnProjectionV2';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { WildlifePopulationSchema } from '@wildshard/format/wildlifePopulation';
import { StealthRowsSchema } from '@wildshard/format/stealth';
import { EncounterPatrolSchema, EncounterSlotsSchema, EncounterScheduleSchema, SlotViewSchema, PatrolViewSchema } from '@wildshard/format/encounterRows';
import { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import type { Scope } from '../../src/shared/engine/app/scope';
import type { SimHost } from '../../src/server/engine/sim';
import { nalatiPin, NALATI_RIDING_PROGRAMS, admission } from './engine-lift/pins';
import { liveBytes, liveJson, livePath, liveSection } from './livePin';

const NALATI = 'nalati-grasslands';
const program = v.object({...ReturnProgramSchema.entries, script: DecisionScriptsSchema.pipe[2].item, v2: ReturnProjectionV2Schema});
/** Lends every Nalati return-script guest (admission, pasture, titan, riding, held) to a test's owning scope. */
export function lendLiveNalati(owner: Scope): void { nalatiPin.lend(owner); }
export const liveAdmissionProgram = admission;
export function liveAdmissionNative(host: SimHost): ReturnProgram { lendLiveNalati(host.scope); return ReturnProgram.native(host, admission); }
export function liveAdmissionPage(owner: Scope): ReturnProgram { lendLiveNalati(owner); return ReturnProgram.page(admission, owner); }
export const liveRiding = v.parse(v.object({initial: v.record(v.string(), v.number()), approach: program, breaking: program, riding: program}), NALATI_RIDING_PROGRAMS);
export const liveRidingWitness = liveBytes(NALATI, 'behaviour/riding-witness.bin');
const titan = v.parse(v.object({programs: v.object({attack: program, wind: program})}), liveJson(NALATI, 'combat/titan-fight.json')).programs;
/** The titan fight's attack and wind guests; `fire` is the pasture wind and `rules` the attack, as the fight lends them. */
export const liveTitanPrograms = {attack: titan.attack, wind: titan.wind, fire: titan.wind, rules: titan.attack};
export const liveTitanModule = livePath(NALATI, `blobs/wasm/${titan.attack.v2.artifact.hash}.wasm`);
type Guest = v.InferOutput<typeof program>;
const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
/** A guest with its witness and ABI2 module inline, as a raw return program carries them. */
function inline(row: Guest) {
  return {...row, bytes: base64(livePath(NALATI, row.script.module)), v2: {...row.v2, bytes: base64(livePath(NALATI, `blobs/wasm/${row.v2.artifact.hash}.wasm`))}};
}
export const liveTitanInline = {attack: inline(titan.attack), wind: inline(titan.wind), fire: inline(titan.wind), rules: inline(titan.attack)};
export const liveWildlife = v.parse(WildlifePopulationSchema, liveJson(NALATI, 'actors/wildlife.json'));
const heldProgram = v.object({...program.entries, signal: v.string()});
/** The spear's held decision guest (signal `polearm`) and the player's stealth rows. */
export function liveHeldMetadata() {
  return {held: {programs: {polearm: v.parse(v.object({program: heldProgram}), liveJson(NALATI, 'weapons/spear.json')).program}},
    stealth: v.parse(StealthRowsSchema, liveSection(NALATI, 'player/stealth'))};
}
/** The held weapons' decision guest as the spear lends it. */
const {signal: _signal, ...heldGuest} = liveHeldMetadata().held.programs.polearm;
export const liveHeld = {program: heldGuest};
/** Nalati's live night encounter (combat/timed-encounters.json) with the audio cues its client plan declares. */
const cues = v.parse(v.object({features: v.array(v.looseObject({kind: v.string()}))}), liveSection(NALATI, 'client/plan')).features.find(row => row.kind === 'audio.cues');
if (cues === undefined) throw new Error('Nalati declares no audio cues');
export const liveNight = v.parse(v.object({
  program: v.object({...ReturnProgramSchema.entries, script: DecisionScriptsSchema.pipe[2].item}), cues: v.unknown(),
  slots: EncounterSlotsSchema, view: SlotViewSchema, patrol: EncounterPatrolSchema, motion: EncounterScheduleSchema, ride: PatrolViewSchema,
  phases: v.object({slots: v.array(v.string()), patrol: v.array(v.string())}),
  parameters: v.record(v.string(), v.number()), respawn: v.number(), lightFloor: v.number(),
  tell: v.object({cone: v.number(), reach: v.number(), wind: v.number(), strike: v.number()}),
}), {...v.parse(v.looseObject({}), liveJson(NALATI, 'combat/timed-encounters.json')), cues: cues['rows']});
const titanFight = v.parse(v.looseObject({king: v.looseObject({page: v.looseObject({cuts: v.unknown(), hazards: v.record(v.string(), v.unknown())})}),
  arenaScript: v.looseObject({contacts: v.record(v.string(), v.unknown())})}), liveJson(NALATI, 'combat/titan-fight.json'));
/** The Golden King as the titan fight declares him (client, portal, page, encounter, reward, tuning). */
export const liveGoldenKing = titanFight.king;
const wildlifeContacts = v.parse(v.looseObject({groups: v.looseObject({contacts: v.record(v.string(), v.unknown())})}), liveJson(NALATI, 'actors/wildlife.json')).groups.contacts;
const elite = v.parse(v.looseObject({rows: v.looseObject({strikes: v.array(v.looseObject({strike: v.unknown()})), fallbackStrike: v.unknown(), profiles: v.array(v.looseObject({value: v.unknown()}))})}),
  v.parse(v.object({features: v.array(v.looseObject({kind: v.string()}))}), liveSection(NALATI, 'client/plan')).features.find(row => row.kind === 'elite.construct'));
/** The elite constructs' kernel profiles, as the client plan declares them. */
export const liveEliteKernels = elite.rows.profiles.map(row => row.value);
const strike = (index: number): unknown => { const row = elite.rows.strikes[index]; if (row === undefined) throw new Error(`Missing elite strike ${index}`); return row.strike; };
const sheepGuest = v.parse(v.looseObject({species: v.looseObject({guest: v.looseObject({strike: v.unknown()})})}), liveJson(NALATI, 'actors/sheep.json')).species.guest;
const night = v.parse(v.looseObject({contact: v.looseObject({strike: v.unknown()})}), liveJson(NALATI, 'combat/timed-encounters.json'));
/** Every creature strike profile Nalati declares, by the names the CI21 extract gave them. */
export const liveStrikeProfiles: Readonly<Record<string, unknown>> = {
  wolf: wildlifeContacts['pack'], stallion: wildlifeContacts['herd'], balbal: sheepGuest.strike, arrow: night.contact.strike,
  swipe: strike(0), pounce: strike(1), bite: strike(2), stoop: strike(3), captain: elite.rows.fallbackStrike,
  cuts: titanFight.king.page.cuts, sunburst: titanFight.king.page.hazards['sunburst'], beam: titanFight.king.page.hazards['beam'], sand: titanFight.king.page.hazards['sand'],
  spear: titanFight.arenaScript.contacts['spear'], whirl: titanFight.arenaScript.contacts['whirl'], wind: titanFight.arenaScript.contacts['wind'], chain: titanFight.arenaScript.contacts['chain'],
};
/** The balbal's live creature guest (actors/sheep.json species.guest). */
export const liveBalbalGuest = sheepGuest;
const balbalLook = v.parse(v.looseObject({species: v.looseObject({lookBook: v.looseObject({rows: v.array(v.looseObject({id: v.string(), projection: v.optional(v.unknown())}))})})}),
  liveJson(NALATI, 'actors/sheep.json')).species.lookBook.rows.find(row => row.id === 'look.nalati.balbal');
if (balbalLook?.projection === undefined) throw new Error('Nalati declares no balbal projection');
/** The balbal's live actor projection, as its look book row declares it. */
export const liveBalbalProjection = balbalLook.projection;

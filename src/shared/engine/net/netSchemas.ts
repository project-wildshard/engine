import type { PlayerSim } from '../../../server/engine/sim/playerSim';
import { ANIMAL_NET, type AnimalNetView } from './animalNet';
import type { EncounterNetView } from '../sim/encounterRows';
import { ENCOUNTER_NET } from './encounterNet';
import { NET_EVENT_FORMS } from './messages';
import { PLAYER_NET } from './playerNet';
import type { ScriptNetView, StateNetRow } from '../sim/shardRows';
import { FLAG_NET, SCRIPT_NET, STATE_NET } from './shardNet';
import { compileSchema, netSchemaHash, schemaDescription, type NetClass } from './schema';

/** The compiled `player` class. */
export const PLAYER_CLASS: NetClass<PlayerSim> = compileSchema(PLAYER_NET, 0);
/** The compiled `animal` class. */
export const ANIMAL_CLASS: NetClass<AnimalNetView> = compileSchema(ANIMAL_NET, 1);
/** The compiled `encounter` class. */
export const ENCOUNTER_CLASS: NetClass<EncounterNetView> = compileSchema(ENCOUNTER_NET, 2);
/** The compiled `script` class. */
export const SCRIPT_CLASS: NetClass<ScriptNetView> = compileSchema(SCRIPT_NET, 3);
/** The compiled `state` class. */
export const STATE_CLASS: NetClass<StateNetRow> = compileSchema(STATE_NET, 4);
/** The compiled `flag` class. */
export const FLAG_CLASS: NetClass<string> = compileSchema(FLAG_NET, 5);
/** Every class, in v0 wire order. A class's view type is erased here: the wire only needs its columns. */
export const NET_CLASSES: readonly NetClass<never>[] = [PLAYER_CLASS, ANIMAL_CLASS, ENCOUNTER_CLASS, SCRIPT_CLASS, STATE_CLASS, FLAG_CLASS];
const BY_WIRE: ReadonlyMap<number, NetClass<never>> = new Map(NET_CLASSES.map(entry => [entry.id, entry]));
/**
 * The class a spawn's class number names, or undefined (WIRE-STABILITY 5.2): decoders look a class up by id, never by its
 * position in a list. The v0 wire carries the v0 number until WR5 switches it to the class's stable id.
 */
export function netClassOf(cls: number): NetClass<never> | undefined { return BY_WIRE.get(cls); }
/** A spawn's initial column widths and text count, by the class number it carries. */
export function initialBitsOf(cls: number): { readonly bits: readonly number[]; readonly text: number } | undefined {
  const entry = netClassOf(cls);
  return entry === undefined ? undefined : { bits: entry.initial.map(column => column.bits), text: entry.text.length };
}
/** Exact wire identity, checked at `hello`: client and server always ship from one engine build (J54). Equals
 *  `v0SchemaHash` of `@wildshard/wire`'s classes, which `test/wire-bindings.test.ts` holds. */
export const NET_SCHEMA_HASH: number = netSchemaHash([schemaDescription(PLAYER_NET), schemaDescription(ANIMAL_NET), schemaDescription(ENCOUNTER_NET), schemaDescription(SCRIPT_NET), schemaDescription(STATE_NET), schemaDescription(FLAG_NET), NET_EVENT_FORMS]);

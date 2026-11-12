// WIRE-STABILITY WR2: engine's class tables are bindings onto `@wildshard/wire`'s descriptors. These hold the v0 wire
// exactly where it was (the frozen cfd6681 tables, plus `player.name`), a class lookup by id, and the typecheck that
// refuses a descriptor field with no binding.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { ANIMAL_STATES as WIRE_ANIMAL_STATES, ENCOUNTER_STATES as WIRE_ENCOUNTER_STATES, STATE, WIRE_CLASSES } from '@wildshard/wire/classes';
import { CLIMATE_OPS as WIRE_CLIMATE_OPS } from '@wildshard/wire/records';
import { RIDE_ACTIONS } from '@wildshard/wire/netCommand';
import { v0SchemaHash } from '@wildshard/wire/v0';
import { ANIMAL_STATES } from '../src/shared/engine/entities/animalStates';
import { CLIMATE_OPS } from '../src/shared/engine/net/acts';
import { ENCOUNTER_CLASS, initialBitsOf, NET_CLASSES, NET_SCHEMA_HASH, netClassOf, SCRIPT_CLASS, STATE_CLASS } from '../src/shared/engine/net/netSchemas';
import { bindClass, compileSchema, type NetClass } from '../src/shared/engine/net/schema';
import { ENCOUNTER_STATES, NO_MOMENTS, type EncounterNetView } from '../src/shared/engine/sim/encounterRows';

interface FrozenColumn { readonly name: string; readonly kind: string; readonly bits: number; readonly step: number }
interface FrozenClass { readonly id: number; readonly cls: string; readonly row: readonly FrozenColumn[]; readonly owner: readonly FrozenColumn[]; readonly initial: readonly FrozenColumn[]; readonly text: readonly string[]; readonly radius: number | null; readonly position: readonly number[] | null }
/** The compiled class tables of engine cfd6681 (v0.1.2), frozen in wire by WS2. */
const FROZEN = (JSON.parse(readFileSync(fileURLToPath(new URL('../../frozen/v0/tables.json', import.meta.resolve('@wildshard/wire/classes'))), 'utf8')) as { readonly columns: readonly FrozenClass[] }).columns;
const columns = (list: NetClass<never>['row']): FrozenColumn[] => list.map(({ name, kind, bits, step }) => ({ name, kind, bits, step }));

test('the bound classes hash to the descriptors, which are engine main\'s v0 wire', () => {
  expect(NET_SCHEMA_HASH).toBe(v0SchemaHash(WIRE_CLASSES));
  expect(NET_SCHEMA_HASH).toBe(516_954_244); // with animal.species (TE-ENG7)
});

test('every compiled column is cfd6681\'s; the player gains only its spawn name, the animal its species', () => {
  expect(NET_CLASSES.map(entry => entry.cls)).toEqual(FROZEN.map(entry => entry.cls));
  for (const [index, entry] of NET_CLASSES.entries()) {
    const frozen = FROZEN[index];
    expect(entry.id).toBe(frozen?.id);
    expect(columns(entry.row)).toEqual(frozen?.row);
    expect(columns(entry.owner)).toEqual(frozen?.owner);
    expect(columns(entry.initial)).toEqual(frozen?.initial);
    expect(entry.radius).toBe(frozen?.radius);
    expect(entry.position).toEqual(frozen?.position);
    expect(entry.text.map(field => field.name)).toEqual(entry.cls === 'player' ? ['name'] : entry.cls === 'animal' ? [...frozen?.text ?? [], 'species'] : frozen?.text);
  }
});

test('a class is found by the number its spawn carries, and carries its stable wire id', () => {
  for (const entry of NET_CLASSES) {
    expect(netClassOf(entry.id)).toBe(entry);
    expect(entry.stableId).toBe(WIRE_CLASSES.find(wire => wire.name === entry.cls)?.id);
    expect(initialBitsOf(entry.id)).toEqual({ bits: entry.initial.map(column => column.bits), text: entry.text.length });
  }
  expect(NET_CLASSES.map(entry => entry.stableId)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(netClassOf(NET_CLASSES.length)).toBeUndefined();
  expect(initialBitsOf(-1)).toBeUndefined();
});

test('engine\'s own enum words are the ones the wire declares', () => {
  expect([...ANIMAL_STATES]).toEqual([...WIRE_ANIMAL_STATES]);
  expect([...ENCOUNTER_STATES]).toEqual([...WIRE_ENCOUNTER_STATES]);
  expect([...CLIMATE_OPS]).toEqual([...WIRE_CLIMATE_OPS]);
  expect([...RIDE_ACTIONS]).toEqual(['offer', 'mount', 'dismount']);
});

test('a descriptor field with no binding, an unknown binding or a wrong type fails the typecheck', () => {
  // @ts-expect-error -- STATE declares `value`: a table without its binding does not compile
  expect(() => bindClass<{ readonly value: number }, typeof STATE>(STATE, {})).toThrow(/state\.value has no binding/u);
  // @ts-expect-error -- STATE declares only `value`: a binding the descriptor lacks does not compile
  bindClass<{ readonly value: number }, typeof STATE>(STATE, { value: row => row.value, extra: () => 1 });
  // @ts-expect-error -- `value` is an f32: an accessor must read a number
  bindClass<{ readonly value: number }, typeof STATE>(STATE, { value: () => 'one' });
  const bound = bindClass<{ readonly value: number }, typeof STATE>(STATE, { value: row => row.value });
  const [column] = compileSchema(bound, 4).row;
  expect(column?.value(column.sample({ value: 2.5 }, () => 0))).toBe(2.5);
  expect(bound.stableId).toBe(5);
});

test('the bound accessors read what the hand-written tables read', () => {
  const sample = <S>(cls: NetClass<S>, view: S): Record<string, unknown> => Object.fromEntries([...cls.row, ...cls.initial].map(column => [column.name, column.value(column.sample(view, id => (id === 'animal:1' ? 7 : 0)))]));
  expect(sample(SCRIPT_CLASS, { position: { x: 1.5, y: -2, z: 3 }, euler: { x: 0, y: Math.PI / 2, z: 0 }, enabled: true })).toEqual({ x: 1.5, y: -2, z: 3, pitch: 0, yaw: Math.PI / 2, roll: 0, enabled: true });
  expect(sample(STATE_CLASS, { name: 'gate', value: 0.25 })).toEqual({ value: 0.25 });
  const bar: EncounterNetView = { ...NO_MOMENTS, kind: 'boss', state: 'fight', hp: 2, phase: 3, shield: true, body: 'animal:1', banners: 257, reward: { x: 260, y: -260, z: 260 } };
  expect(sample(ENCOUNTER_CLASS, bar)).toMatchObject({ state: 'fight', hp: 1, phase: 3, shield: true, body: 7, banners: 1, rewarded: true, rewardX: 260, rewardY: -260, rewardZ: 260 });
  expect(() => sample(ENCOUNTER_CLASS, { ...bar, state: 'napping' })).toThrow(/Undeclared state value napping/u);
});

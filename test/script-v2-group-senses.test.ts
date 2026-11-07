import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Rng } from '../src/shared/engine/core/rng';
import { Scope } from '../src/shared/engine/app/scope';
import { ObservationColumnsV2, type V2ColumnOwners, type V2SenseColumns } from '../src/shared/engine/script/observationColumnsV2';
import { ObservationColumnsV2Schema, parseObservationColumnsV2 } from '@wildshard/format/scriptObservationColumnsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const rows = [
  { id: 1, name: 'visibility', source: { kind: 'sense', field: 'visibility' } },
  { id: 2, name: 'hearing', source: { kind: 'sense', field: 'hearing', radii: [2, 4, 8, 16] } },
  { id: 3, name: 'downwind', source: { kind: 'sense', field: 'downwind' } },
  ...['hp', 'maxHp', 'seed', 'stunned', 'modSpeed'].map((field, index) => ({ id: 4 + index, name: field, source: { kind: 'actor', field } })),
];
function fixture() {
  const parent = new Scope('sense-parent'), scope = parent.child('group'), random = new Rng(12);
  const actor = new AnimalSim({ kind: 'sample', label: 'Sample', variant: 'plain', rarity: 'common', hp: 30, aggressive: false,
    dims: { bodyY: .6, bodyHalfLen: .5, bodyRadius: .3, headRadius: .2, legLen: .5, feet: [], halfWidth: .3 },
    mods: { speed: 1.7, chargeDist: 1, damageTaken: 1, chargeDamage: 5, relentless: false } },
  77, 1, 'body:0', { heightAt: () => 0, random: () => random.next() });
  actor.position.set(4, 3, 8);actor.hp = 10;actor.stagger(new Vector3(0, 0, 1), 1);
  const player = new Vector3(20, 5, 30), calls: unknown[] = [];
  const senses: V2SenseColumns = { player,
    visibility(x, z, at, speed, time) { calls.push(['visibility', x, z, at, speed, time]);return x + z + this.player.y + speed + time; },
    hearing(radii, at, speed) { calls.push(['hearing', radii, at, speed]);return radii.reduce((sum, radius) => sum + radius, 0) + this.player.y + speed; },
    downwind(x, z, at) { calls.push(['downwind', x, z, at]);return x < this.player.x && z < this.player.z; },
  };
  const owners: V2ColumnOwners = { scope, self: { group: 'first', slot: 0, identity: actor.entityId, actor },
    player: { position: player }, observed: new Map(), t: 11, dt: .1, context: { calm: false, playerSpeed: 2.5 }, senses };
  return { parent, scope, actor, random, player, senses, calls, owners };
}
function values(input: ReturnType<ObservationColumnsV2['capture']>): Record<string, number> { return Object.fromEntries(input.map(row => [row.name, row.value])); }

test('entered native senses see the original member/player/context and preserve body, RNG and sample order', () => {
  const f = fixture();
  try {
    const reader = new ObservationColumnsV2(rows, f.scope), body = f.actor.snapshot(), rng = f.random.snapshot();
    const result = reader.capture(f.owners);
    expect(values(result)).toStrictEqual({ visibility: 30.5, hearing: 37.5, downwind: 1, hp: 10, maxHp: 30, seed: 77, stunned: 1, modSpeed: 1.7 });
    expect(f.calls).toStrictEqual([['visibility', 4, 8, f.player, 2.5, 11], ['hearing', [2, 4, 8, 16], f.player, 2.5], ['downwind', 4, 8, f.player]]);
    expect(f.actor.snapshot()).toStrictEqual(body);expect(f.random.snapshot()).toStrictEqual(rng);
    f.actor.position.x = 9;expect(values(result)['visibility']).toBe(30.5);
    expect(values(reader.capture(f.owners))['visibility']).toBe(35.5);
  } finally { f.parent.dispose(); }
});
test('named admission keeps senses finite and strict without executable selectors or malformed radii', () => {
  expect(parseObservationColumnsV2(rows)).toStrictEqual(rows);
  const schema = namedJsonSchema(ObservationColumnsV2Schema), encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  expect(validateNamedJsonSchema(schema, encode(rows))).toStrictEqual(rows);
  for (const source of [{ kind: 'sense', field: 'unknown' }, { kind: 'sense', field: 'hearing' },
    { kind: 'sense', field: 'hearing', radii: [1, 2, 3] }, { kind: 'sense', field: 'hearing', radii: [1, 2, 3, 4, 5] },
    { kind: 'sense', field: 'hearing', radii: [1, 2, -1, 4] }, { kind: 'sense', field: 'visibility', radii: [1, 2, 3, 4] }]) {
    const invalid = [{ id: 1, name: 'sense', source }];
    expect(() => parseObservationColumnsV2(invalid)).toThrow();expect(() => validateNamedJsonSchema(schema, encode(invalid))).toThrow();
  }
});
test('missing/foreign owners and a malformed suffix refuse before calling a valid sense prefix', () => {
  const f = fixture();
  try {
    const reader = new ObservationColumnsV2(rows, f.scope), { senses: _senses, ...missing } = f.owners;
    expect(() => reader.capture(missing)).toThrow('senses');
    expect(() => reader.capture({ ...f.owners, player: { position: new Vector3() } })).toThrow('sense owner');
    const invalid = new ObservationColumnsV2([...rows, { id: 9, name: 'storm', source: { kind: 'weather', field: 'stormActive' } }], f.scope);
    expect(() => invalid.capture(f.owners)).toThrow('weather');expect(f.calls).toHaveLength(0);
    expect(values(reader.capture({ ...f.owners, self: { ...f.owners.self, identity: '', actor: null } }))).toStrictEqual({
      visibility: 0, hearing: 0, downwind: 0, hp: 0, maxHp: 0, seed: 0, stunned: 0, modSpeed: 0 });
    expect(f.calls).toHaveLength(0);
  } finally { f.parent.dispose(); }
});
test('same-call owner retirement and native callable replacement refuse detached publication', () => {
  const f = fixture(), reader = new ObservationColumnsV2(rows, f.scope);
  try {
    const senses = { ...f.senses, visibility: (_x: number, _z: number, _player: Vector3, _speed: number, _time: number) => {
      senses.hearing = () => 0;return 1;
    } };
    expect(() => reader.capture({ ...f.owners, senses })).toThrow('Replaced');
    const rng = f.random.snapshot();
    let disposal: ReturnType<Scope['disposeSteps']> | undefined;
    const retiring = { ...f.senses, visibility: () => { disposal = f.parent.disposeSteps();disposal.next();return 0; } };
    expect(() => reader.capture({ ...f.owners, senses: retiring })).toThrow('Retired');
    expect(f.random.snapshot()).toStrictEqual(rng);
    if (disposal !== undefined) for (const _step of disposal) { /* Complete original retirement. */ }
  } finally { f.parent.dispose(); }
});

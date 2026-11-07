// oxlint-disable-next-line import/no-nodejs-modules -- The behavior fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { checkSimSnapshotWire, leadSnapshot, snapshotSimHostBytes, serializeSimSnapshot, type SimSnapshotBytes } from '../src/shared/engine/sim/snapshot';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { Rng } from '../src/shared/engine/core/rng';
import { MAX_TICK_SNAPSHOT_CHARS } from '../src/shared/host/tickProtocol';

let initial: SimSnapshotBytes;
beforeAll(async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  try { initial = snapshotSimHostBytes(host); } finally { host.dispose(); }
});

test('the wire fence has the same exact result at either side of the actual encoded length', () => {
  const rng = new Rng(417);
  for (const length of [1, 63, 64, 65537]) for (const repeated of [false, true]) {
    const physics = Uint8Array.from({ length }, () => repeated ? 73 : rng.int(0, 255));
    const saved = { ...initial, physics, adapters: [{ id: 'metadata', state: 'é😀' }] };
    const wire = serializeSimSnapshot(saved);
    expect(() => checkSimSnapshotWire(saved, wire.length - 1)).toThrow('character bound');
    expect(() => checkSimSnapshotWire(saved, wire.length)).not.toThrow();
    expect(() => checkSimSnapshotWire(saved, MAX_TICK_SNAPSHOT_CHARS)).not.toThrow();
  }
});

test('a conservative bound never refuses a large but compressible valid continuation', () => {
  const saved = { ...initial, physics: new Uint8Array(24_000_000) };
  // Raw base64 alone reaches the cap; metadata pushes the cheap bound above it.
  // The original compressor must decide whether the full checkpoint really fits.
  expect(serializeSimSnapshot(saved).length).toBeLessThan(MAX_TICK_SNAPSHOT_CHARS);
  expect(() => checkSimSnapshotWire(saved, MAX_TICK_SNAPSHOT_CHARS)).not.toThrow();
});

test.each(['pose', 'identity', 'accessor', 'cycle', 'legacy-byte', 'empty', 'too-large'] as const)('the observation keeps the writer refusal for %s', kind => {
  const saved = structuredClone(initial);
  if (kind === 'pose') leadSnapshot(saved).position[0] = Number.NaN;
  if (kind === 'identity') saved.flags.push('duplicate', 'duplicate');
  if (kind === 'accessor') Object.defineProperty(saved, 'unexpected', { enumerable: true, get: () => 1 });
  if (kind === 'cycle') Reflect.set(saved, 'unexpected', saved);
  if (kind === 'legacy-byte') Reflect.set(saved, 'physics', [256]);
  if (kind === 'empty') saved.physics = new Uint8Array();
  if (kind === 'too-large') saved.physics = new Uint8Array(32_000_001);
  expect(() => serializeSimSnapshot(saved)).toThrow();
  expect(() => checkSimSnapshotWire(saved, MAX_TICK_SNAPSHOT_CHARS)).toThrow();
});

test('native offset views keep their bytes and ownership through the fast fence', () => {
  const backing = new Uint8Array(initial.physics.length + 19).fill(173), physics = backing.subarray(7, 7 + initial.physics.length);
  physics.set(initial.physics); const before = backing.slice();
  checkSimSnapshotWire({ ...initial, physics }, MAX_TICK_SNAPSHOT_CHARS);
  expect(backing.every((byte, index) => byte === before[index])).toBe(true);
});


test('recursive metadata stays isolated after failed validation', () => {
  const saved = structuredClone(initial);
  saved.adapters.push({ id: 'recursive', state: { values: [null, true, false, 0, -0, Infinity, -Infinity, 'é😀', [], {}], nested: { list: [{ value: 3 }] } } });
  saved.events.queue.push({ name: 'fault', payload: { kind: 'record', entries: [['nested', { kind: 'array', items: [
    { kind: 'value', value: null }, { kind: 'value', value: true }, { kind: 'value', value: -0 }, { kind: 'value', value: 'é😀' },
    { kind: 'undefined' }, { kind: 'number', value: 'infinity' }, { kind: 'number', value: '-infinity' }, { kind: 'number', value: 'nan' },
    { kind: 'vector', value: [1, 2, 3] }, { kind: 'player' },
  ] }]] } });
  const wire = serializeSimSnapshot(saved), scalar = structuredClone(saved), payload = structuredClone(saved);
  scalar.adapters.push({ id: 'invalid', state: { nested: [Number.NaN] } });
  payload.events.queue.push({ name: 'fault', payload: { kind: 'record', entries: [
    ['duplicate', { kind: 'value', value: 1 }], ['duplicate', { kind: 'value', value: 2 }],
  ] } });
  for (const invalid of [scalar, payload]) {
    expect(() => serializeSimSnapshot(invalid)).toThrow();
    expect(() => checkSimSnapshotWire(invalid, MAX_TICK_SNAPSHOT_CHARS)).toThrow();
    expect(serializeSimSnapshot(saved)).toBe(wire);
    expect(() => checkSimSnapshotWire(saved, wire.length)).not.toThrow();
  }
});


test.each(['', '"\\\b\f\n\r\t\u0000', '\uD800', '\uDC00', '\uD800\uDC00', 'é😀'])('wire character accounting keeps exact bounds for %j', text => {
  const saved = structuredClone(initial);
  saved.physics = Uint8Array.of(173);
  saved.adapters.push({ id: 'quoted', state: { [text.repeat(8)]: [text.repeat(512), -0, 1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity] } });
  const wire = serializeSimSnapshot(saved);
  expect(() => checkSimSnapshotWire(saved, wire.length - 1)).toThrow('character bound');
  expect(() => checkSimSnapshotWire(saved, wire.length)).not.toThrow();
  expect(() => checkSimSnapshotWire(saved, MAX_TICK_SNAPSHOT_CHARS)).not.toThrow();
});

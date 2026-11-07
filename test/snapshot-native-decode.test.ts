// oxlint-disable-next-line import/no-nodejs-modules -- Replay uses the shipped native physics binary.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { beforeAll, expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, decodeSimSnapshotBytes, snapshotSimHostBytes, serializeSimSnapshot, SnapshotBasisMismatchError } from '../src/shared/engine/sim/snapshot';
import { prepareSimHostRestore, restoreSimHost } from '../src/server/engine/sim/restore';
import { canonicalSimDigest } from './fake/simState';
import { SIM_LEVEL, fightCommand } from './fixtures/sim-level/level';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
let checkpoint: string;
beforeAll(async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  try {
    for (let tick = 0; tick < 12; tick++) host.step(leadCommands(host, fightCommand(tick)));
    checkpoint = serializeSimSnapshot(snapshotSimHostBytes(host));
  } finally { host.dispose(); }
});
const record = v.record(v.string(), v.unknown());
function edited(wire: string, edit: (root: Record<string, unknown>, saved: Record<string, unknown>, physics: Record<string, unknown>) => void): string {
  const root = v.parse(record, JSON.parse(wire)), saved = v.parse(record, root['snapshot']), physics = v.parse(record, saved['physics']);
  edit(root, saved, physics); saved['physics'] = physics; root['snapshot'] = saved;
  return JSON.stringify(root);
}
function failure(run: () => unknown): { name: string; message: string } {
  try { run(); } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { name: error.name, message: error.message };
  }
  throw new Error('Expected a strict snapshot refusal');
}

test.each(['base64', 'deflate', 'basis'] as const)('native %s decode retains exact legacy bytes and independent ownership', encoding => {
  const original = decodeSimSnapshotBytes(checkpoint), physics = encoding === 'base64'
    ? new Uint8Array([0, 21, 255, 17, 91]) : new Uint8Array(4096).fill(73);
  const basis = encoding === 'basis' ? physics.slice() : undefined;
  const wire = serializeSimSnapshot({ ...original, physics }, basis);
  const expectedEncoding = encoding === 'base64' ? 'base64' : 'deflate-lz-base64-v1';
  expect(v.parse(record, v.parse(record, v.parse(record, JSON.parse(wire))['snapshot'])['physics'])['encoding']).toBe(expectedEncoding);
  const legacy = decodeSimSnapshot(wire, basis), decoded = decodeSimSnapshotBytes(wire, basis);
  expect(Array.isArray(legacy.physics)).toBe(true);
  expect(decoded.physics).toBeInstanceOf(Uint8Array);
  expect([...decoded.physics]).toEqual(legacy.physics);
  expect(serializeSimSnapshot(decoded, basis)).toBe(wire);
  const other = decodeSimSnapshotBytes(wire, basis);
  decoded.physics.fill(0);
  expect(other.physics).toEqual(physics);
  expect(basis).toEqual(encoding === 'basis' ? physics : undefined);
});

test.each(['checksum', 'metadata', 'identity', 'framing', 'missing-basis', 'wrong-basis'] as const)('native %s refusal matches legacy validation and basis error order', kind => {
  const physics = new Uint8Array(4096).fill(19), basis = physics.slice();
  const wire = serializeSimSnapshot({ ...decodeSimSnapshotBytes(checkpoint), physics }, basis);
  const changed = edited(wire, (_root, saved, packed) => {
    if (kind === 'checksum') packed['checksum'] = 0;
    if (kind === 'metadata') saved['extra'] = true;
    if (kind === 'identity') saved['entities'] = [0];
    if (kind === 'framing') packed['packedLength'] = 1;
  });
  const supplied = kind === 'missing-basis' ? undefined : kind === 'wrong-basis' ? new Uint8Array(4096) : basis;
  expect(failure(() => decodeSimSnapshotBytes(changed, supplied))).toEqual(failure(() => decodeSimSnapshot(changed, supplied)));
  if (kind === 'wrong-basis') expect(() => decodeSimSnapshotBytes(changed, supplied)).toThrow(SnapshotBasisMismatchError);
});

test('typed offset-view restore preserves DB1 transaction, detached native world and exact legacy replay', async () => {
  const R = await rapier, legacy = decodeSimSnapshot(checkpoint), typed = decodeSimSnapshotBytes(checkpoint);
  expect(canonicalSimDigest(typed)).toBe(canonicalSimDigest(legacy));
  const backing = new Uint8Array(typed.physics.length + 19).fill(42), offset = backing.subarray(7, 7 + typed.physics.length);
  offset.set(typed.physics); typed.physics = offset;
  const target = prepareSimHostRestore(SIM_LEVEL, { rapier: R }), expected = restoreSimHost(SIM_LEVEL, { rapier: R }, legacy);
  try {
    target.restore(typed);
    expect(serializeSimSnapshot(snapshotSimHostBytes(target.host))).toBe(checkpoint);
    expect(offset.byteOffset).toBe(7); offset.fill(0); backing.fill(0);
    for (let tick = 12; tick < 24; tick++) {
      target.host.step(leadCommands(target.host, fightCommand(tick))); expected.step(leadCommands(expected, fightCommand(tick)));
      expect(serializeSimSnapshot(snapshotSimHostBytes(target.host))).toBe(serializeSimSnapshot(snapshotSimHostBytes(expected)));
    }
  } finally { target.host.dispose(); expected.dispose(); }
});

test.each(['registration', 'duplicate', 'legacy-byte', 'other-view'] as const)('typed and legacy %s restore retain strict refusal and target disposal', async kind => {
  const R = await rapier;
  for (const saved of [decodeSimSnapshot(checkpoint), decodeSimSnapshotBytes(checkpoint)]) {
    const target = prepareSimHostRestore(SIM_LEVEL, { rapier: R });
    try {
      if (kind === 'registration') saved.adapters.push({ id: 'absent', state: null });
      if (kind === 'duplicate') { const entity = saved.entities[0]; if (entity === undefined) throw new Error('Missing entity'); saved.entities.push(entity); }
      if (kind === 'legacy-byte') Reflect.set(saved, 'physics', [256]);
      if (kind === 'other-view') Reflect.set(saved, 'physics', new Uint16Array([256]));
      expect(() => target.restore(saved)).toThrow(kind === 'registration' || kind === 'duplicate' ? 'registrations' : 'Incompatible');
      expect(target.host.scope.disposed).toBe(true);
    } finally { target.host.dispose(); }
  }
});

test('metadata and malformed framing still refuse before recoverable basis mismatch', () => {
  const physics = new Uint8Array(4096).fill(19), basis = physics.slice(), wire = serializeSimSnapshot({ ...decodeSimSnapshotBytes(checkpoint), physics }, basis);
  for (const changed of [edited(wire, (_root, saved) => { saved['apiVersion'] = -1; }), edited(wire, (_root, _saved, packed) => { packed['packedLength'] = 1; })]) {
    const error = failure(() => decodeSimSnapshotBytes(changed, new Uint8Array(4096)));
    expect(error.name).not.toBe('SnapshotBasisMismatchError');
  }
});

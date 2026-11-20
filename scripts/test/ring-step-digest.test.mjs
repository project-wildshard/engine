import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ringStepDigest } from '../ring-step-digest.mjs';

const wire = (version, body) => `{"format":"sim.snapshot","version":${version},"snapshot":{"version":${version},${body}}}`;
const previous = 'prior-checkpoint';
const state = '"tick":60,"feet":[-0,1],"physics":{"encoding":"base64","data":"eA=="}, "adapter":{"version":6}';

void test('snapshot v6 hashes the same Ring 1 state as the exact v5 wire', () => {
  const v5 = wire(5, state), v6 = wire(6, state);
  const expected = createHash('sha256').update(previous).update(v5).digest('hex');
  assert.equal(ringStepDigest(previous, v5), expected);
  assert.equal(ringStepDigest(previous, v6), expected);
});

void test('Ring 1 still detects pending kill credit, signed zero and wire changes', () => {
  const stable = ringStepDigest(previous, wire(6, state));
  assert.notEqual(ringStepDigest(previous, wire(6, `${state},"pendingKillCredit":["dead:storm-titan"]`)), stable);
  assert.notEqual(ringStepDigest(previous, wire(6, state.replace('-0', '0'))), stable);
  assert.notEqual(ringStepDigest(previous, wire(6, state.replace('"adapter":{"version":6}', '"adapter":{"version":5}'))), stable);
  assert.notEqual(ringStepDigest('another-prior-checkpoint', wire(6, state)), stable);
});

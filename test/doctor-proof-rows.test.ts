import { expect, test } from 'vitest';
import { doctorEpochOK, doctorRowsOK } from '../src/scripts/doctor-proof-rows.mjs';

test('Doctor admits matching signed progress epochs and refuses mismatched or malformed ones', () => {
  expect(doctorEpochOK(1, 1)).toBe(true);
  expect(doctorEpochOK(2, 2)).toBe(true);
  for (const [page, signed] of [[1, 2], [2, 1], [0, 0], [-1, -1], [1.5, 1.5], ['2', 2], [2, '2'], [undefined, undefined]]) {
    expect(doctorEpochOK(page, signed)).toBe(false);
  }
});

const socket = 'wss://rooms-staging.wildshard.io';
const rows = () => ['page','release','packs','server','join','latency','browser'].map(id => ({ id, state: id==='server'?'skip':'pass', value:id==='server'?'rooms-staging.wildshard.io · health is private, Join checks the door':'ok' }));

test('the current Doctor witness passes with only its explicit private-health skip', () => {
  expect(doctorRowsOK(rows(),socket)).toBe(true);
});

test('private health cannot excuse another skipped, warning, failed or missing check', () => {
  for (const state of ['skip','warn','fail']) { const changed=rows(); changed[4]!.state=state; expect(doctorRowsOK(changed,socket)).toBe(false); }
  const changed=rows();changed[3]!.value='server unavailable';expect(doctorRowsOK(changed,socket)).toBe(false);
  expect(doctorRowsOK(rows().slice(1),socket)).toBe(false);
  expect(doctorRowsOK(rows(),'wss://rooms.wildshard.io')).toBe(false);
});

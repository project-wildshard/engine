import { expect, test } from 'vitest';
import { doctorRowsOK } from '../scripts/doctor-proof-rows.mjs';

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

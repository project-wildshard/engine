// SB42: a proof harness's door pass rides the socket as a subprotocol; a player's page offers none.
import { expect, test } from 'vitest';
import { doorPassProtocols } from './webSocketTransport';

const SIG = 'ab'.repeat(64);

test('a harness door pass is offered as one wspass subprotocol, with no colon (a header token cannot hold one)', () => {
  expect(doorPassProtocols(() => `pass:opus-x.1794950000.${SIG}`)).toEqual([`wspass.opus-x.1794950000.${SIG}`]);
});

test('a player page, or anything not a pass, offers nothing', () => {
  expect(doorPassProtocols(() => undefined)).toEqual([]);
  expect(doorPassProtocols(() => '')).toEqual([]);
  expect(doorPassProtocols(() => 42)).toEqual([]);
  expect(doorPassProtocols(() => 'pass:Bad Lane.1.ab')).toEqual([]);
  expect(doorPassProtocols()).toEqual([]);
});

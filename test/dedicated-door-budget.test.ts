// STAGING-BUGBASH SB42: the rooms door's per-address budget (E7.7: 4 open sockets, 10 connects a minute) is shared by every page
// behind one address: our agents' proofs and Jake's phone at home, a carrier's phones behind CGNAT. A zone entry spent two connects
// (the door's word, then the join), a socket refused for the open-socket cap still counted in the minute, and a proof had no way out
// of the address's budget. Strangers keep their caps.
// oxlint-disable-next-line import/no-nodejs-modules -- the test signs its own passes.
import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { gatewayDoor } from './fixtures/dedicated/gatewayDoor';
import { helloMessage } from '../src/shared/engine/net/wireMessages';
import { framed, SOCKET_RELIABLE, SOCKET_WORLD } from '../src/shared/engine/net/socketFrames';

type Door = Awaited<ReturnType<typeof gatewayDoor>>;
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 20); });

/** A page asking the door's word (GO4 `worldWord`): open, hear `world`, close cleanly. False when refused. */
function word(door: Door, ip: string, protocols: string[] = []): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(door.port)}/`, protocols, { headers: { [door.proxyHeader]: ip } });
    socket.on('error', () => { resolve(false); });
    socket.on('message', (data: Buffer) => { if (data[0] === SOCKET_WORLD) { socket.close(1000); resolve(true); } });
  });
}
/** A join: hello, seated, then the socket (open until closed). Null when refused. */
function join(door: Door, ip: string, device: string, protocols: string[] = []): Promise<WebSocket | null> {
  return new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(door.port)}/`, protocols, { headers: { [door.proxyHeader]: ip } });
    door.arrivals.set(device, () => { door.arrivals.delete(device); resolve(socket); });
    socket.on('error', () => { resolve(null); });
    socket.on('close', () => { resolve(null); });
    socket.once('open', () => { socket.send(framed(SOCKET_RELIABLE, helloMessage({ build: 'bench', player: device, name: 'Guest', ledger: 0 }).buffer)); });
    const ready = (data: Buffer): void => { if (data[0] !== 4) return; socket.off('message', ready); socket.send(Buffer.from([5])); };
    socket.on('message', ready);
  });
}
async function closed(socket: WebSocket | null): Promise<void> { socket?.close(1000); await settle(); }

test('six zone entries from one address inside a minute, each closed before the next, all join with no 429', async () => {
  const door = await gatewayDoor({ now: () => 0 });
  try {
    for (let entry = 0; entry < 6; entry++) {
      expect(await word(door, '203.0.113.30')).toBe(true); await settle();
      const seat = await join(door, '203.0.113.30', `device:entry${String(entry)}`);
      expect(seat).not.toBeNull(); await closed(seat);
    }
  } finally { await door.close(); }
});

test('a socket refused for the open-socket cap does not keep the address shut for the minute', async () => {
  const door = await gatewayDoor({ now: () => 0 });
  try {
    const held = await Promise.all([0, 1, 2, 3].map(index => join(door, '203.0.113.31', `device:held${String(index)}`)));
    expect(held.every(socket => socket !== null)).toBe(true);
    for (let retry = 0; retry < 10; retry++) expect(await door.upgrade('203.0.113.31')).toContain('429');
    await closed(held[0] ?? null);
    expect(await join(door, '203.0.113.31', 'device:after')).not.toBeNull();
  } finally { await door.close(); }
});

test('a stranger still meets a cap: ten word sockets a minute, then the connects', async () => {
  const door = await gatewayDoor({ now: () => 0 });
  try {
    let heard = 0;
    for (let ask = 0; ask < 25; ask++) { if (await word(door, '203.0.113.32')) heard++; await settle(); }
    expect(heard).toBe(20);
    expect(await door.upgrade('203.0.113.32')).toContain('429');
    expect(await door.upgrade('203.0.113.33')).toContain('101');
  } finally { await door.close(); }
});

test('a proof pass draws on its own budget, so a lane never spends the address its players share', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const ticketKey = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const pass = (lane: string, expires: number, key = privateKey): string => {
    const body = `pass:${lane}.${String(expires)}`;
    return `${body}.${sign(null, Buffer.from(body), key).toString('hex')}`;
  };
  const live = Math.floor(Date.now() / 1000) + 3600, door = await gatewayDoor({ now: () => 0, ticketKey });
  try {
    // the address is full: four players at home
    const home = await Promise.all([0, 1, 2, 3].map(index => join(door, '203.0.113.40', `device:home${String(index)}`)));
    expect(home.every(socket => socket !== null)).toBe(true);
    expect(await door.upgrade('203.0.113.40')).toContain('429');
    // a lane's proof from the same address: twelve entries, word and join each, all through
    // offered as the page offers it (`doorPassProtocols`): `wspass.` and the pass after its `pass:`
    const offer = (text: string): string[] => [`wspass.${text.slice('pass:'.length)}`], path = offer(pass('opus-proof', live));
    for (let entry = 0; entry < 12; entry++) {
      expect(await word(door, '203.0.113.40', path)).toBe(true); await settle();
      const seat = await join(door, '203.0.113.40', `device:proof${String(entry)}`, path);
      expect(seat).not.toBeNull(); await closed(seat);
    }
    // a pass this key didn't sign, an expired one and one too long are the address's: refused while it is full
    const forged = pass('opus-proof', live, generateKeyPairSync('ed25519').privateKey);
    for (const bad of [forged, pass('opus-proof', live - 7200), pass('opus-proof', live + 48 * 3600)]) {
      expect(await door.upgrade('203.0.113.40', { 'sec-websocket-protocol': offer(bad).join('') })).toContain('429');
    }
  } finally { await door.close(); }
});

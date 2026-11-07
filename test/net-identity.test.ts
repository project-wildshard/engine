// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { BitWriter } from '../src/shared/engine/net/bits';
import { cleanName, filterWords, MAX_CHAT_BYTES, plainLine } from '../src/server/engine/net/chatFilter';
import { NetClient } from '../src/client/engine/net/client';
import { deviceIdentity, GUEST } from '../src/shared/engine/net/identity';
import { decodeHello, encodeHello } from '../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { directLoopback } from '../src/test/engine/netLoopback';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E5.2c (J111, J110): a device id and a typed Name in `hello`, and what the server does with what a player typed.
class Page implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}

test('a device id is minted once, a typed Name replaces only the Name, and it lives outside the save prefix', () => {
  const page = new Page(), first = deviceIdentity(page, 'wildshard.');
  expect(first).toMatchObject({ name: GUEST.name, player: expect.stringMatching(/^device:[0-9a-f-]{36}$/u) as string });
  expect(deviceIdentity(page, 'wildshard.', 'Ann')).toEqual({ player: first.player, name: 'Ann' });
  expect(deviceIdentity(page, 'wildshard.')).toEqual({ player: first.player, name: 'Ann' });
  expect([...page.items.keys()].every(key => !key.startsWith('wildshard.'))).toBe(true);
  page.items.set([...page.items.keys()][0] ?? '', 'not json');
  expect(deviceIdentity(page, 'wildshard.').player).not.toBe(first.player); // a broken record costs the id, never the boot
});

test('hello round-trips the identity and the ledger serial', () => {
  const hello = { schemaHash: NET_SCHEMA_HASH, build: 'b', player: 'device:1', name: 'Ann Ö', ledger: 7 };
  expect(decodeHello(new Uint8Array(encodeHello(new BitWriter(128), hello)))).toEqual(hello);
});

test('the room keeps who a client says it is, cleans the Name, and refuses an identity it cannot hold', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } }), good = directLoopback(), bad = directLoopback();
  const id = room.join(good.server), client = new NetClient(good.client), other = room.join(bad.server), refused = new NetClient(bad.client);
  client.hello('', { player: 'device:ok', name: 'Sh1t​  Lord' }); good.pump();
  refused.hello('', { player: 'has space', name: 'x' }); bad.pump();
  room.open(); good.pump();
  expect(room.identityOf(id)).toEqual({ player: 'device:ok', name: '**** Lord' });
  expect(refused.closed).toBe('refused');
  expect(room.identityOf(other)).toBeNull();
  expect(client.welcome).not.toBeNull();
  room.dispose(); host.dispose();
});

test('the filter takes whole words through look-alikes and stretching, and only them', () => {
  expect(filterWords('you ass, sh1t F-U-C-K fuuuck b!tch')).toBe('you ***, **** F-U-C-K ****** *****');
  expect(filterWords('classic assassin bass Scunthorpe')).toBe('classic assassin bass Scunthorpe');
});

test('plain text: no control or invisible characters, one line, always within the wire', () => {
  expect(plainLine(' a\u0007b‮c​\n\n d ', 64)).toBe('a b c d');
  expect(plainLine('<b>bold</b>', 64)).toBe('<b>bold</b>'); // shown as text, so it stays what was typed
  const long = plainLine('é'.repeat(500), MAX_CHAT_BYTES);
  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(MAX_CHAT_BYTES);
  expect(cleanName('   ')).toBe(GUEST.name);
  expect(cleanName('a'.repeat(99))).toHaveLength(24);
});

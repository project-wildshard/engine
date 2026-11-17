import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { PLAYER_TICKET_PUBLIC_KEY, admit, seatOf } from '../src/server/host/dedicated/ticket';
import { NetIdentitySchema } from '../src/shared/engine/net/identity';
import * as v from 'valibot';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// MMO-PLAN MP2.2c (MP2.1's ticket): the api-server signs a short Ed25519 ticket (player, device, expiry); the door checks it
// offline against the pinned key and seats the account's player. Two devices' tickets reach one player, a join never asks the
// api-server, and a bad or expired ticket plays as the device's guest. The ticket rides in the hello's `player` text, so the wire
// does not change. Format (api-server `src/server/signing/player-ticket.ts`): `ticket:<player>.<device>.<expires>.<signature>`, at most 251 bytes.
const SHARD = 'driftwood-isle', PLAYER = 'plr_0123456789abcdef0123456789abcdef', NOW_S = 1_800_000_000;
const bots: RoomBot[] = [];
let bench: RoomBench | undefined;
const realFetch = globalThis.fetch;
// Only fetch is put back: setup.ts stubs localStorage and location for every file.
afterEach(async () => { for (const bot of bots.splice(0)) bot.drop(); await bench?.close(); bench = undefined; globalThis.fetch = realFetch; });

interface Keys { readonly privateKey: KeyObject; readonly spkiHex: string }
function keys(): Keys {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, spkiHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
}
function ticket(key: KeyObject, claims: { player: string; device: string; expires: number }): string {
  const signed = `ticket:${claims.player.slice('plr_'.length)}.${claims.device}.${String(claims.expires)}`;
  return `${signed}.${sign(null, Buffer.from(signed), key).toString('hex')}`;
}

test('a ticket seats its account; a bad, expired or odd one seats the device it names, or nobody', async () => {
  const key = keys(), other = keys(), live = NOW_S + 60, now = NOW_S * 1000;
  const good = ticket(key.privateKey, { player: PLAYER, device: 'device:a', expires: live });
  expect(await admit(good, key.spkiHex, now), 'with the device whose guest progress it may claim (MP2.2d)').toEqual({ seat: `account:${PLAYER}`, from: 'device:a' });
  expect(await seatOf(ticket(other.privateKey, { player: PLAYER, device: 'device:a', expires: live }), key.spkiHex, now), 'another key').toBe('device:a');
  expect(await seatOf(ticket(key.privateKey, { player: PLAYER, device: 'device:a', expires: NOW_S }), key.spkiHex, now), 'expired').toBe('device:a');
  expect(await seatOf(good.replace('device:a', 'device:b'), key.spkiHex, now), 'another device in a signed ticket').toBe('device:b');
  expect(await seatOf(good.replace(PLAYER.slice(4), 'f'.repeat(32)), key.spkiHex, now), 'another player in it: never theirs').toBe('device:a');
  expect(await seatOf(ticket(key.privateKey, { player: 'plr_admin', device: 'device:a', expires: live }), key.spkiHex, now), 'a ticket that does not parse').toBeUndefined();
  const longest = ticket(key.privateKey, { player: PLAYER, device: `device:${'a'.repeat(64)}`, expires: 99_999_999_999 });
  expect(longest.length, 'the longest ticket fits the hello\'s 255 bytes').toBeLessThanOrEqual(255);
  expect(v.safeParse(NetIdentitySchema, { player: longest, name: 'Ann' }).success, 'and the schema takes it').toBe(true);
  expect(await seatOf('device:plain', key.spkiHex, now), 'a plain device id is itself').toBe('device:plain');
  expect(await seatOf(good, undefined, now), 'no pinned key: the device').toBe('device:a');
  expect(await seatOf('account:plr_0123456789abcdef0123456789abcdef', key.spkiHex, now), 'nobody claims an account by name').toBeUndefined();
  expect(v.safeParse(NetIdentitySchema, { player: good, name: 'Ann' }).success, 'the hello takes a ticket').toBe(true);
  expect(PLAYER_TICKET_PUBLIC_KEY).toMatch(/^302a300506032b6570032100[0-9a-f]{64}$/u);
});

test('two devices\' tickets reach one player, with the api-server down; a bad ticket plays as the device\'s guest', { timeout: 60_000 }, async () => {
  const key = keys(), expires = Math.floor(Date.now() / 1000) + 600;
  const asked: string[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('api.wildshard.io') || url.includes('/api/players')) { asked.push(url); throw new TypeError('api-server is down'); }
    return await realFetch(input, init);
  };
  const claims: string[] = [], saves = memoryPlayerSaves(), claim = saves.claim;
  bench = await roomBench({ ticketKey: key.spkiHex, saves: { ...saves, claim: async (device, account) => { claims.push(`${device}>${account}`); return await claim?.(device, account) ?? 'none'; } } });
  const join = async (player: string): Promise<RoomBot> => {
    const bot = new RoomBot(bench?.url ?? '', 'bench', player, 'Ann'); bots.push(bot);
    expect(await bot.arrived()).toBe(true);
    return bot;
  };
  const phone = await join(ticket(key.privateKey, { player: PLAYER, device: 'device:phone', expires }));
  const room = bench.room(SHARD), account = `account:${PLAYER}`;
  const body = room?.bodyOf(account);
  expect(body, 'the phone stands as the account').toBeDefined();
  expect(room?.bodyOf('device:phone'), 'not as the phone').toBeUndefined();
  phone.drop();
  await join(ticket(key.privateKey, { player: PLAYER, device: 'device:desk', expires }));
  expect(room?.bodyOf(account), 'the desktop reaches the same player: the body the phone left').toBe(body);
  expect(room?.bodyOf('device:desk'), 'not as the desktop').toBeUndefined();
  await join(ticket(keys().privateKey, { player: PLAYER, device: 'device:stranger', expires }));
  expect(room?.bodyOf('device:stranger'), 'a ticket from another key plays as its device').toBeDefined();
  await join(ticket(key.privateKey, { player: PLAYER, device: 'device:late', expires: Math.floor(Date.now() / 1000) - 1 }));
  expect(room?.bodyOf('device:late'), 'an expired ticket plays as its device').toBeDefined();
  // review M1: a guest still playing in another tab is never claimed from under its body (another account, so only the guest is live)
  for (const bot of bots.splice(0)) bot.drop(); // the door lets one address hold only a few sockets
  const tab = await join('device:tab');
  await join(ticket(key.privateKey, { player: PLAYER.replace('0123', '4567'), device: 'device:tab', expires }));
  expect(room?.bodyOf('device:tab'), 'the guest tab plays on').toBeDefined();
  tab.drop();
  expect(asked, 'no join asked the api-server').toEqual([]);
  expect(claims, 'MP2.2d: a live ticket claims its device\'s guest progress, never while the account (the desktop, its body still held) or the guest (the tab) is live; a dead ticket claims nothing').toEqual([`device:phone>${account}`]);
});

test('MP2.2g: the door stops asking to claim once the account has progress; an empty account is asked again', { timeout: 60_000 }, async () => {
  const key = keys(), expires = Math.floor(Date.now() / 1000) + 600, kept = `account:${PLAYER}`, empty = `account:${PLAYER.replace('0123', '4567')}`;
  const claims: string[] = [];
  bench = await roomBench({ ticketKey: key.spkiHex, holdMs: 100, saves: { ...memoryPlayerSaves(), claim: (device, account) => { claims.push(`${device}>${account}`); return Promise.resolve(account === kept ? 'kept' : 'none'); } } });
  const room = (): ReturnType<RoomBench['room']> => bench?.room(SHARD);
  const visit = async (player: string, seat: string): Promise<void> => {
    const bot = new RoomBot(bench?.url ?? '', 'bench', player, 'Ann'); bots.push(bot);
    expect(await bot.arrived()).toBe(true);
    expect(bench?.world.isPlaying(seat), 'MP2.5a: the door knows the account is in the world').toBe(true);
    bot.drop();
    await vi.waitFor(() => { expect(room()?.bodyOf(seat), 'the body goes once its hold ends').toBeUndefined(); }, { timeout: 10_000, interval: 50 });
    await new Promise(resolve => { setTimeout(resolve, 200); }); // the door hears the leave after the room does
  };
  const at = (player: string, device: string): string => ticket(key.privateKey, { player, device, expires });
  await visit(at(PLAYER, 'device:phone'), kept);
  await visit(at(PLAYER, 'device:desk'), kept);
  await visit(at(PLAYER, 'device:phone'), kept);
  const other = PLAYER.replace('0123', '4567');
  await visit(at(other, 'device:pad'), empty);
  await visit(at(other, 'device:pad'), empty);
  expect(bench.world.isPlaying(kept), 'and that it left').toBe(false);
  expect(claims, 'an account with progress is claimed into once, never again; one with none is asked at each join').toEqual([`device:phone>${kept}`, `device:pad>${empty}`, `device:pad>${empty}`]);
});

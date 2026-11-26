// oxlint-disable-next-line import/no-nodejs-modules -- Local proof passes use an ephemeral key.
import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import type { ActorTags } from '../src/shared/engine/app/actor';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { memoryZoneEntryStore, zoneEntryStore, type ZoneEntryStore } from '../src/server/host/dedicated/saves/zoneEntries';
import { ZoneEntries } from '../src/server/host/dedicated/zoneEntries';
import { gatewayDoor } from './fixtures/dedicated/gatewayDoor';
import { openPglite } from './fixtures/pgliteDatabase';

const home = 'driftwood-isle', other = 'far-reach';
const human = { 'user-agent': 'Mozilla/5.0 iPhone Safari/604.1' };

test('the door counts confirmed Zone Select seats and walk-ins by actor', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const ticketKey = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const pass = `pass:door-proof.${String(Math.floor(Date.now() / 1000) + 3600)}`;
  const protocols = [`wspass.${pass.slice('pass:'.length)}.${sign(null, Buffer.from(pass), privateKey).toString('hex')}`];
  const visits: { slug: string; actor: ActorTags['actor']; lane?: string }[] = [];
  const door = await gatewayDoor({ ticketKey, workers: 1, cells: [home, other], entered: (_seat, slug, { actor, lane }) => {
    visits.push({ slug, actor, ...(lane === undefined ? {} : { lane }) });
  } });
  const visit = { cell: home, spawn: true }, walk = { cell: home, spawn: false };
  const confirm = (): void => {
    const seat = door.seats.at(-1);
    if (seat?.admission === undefined) throw new Error('No claimed seat');
    door.heard({ kind: 'seated', slug: seat.slug, device: seat.device, body: seat.body, seats: door.seats.length, admission: seat.admission });
  };
  try {
    expect(await door.admit('203.0.113.11', 'device:one', human, '', [], visit)).toBe(true);
    expect(visits).toEqual([]);
    confirm();
    confirm();
    expect(await door.admit('203.0.113.12', 'device:two', human, '', [], walk)).toBe(true);
    confirm();
    const road = roadName(home);
    door.heard({ kind: 'crossed', from: home, to: road, device: 'device:two', body: 'body', name: 'Guest', moved: true, stays: false });
    door.heard({ kind: 'crossed', from: road, to: other, device: 'device:two', body: 'body', name: 'Guest', moved: true, stays: false });
    expect(await door.admit('203.0.113.13', 'device:ua', { 'user-agent': 'Safari WildshardAgent/1 (qa)' }, '', [], visit)).toBe(true);
    confirm();
    expect(await door.admit('203.0.113.14', 'device:pass', human, '', protocols, visit)).toBe(true);
    confirm();
    expect(await door.admit('203.0.113.15', 'device:one', human, '', [], walk)).toBe(true);
    confirm();
    expect(visits).toEqual([
      { slug: home, actor: 'human' }, { slug: other, actor: 'human' },
      { slug: home, actor: 'agent', lane: 'qa' }, { slug: home, actor: 'agent', lane: 'door-proof' },
    ]);
  } finally { await door.close(); }
});

test.each(['database', 'memory'])('zone totals on %s deduplicate people across days and isolate channels', async backend => {
  const db = backend === 'database' ? await openPglite() : undefined;
  try {
    if (db !== undefined) await migrate(db);
    const store = db === undefined ? memoryZoneEntryStore() : zoneEntryStore(db);
    let now = Date.parse('2026-11-19T16:00:00Z'), fail = true;
    const retry: ZoneEntryStore = { ...store, async write(channel, batch) {
      await store.write(channel, batch);
      if (fail) { fail = false; throw new Error('commit acknowledgement dropped'); }
    } };
    const live = new ZoneEntries(retry, 'production', 'test-salt', () => undefined, () => now);
    const staging = new ZoneEntries(store, 'staging', 'test-salt', () => undefined, () => now);
    live.entered('account:one', home, { actor: 'human' });
    live.entered('account:one', home, { actor: 'human' });
    live.entered('account:one', other, { actor: 'human' });
    live.entered('device:agent', home, { actor: 'agent' });
    live.pressed(home, { actor: 'human' });
    live.pressed(home, { actor: 'agent' });
    live.pressed(other, { actor: 'human' });
    await live.flush();
    await live.flush();
    now += 60_000;
    live.entered('device:anonymous', home, { actor: 'human' });
    staging.entered('account:one', home, { actor: 'human' });
    staging.pressed(home, { actor: 'human' });
    await live.flush();
    await staging.flush();
    now += 86_400_000;
    live.entered('account:one', home, { actor: 'human' });
    await live.flush();
    expect(await live.totals()).toEqual(expect.arrayContaining([
      { slug: home, humans: 3, agents: 1, uniqueHumans: 2 },
      { slug: other, humans: 1, agents: 0, uniqueHumans: 1 },
    ]));
    expect(await live.totals(1)).toEqual([{ slug: home, humans: 1, agents: 0, uniqueHumans: 1 }]);
    expect(await staging.totals()).toEqual([{ slug: home, humans: 1, agents: 0, uniqueHumans: 1 }]);
    expect(await store.pressTotals('production', '2026-11-19')).toEqual(expect.arrayContaining([
      { slug: home, humans: 1, agents: 1 }, { slug: other, humans: 1, agents: 0 },
    ]));
    expect(await store.pressTotals('staging', '2026-11-19')).toEqual([{ slug: home, humans: 1, agents: 0 }]);
    expect(await store.pressTotals('production', '2026-11-20')).toEqual([]);
    if (db !== undefined) {
      const { rows } = await db.query('select distinct player_key from human_players where channel = $1', ['production']);
      expect(rows).toEqual(Array.from({ length: 2 }, () => ({ player_key: expect.stringMatching(/^[a-f0-9]{64}$/u) })));
    }
  } finally { await db?.close(); }
});

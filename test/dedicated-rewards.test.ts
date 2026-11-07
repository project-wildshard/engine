import { expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { directLoopback } from '../src/test/engine/netLoopback';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { parseDoc } from '../src/server/host/dedicated/playerDoc';
import { validPlayerStore } from '../src/server/host/dedicated/playerStore';
import type { SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { serverInput } from './fixtures/dedicated/roomBench';
import * as v from 'valibot';
import { ReleaseSchema } from '../src/shared/host/releaseRows';
import { Vector3 } from 'three';
import { populationRoster } from '../src/server/game/population/roster';
import { mountedPlayerOf } from '../src/server/game/riding/native';
import { exportPlayer, importPlayer } from '../src/server/host/dedicated/playerDoc';

test('E7 refuses a pre-flip save epoch', () => {
  expect(() => v.parse(ReleaseSchema, { channel: 'production', serial: 1, engineBuild: 'e7', saveEpoch: 0, shards: [] })).toThrow();
});

test('reward documents are admitted only with valid reward data', () => {
  const documentName = 'wildshard.save.v2.pine-hollow';
  expect(validPlayerStore({ [documentName]: JSON.stringify({ keys: { 'creature-rewards': { v: 1, data: { legacyOwner: null, players: {} } } } }) }, 'pine-hollow')).toBe(true);
  expect(validPlayerStore({ [documentName]: JSON.stringify({ keys: { 'creature-rewards': { v: 1, data: { players: 'bad' } } } }) }, 'pine-hollow')).toBe(false);
});

test('reward profiles checkpoint, restart on another seat, and release both identities', async () => {
  const input = await serverInput('pine-hollow'), writes: SaveWrite[] = [];
  const boot = (): Promise<DedicatedRoom> => DedicatedRoom.boot({ slug: 'pine-hollow', build: '', bootId: 'rewards', input, now: () => 0, post: row => { if (row.kind === 'save') writes.push(row.write); if (row.kind === 'refused') throw new Error(row.reason); } });
  const enter = (room: DedicatedRoom, device: string, saved?: SaveWrite): ReturnType<typeof directLoopback> => {
    const link = directLoopback(), client = new NetClient(link.client);
    room.seat({ device, name: device, body: `p.${device}`, seq: saved?.seq ?? 0, doc: saved === undefined ? null : parseDoc(saved.doc, saved.saveVersion, 'pine-hollow') }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
    link.pump(); return link;
  };
  const room = await boot();
  let fresh: DedicatedRoom | undefined;
  try {
    const first = enter(room, 'a'), read = shardRows(room.host).owned.get('creature-rewards');
    expect(read).toBeTypeOf('function'); read?.('actor.player', new Map());
    const goods = room.cell.owned.of('actor.player');
    goods.file({ grant: 'item', name: 'ghost-stag', amount: 1 });
    expect(goods.count('ghost-stag'), 'a finish is reward state, never inventory').toBe(0);
    if (input.product === undefined) throw new Error('No product');
    const { step } = v.parse(v.object({ step: v.string() }), await input.product.json('actors/roster.json'));
    const deer = populationRoster(room.host, step).spawn('deer', 5, -225, 0, 'ghost'), player = room.bodyOf('a');
    if (player === undefined) throw new Error('No player');
    expect(room.host.combat.hit({ source: player.health, sourceTags: ['actor.player', 'cover.checked'], target: deer.combatActor(), amount: deer.maxHp * 10, point: deer.position.clone(), dir: new Vector3(0, 0, 1) })?.killed).toBe(true);
    room.tick(); room.tick();
    player.resetPose(deer.position, 0);
    actRoutes(room.host).claims.get('finish.claim.ghost-stag')?.(player.id);
    const earned = new Map<string, number>(); read?.(player.id, earned);
    expect(earned.get('finish.ghost-stag')).toBe(1); expect(earned.get('journal.ghost-stag.taken')).toBe(2);
    first.server.close('left');
    expect(actRoutes(room.host).identities.has('actor.player')).toBe(false);
    const saved = writes.at(-1); expect(saved).toBeDefined();
    expect(JSON.stringify(parseDoc(saved?.doc, saved?.saveVersion ?? 0)?.store)).toContain('creature-rewards');
    expect(parseDoc(saved?.doc, saved?.saveVersion ?? 0, 'pine-hollow')).not.toBeNull();
    fresh = await boot(); enter(fresh, 'other'); const back = enter(fresh, 'a', saved);
    expect(fresh.bodyOf('a')?.id).toBe('p.a');
    const restored = new Map<string, number>();
    shardRows(fresh.host).owned.get('creature-rewards')?.('p.a', restored);
    expect(restored).toEqual(earned);
    back.server.close('left');
    expect(actRoutes(fresh.host).identities.has('p.a')).toBe(false);
    const last = writes.at(-1);
    expect(parseDoc(last?.doc, last?.saveVersion ?? 0)?.store).toEqual(parseDoc(saved?.doc, saved?.saveVersion ?? 0)?.store);
  } finally { fresh?.dispose(); room.dispose(); }
});

test('a checkpoint leaves a live rider mounted and restores on foot', async () => {
  const input = await serverInput('nalati-grasslands');
  const boot = (): Promise<DedicatedRoom> => DedicatedRoom.boot({ slug: 'nalati-grasslands', build: '', bootId: 'rider', input, now: () => 0, post: () => undefined });
  const room = await boot(), fresh = await boot();
  try {
    const mounted = mountedPlayerOf(room.host), player = room.host.players.get('actor.player'), back = fresh.host.players.get('actor.player'), horse = mounted?.mountables[0];
    if (mounted === undefined || player === undefined || back === undefined || horse === undefined) throw new Error('No mounted player');
    expect(mounted.mount(horse.entityId)).toBe(true);
    const before = player.position.clone(), saved = exportPlayer(room.host, player, { store: {}, ledger: { serial: 0, rows: [] } });
    expect(saved.at).toMatchObject({ x: mounted.body.feet.x, y: mounted.body.feet.y, z: mounted.body.feet.z });
    expect(mounted.mounted).toBe(true); expect(mounted.horse).toBe(horse);
    expect(player.modes.current()).toBe('ride'); expect(player.position.distanceTo(before)).toBe(0);
    importPlayer(fresh.host, back, saved);
    expect(back.modes.current()).toBe('foot'); expect(mountedPlayerOf(fresh.host)?.mounted).toBe(false);
  } finally { fresh.dispose(); room.dispose(); }
});

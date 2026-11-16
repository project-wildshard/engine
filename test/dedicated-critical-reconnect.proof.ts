import { expect, test, vi } from 'vitest';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import { cellFrame } from '../src/server/host/dedicated/gridCells';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench } from './fixtures/dedicated/roomBench';
import { RoomBot, stillThumb, type BotThumb } from './fixtures/dedicated/roomBot';
import { tcpPuller } from './fixtures/tcpPuller';

const HOME = 'driftwood-isle', SOUTH = 'far-reach', DEVICE = 'device:fighter';
const swing = (targetId: string): BotThumb => tick => ({ ...stillThumb(tick), yaw: Math.PI / 2,
  ...(tick % 20 === 0 ? { attack: { targetId, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) });

// EG-24: the real TCP cable disappears after an earned hit, while the foe is
// alive. The other socket keeps receiving the same world during the outage.
test('a cable pulled during a real fight resumes its held body and keeps damaging the same foe', async () => {
  const bench = await roomBench({ holdMs: 30_000 }), bots: RoomBot[] = [];
  let puller: Awaited<ReturnType<typeof tcpPuller>> | undefined;
  const join = async (url: string, device: string): Promise<RoomBot> => {
    const bot = new RoomBot(url, 'bench', device); bots.push(bot);
    expect(await bot.arrived(1500)).toBe(true); return bot;
  };
  try {
    puller = await tcpPuller(bench.url);
    const first = await join(puller.url, DEVICE), witness = await join(bench.url, 'device:witness');
    const room = bench.room(HOME), player = room?.bodyOf(DEVICE);
    if (room === undefined || player === undefined) throw new Error('Missing real room/player');
    const pair = [...room.host.entities].find(([, creature]) => creature.alive && creature.hp >= 60 && ['boar', 'crab', 'wolf'].includes(creature.kind));
    if (pair === undefined) throw new Error('Missing live fight target');
    const [id, foe] = pair, full = foe.hp;
    foe.harnessHold = true;
    player.resetPose({ x: foe.position.x + 1.2, y: foe.position.y + .2, z: foe.position.z }, Math.PI / 2);
    first.thumb = swing(id);
    await vi.waitFor(() => { expect(foe.hp).toBeLessThan(full); }, { timeout: 1500, interval: 10 });
    expect(foe.alive, 'the disconnect is during combat, before the kill').toBe(true);
    first.thumb = stillThumb;
    const heard = witness.client.latest?.tick ?? 0;
    puller.pull();
    await vi.waitFor(() => { expect(room.holding).toBe(1); }, { timeout: 4500, interval: 20 });
    const heldAt = room.host.state.tick;
    await vi.waitFor(() => { expect(room.host.state.tick).toBeGreaterThanOrEqual(heldAt + 60); }, { timeout: 1500, interval: 10 });
    expect(room.holding, 'the body remains held while real ticks continue').toBe(1);
    expect(room.bodyOf(DEVICE)).toBe(player);
    expect(witness.client.latest?.tick).toBeGreaterThan(heard);
    const hurt = foe.hp;
    puller.restore();
    const back = await join(puller.url, DEVICE);
    expect(room.bodyOf(DEVICE), 'hold reuses the actual fighting body').toBe(player);
    expect(bench.world.health().players).toBe(2);
    expect(foe.hp, 'reconnect cannot reset the shared fight').toBeLessThanOrEqual(hurt);
    const resumed = foe.hp;
    back.thumb = swing(id);
    await vi.waitFor(() => { expect(foe.hp).toBeLessThan(resumed); }, { timeout: 1500, interval: 10 });
    expect(bench.crashes).toEqual([]);
  } finally { for (const bot of bots) bot.drop(); await puller?.close(); await bench.close(); }
}, 10_000);

// Pause the real save port after the crossing request, then close its actual
// socket before that read returns. The aborted handoff must release its guard.
test('a socket lost while a crossing waits on saves can reconnect and complete the crossing once', async () => {
  const saves = memoryPlayerSaves(), bots: RoomBot[] = [];
  let release = (): void => undefined, waiting = false, arm = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bench = await roomBench({ cells: [HOME, SOUTH], workers: 1, saves: { ...saves, read: async (device, slug) => {
    if (arm && device === DEVICE && slug === SOUTH) { arm = false; waiting = true; await gate; }
    return saves.read(device, slug);
  } } });
  const join = async (device: string): Promise<RoomBot> => {
    const bot = new RoomBot(bench.url, 'bench', device); bots.push(bot);
    expect(await bot.arrived(1500)).toBe(true); return bot;
  };
  try {
    const first = await join(DEVICE);
    const home = bench.room(HOME), player = home?.bodyOf(DEVICE);
    if (home === undefined || player === undefined) throw new Error('Missing source room/player');
    // A second device prewarms the destination through its normal persisted place.
    saves.write({ player: 'device:witness', name: 'Witness', shard: SOUTH, cell: SOUTH, build: 'bench', saveVersion: 0, seq: 1, reason: 'test', doc: null, receipts: [] });
    await join('device:witness');
    const south = bench.room(SOUTH); if (south === undefined) throw new Error('Missing destination room');
    home.cell.owned.of(player.id).file({ grant: 'coins', name: 'coins', amount: 9 });
    await vi.waitFor(() => { expect(first.coins(OWNED_ROW.coins)).toBe(9); }, { timeout: 1000 });
    const at = { ...south.spawn, x: south.spawn.x + 4 };
    arm = true; home.crossing(DEVICE, SOUTH, at);
    await vi.waitFor(() => { expect(waiting).toBe(true); }, { timeout: 1000 });
    first.drop();
    await vi.waitFor(() => { expect(home.holding).toBe(1); }, { timeout: 1000 });
    expect(south.holds(DEVICE)).toBe(false);
    release();
    await vi.waitFor(() => { expect(bench.lines).toContainEqual(expect.objectContaining({ at: 'cell.crossed', device: DEVICE, moved: false })); }, { timeout: 1000 });
    const back = await join(DEVICE);
    expect(home.bodyOf(DEVICE)).toBe(player);
    expect(back.client.latest?.cell).toBe(cellFrame(HOME));
    expect(back.coins(OWNED_ROW.coins)).toBe(9);
    home.crossing(DEVICE, SOUTH, at);
    await vi.waitFor(() => { expect(back.client.latest?.cell).toBe(cellFrame(SOUTH)); }, { timeout: 1500 });
    expect(home.holds(DEVICE)).toBe(false); expect(south.holds(DEVICE)).toBe(true);
    expect(bench.world.health().players).toBe(2);
    expect(bench.lines.filter(row => row['at'] === 'cell.crossed' && row['device'] === DEVICE && row['moved'] === true)).toHaveLength(1);
    expect(back.closed).toBeNull(); expect(bench.crashes).toEqual([]);
  } finally { release(); for (const bot of bots) bot.drop(); await bench.close(); }
}, 10_000);
